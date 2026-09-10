import { createHash, randomUUID } from "node:crypto";
import type { IntakeAttempt, IntakeLedger } from "./intake-assurance.js";
import { intakePageRequest, type IntakePage } from "./intake-exceptions.js";

export interface IntakeSweepScope { customer_id: string; provider: string; connection_id: string; import_method_id: string; purpose?: "internal_notification" | "source_feedback" | "status_link_repair" }
export interface IntakeSweepCheckpoint {
  schema_version: 1; sweep_id: string; scope: IntakeSweepScope; revision: number;
  cursor: string | null; pass_count: number; last_completed_at: string | null;
  lease_token: string | null; lease_until: number; updated_at: string;
  last_failure: "observation_failed" | null;
}
export interface IntakeSweepFence { scope: IntakeSweepScope; lease_token: string; now: string }
export class IntakeSweepLeaseLostError extends Error {
  constructor() { super("Intake recovery lease is no longer owned by this worker"); this.name = "IntakeSweepLeaseLostError"; }
}
export function intakeSweepId(scope: IntakeSweepScope) {
  const values = [scope.customer_id, scope.provider, scope.connection_id, scope.import_method_id];
  if (scope.purpose !== undefined) {
    if (!["internal_notification", "source_feedback", "status_link_repair"].includes(scope.purpose)) throw new Error("Invalid intake sweep purpose");
    values.push(scope.purpose);
  }
  if (values.some((value) => typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(value))) throw new Error("Invalid intake recovery scope");
  return `sweep_${createHash("sha256").update(JSON.stringify(values)).digest("hex")}`;
}
export function sweepTime(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error("Invalid intake recovery time");
  return time;
}
export function validateSweepCheckpoint(value: unknown, scope: IntakeSweepScope): IntakeSweepCheckpoint {
  const record = value as IntakeSweepCheckpoint | null;
  if (!record || record.schema_version !== 1 || record.sweep_id !== intakeSweepId(scope) ||
    !record.scope || intakeSweepId(record.scope) !== record.sweep_id || !Number.isInteger(record.revision) || record.revision < 1 ||
    !Number.isInteger(record.pass_count) || record.pass_count < 0 ||
    (record.cursor !== null && (typeof record.cursor !== "string" || record.cursor.length > 1024)) ||
    (record.lease_token !== null && (typeof record.lease_token !== "string" || !record.lease_token)) ||
    !Number.isFinite(record.lease_until) || record.lease_until < 0 ||
    (record.last_failure !== null && record.last_failure !== "observation_failed")) throw new Error("Invalid intake recovery checkpoint");
  sweepTime(record.updated_at);
  intakePageRequest(scope.customer_id, 1, record.cursor ?? undefined);
  if (record.last_completed_at !== null) sweepTime(record.last_completed_at);
  return record;
}
export interface IntakeSweepCheckpointStore {
  acquire(scope: IntakeSweepScope, token: string, now: string, leaseSeconds: number): Promise<IntakeSweepCheckpoint | null>;
  save(previous: IntakeSweepCheckpoint, next: IntakeSweepCheckpoint, now: string): Promise<void>;
}
export interface IntakeSweepConfig {
  enabled: boolean; scope: IntakeSweepScope; page_size: number; max_pages: number; lease_seconds: number;
  snapshot_limit: number; sla_seconds: number;
}
export function getIntakeSweepConfig(env: NodeJS.ProcessEnv): IntakeSweepConfig {
  const enabled = env.PATHFINDER_ENABLE_INTAKE_ASSURANCE_SWEEP === "true";
  const scope = { customer_id: env.PATHFINDER_INTAKE_ASSURANCE_CUSTOMER_ID ?? "", provider: "wrike",
    connection_id: env.PATHFINDER_INTAKE_ASSURANCE_CONNECTION_ID ?? "", import_method_id: env.PATHFINDER_INTAKE_ASSURANCE_IMPORT_METHOD_ID ?? "" };
  const config = { enabled, scope, page_size: Number(env.PATHFINDER_INTAKE_SWEEP_PAGE_SIZE), max_pages: Number(env.PATHFINDER_INTAKE_SWEEP_MAX_PAGES),
    lease_seconds: Number(env.PATHFINDER_INTAKE_SWEEP_LEASE_SECONDS), snapshot_limit: Number(env.PATHFINDER_INTAKE_SWEEP_SNAPSHOT_LIMIT),
    sla_seconds: Number(env.PATHFINDER_INTAKE_ASSURANCE_SLA_SECONDS) };
  if (enabled) validateSweepConfig(config);
  return config;
}
export function validateSweepConfig(config: IntakeSweepConfig) {
  intakeSweepId(config.scope);
  for (const [value, min, max] of [[config.page_size, 1, 100], [config.max_pages, 1, 10], [config.lease_seconds, 30, 900],
    [config.snapshot_limit, 1, 10000], [config.sla_seconds, 60, 604800]]) {
    if (!Number.isInteger(value) || value! < min! || value! > max!) throw new Error("Intake recovery requires explicit bounded operating settings");
  }
}
export function isIntakeRecoverySweepEvent(event: unknown) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return false;
  const candidate = event as { source?: unknown; "detail-type"?: unknown; detail?: { automation?: unknown } };
  return candidate.source === "pathfinder.intake" && candidate["detail-type"] === "Intake Assurance Sweep" &&
    candidate.detail?.automation === "observe_durable_outcomes";
}
/** One bounded pass segment. Page progress is committed only after every observation succeeds. */
export async function runIntakeRecoverySweep<Snapshot extends { checked_at: string }>(args: {
  config: IntakeSweepConfig; checkpoints: IntakeSweepCheckpointStore;
  list: (customerId: string, limit: number, cursor?: string) => Promise<IntakePage>;
  ledger: IntakeLedger;
  fencedLedger: (fence: () => IntakeSweepFence) => IntakeLedger;
  snapshot: () => Promise<Snapshot>;
  observe: (attempt: IntakeAttempt, snapshot: Snapshot, ledger: IntakeLedger, now: string, fence: () => IntakeSweepFence) => Promise<unknown>;
  now?: () => Date; token?: () => string;
}) {
  const counts = { pages: 0, scanned: 0, observed: 0, skipped: 0 };
  if (!args.config.enabled) return { status: "disabled" as const, ...counts };
  validateSweepConfig(args.config);
  const now = () => (args.now ?? (() => new Date()))().toISOString();
  const token = (args.token ?? randomUUID)();
  let checkpoint = await args.checkpoints.acquire(args.config.scope, token, now(), args.config.lease_seconds);
  if (!checkpoint) return { status: "busy" as const, ...counts };
  const owned = () => {
    const timestamp = now();
    if (checkpoint!.lease_token !== token || checkpoint!.lease_until <= sweepTime(timestamp)) throw new IntakeSweepLeaseLostError();
    return timestamp;
  };
  const ledger = args.fencedLedger(() => ({ scope: args.config.scope, lease_token: token, now: owned() }));
  async function save(patch: Partial<IntakeSweepCheckpoint>, release = false) {
    const timestamp = owned();
    const next = { ...checkpoint!, ...patch, revision: checkpoint!.revision + 1, updated_at: timestamp,
      lease_token: release ? null : token, lease_until: release ? 0 : sweepTime(timestamp) + args.config.lease_seconds * 1000 };
    await args.checkpoints.save(checkpoint!, next, timestamp);
    checkpoint = next;
  }
  try {
    const snapshot = await args.snapshot();
    if (sweepTime(snapshot.checked_at) > sweepTime(owned())) throw new Error("Intake recovery snapshot is in the future");
    for (let pageIndex = 0; pageIndex < args.config.max_pages; pageIndex++) {
      owned();
      const page = await args.list(args.config.scope.customer_id, args.config.page_size, checkpoint.cursor ?? undefined);
      if (page.attempts.length > args.config.page_size || (page.next_cursor !== null && page.next_cursor === checkpoint.cursor)) throw new Error("Invalid intake recovery page");
      for (const listed of page.attempts) {
        owned(); counts.scanned++;
        if (listed.signal.customer_id !== args.config.scope.customer_id) throw new Error("Intake recovery tenant mismatch");
        const attempt = await args.ledger.get(args.config.scope.customer_id, listed.attempt_id);
        if (!attempt) throw new Error("Intake attempt disappeared during recovery");
        if (attempt.signal.customer_id !== args.config.scope.customer_id || attempt.attempt_id !== listed.attempt_id) throw new Error("Intake recovery identity mismatch");
        if (attempt.signal.provider !== args.config.scope.provider || attempt.signal.connection_id !== args.config.scope.connection_id ||
          ["withdrawn", "superseded"].includes(attempt.state) || (attempt.state === "confirmed" && attempt.writeback_id) ||
          sweepTime(attempt.updated_at) > sweepTime(snapshot.checked_at)) { counts.skipped++; continue; }
        await args.observe(attempt, snapshot, ledger, owned(), () => ({ scope: args.config.scope, lease_token: token, now: owned() }));
        counts.observed++;
      }
      counts.pages++;
      const complete = page.next_cursor === null;
      await save({ cursor: page.next_cursor, last_failure: null,
        ...(complete ? { pass_count: checkpoint.pass_count + 1, last_completed_at: now() } : {}) }, complete || pageIndex + 1 === args.config.max_pages);
      if (complete) return { status: "completed" as const, ...counts };
    }
    return { status: "partial" as const, ...counts };
  } catch (error) {
    // Preserve the previous cursor on failure. A crash or failed release is safe:
    // the lease expires, and the same page can be replayed idempotently.
    try { await save({ last_failure: "observation_failed" }, true); } catch { /* A new owner must never be overwritten. */ }
    throw error;
  }
}

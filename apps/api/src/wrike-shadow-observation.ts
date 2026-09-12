import { createHash } from "node:crypto";
import { DynamoDBClient, GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { WRIKE_ORDER_INTENT_LABEL, type WrikeScopedIntakeDiscoveryResult } from "@pathfinder/wrike-adapter";
import { createIntakeAttempt, transitionIntake, validatePersistedIntakeAttempt, type IntakeAttempt } from "./intake-assurance.js";
import { observeWrikeIntent, validateWrikeIntentCursor, wrikeIntentSignal, type WrikeIntentCursor, type WrikeIntentScope, type WrikeIntentObservation } from "./wrike-intent-observation.js";
import { wrikeIntakeIntentCandidates, type WrikeAssuranceScope } from "./wrike-intake-assurance.js";
import type { WrikeScheduledIntakeRunResult } from "./wrike-scheduled-intake.js";

type Config = { customer: string; method: string; connection: string; status: string; max: number; sla: number; elapsed: number; table: string };
const safeId = (value: string) => /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(value);
function config(env: NodeJS.ProcessEnv): Config {
  const scope = (env.PATHFINDER_INTAKE_SHADOW_SCOPE ?? "").split("|");
  const limits = (env.PATHFINDER_INTAKE_SHADOW_LIMITS ?? "").split("|");
  const [version, customer, method, connection, status] = scope;
  const [budgetVersion, max, sla, elapsed] = limits;
  if (scope.length !== 5 || version !== "1" || ![customer, method, connection, status].every(v => v && safeId(v)) ||
    limits.length !== 4 || budgetVersion !== "1" || ![max, sla, elapsed].every(v => v && /^[1-9][0-9]*$/.test(v)) ||
    Number(max) > 25 || Number(sla) < 60 || Number(sla) > 604800 || Number(elapsed) < 50 || Number(elapsed) > 1000 ||
    env.PATHFINDER_STORAGE_DRIVER !== "dynamodb" || !env.PATHFINDER_INTAKE_ATTEMPTS_TABLE?.trim() ||
    env.PATHFINDER_INTAKE_ATTEMPTS_TABLE !== env.PATHFINDER_INTAKE_ATTEMPTS_TABLE.trim()) throw new Error("Invalid shadow configuration");
  // A shadow pilot never doubles as an enforcing/recovery/delivery activation.
  if (Object.entries(env).some(([key, value]) => value === "true" && key !== "PATHFINDER_ENABLE_INTAKE_SHADOW" &&
    (key.startsWith("PATHFINDER_ENABLE_INTAKE_") || key === "PATHFINDER_ENABLE_WRIKE_INTAKE_FEEDBACK"))) throw new Error("Conflicting intake modes");
  return { customer: customer!, method: method!, connection: connection!, status: status!, max: Number(max), sla: Number(sla), elapsed: Number(elapsed), table: env.PATHFINDER_INTAKE_ATTEMPTS_TABLE };
}

export interface WrikeShadowRecord {
  schema_version: 1; revision: number; scope: WrikeIntentScope; cursor: WrikeIntentCursor;
  /** Observational only: never eligible for the active recovery/delivery ledgers. */
  attempt: IntakeAttempt | null;
  outcomes: { preparation: string | null; jobs: string[]; submits: Array<{ job_id: string; outcome: string }>; writebacks: Array<{ job_id: string; outcome: string }> };
}
export interface WrikeShadowStore {
  read(scope: WrikeIntentScope, signal: AbortSignal): Promise<WrikeShadowRecord | null>;
  write(row: WrikeShadowRecord, previous: number | null, signal: AbortSignal): Promise<void>;
  close?(): void;
}
export function wrikeShadowKey(scope: WrikeIntentScope) {
  if (![scope.customer_id, scope.import_method_id, scope.connection_id, scope.task_id, scope.trigger_status_id].every(safeId)) throw new Error("Invalid shadow identity");
  return { customer_id: `intake-shadow#${scope.customer_id}`, attempt_id: `shadow_${createHash("sha256").update(JSON.stringify([
    scope.customer_id, scope.import_method_id, scope.connection_id, scope.task_id, scope.trigger_status_id
  ])).digest("hex")}` };
}
function validate(row: WrikeShadowRecord, scope: WrikeIntentScope) {
  if (row.schema_version !== 1 || !Number.isSafeInteger(row.revision) || row.revision < 1 ||
    JSON.stringify(wrikeShadowKey(row.scope)) !== JSON.stringify(wrikeShadowKey(scope))) throw new Error("Invalid shadow record");
  validateWrikeIntentCursor(row.cursor, scope);
  if (row.attempt) {
    validatePersistedIntakeAttempt(row.attempt);
    if (row.attempt.attempt_id !== row.cursor.attempt_id || row.attempt.state !== "manual_review") throw new Error("Invalid shadow attempt");
  }
  return row;
}
/** Separate tenant partitions cannot be mistaken for actionable intake attempts. No startup I/O. */
export function createDynamoWrikeShadowStore(table: string, client = new DynamoDBClient({ maxAttempts: 1 })): WrikeShadowStore {
  const key = (scope: WrikeIntentScope) => Object.fromEntries(Object.entries(wrikeShadowKey(scope)).map(([k, v]) => [k, { S: v }]));
  return {
    async read(scope, abortSignal) {
      const response = await client.send(new GetItemCommand({ TableName: table, Key: key(scope), ConsistentRead: true }), { abortSignal });
      if (!response.Item) return null;
      const expected = wrikeShadowKey(scope);
      if (response.Item.customer_id?.S !== expected.customer_id || response.Item.attempt_id?.S !== expected.attempt_id) throw new Error("Shadow tenant mismatch");
      const row = validate(JSON.parse(response.Item.data?.S ?? "null"), scope);
      if (response.Item.revision?.N !== String(row.revision)) throw new Error("Shadow revision mismatch");
      return row;
    },
    async write(row, previous, abortSignal) {
      validate(row, row.scope);
      await client.send(new PutItemCommand({ TableName: table, Item: { ...key(row.scope), data: { S: JSON.stringify(row) }, revision: { N: String(row.revision) } },
        ...(previous === null ? { ConditionExpression: "attribute_not_exists(customer_id) AND attribute_not_exists(attempt_id)" }
          : { ConditionExpression: "#revision = :previous", ExpressionAttributeNames: { "#revision": "revision" }, ExpressionAttributeValues: { ":previous": { N: String(previous) } } })
      }), { abortSignal });
    },
    close: () => client.destroy()
  };
}

export interface WrikeShadowInput {
  scope: Omit<WrikeAssuranceScope, "approved_status_label">;
  discovery: WrikeScopedIntakeDiscoveryResult;
  result: Pick<WrikeScheduledIntakeRunResult, "status" | "customer_id" | "import_method_id" | "results"> & {
    scheduled_submit: { outcomes?: Array<{ job_id: string; outcome: string }> };
    status_writeback: { outcomes?: Array<{ job_id: string; outcome: string }> };
  };
}
type Summary = { event: "intake_shadow_observation"; status: "observed" | "skipped" | "failed"; observed: number; written: number; replayed: number };
/** Only called after ordinary scheduled work finishes. Never returns a replacement result or throws. */
export async function observeWrikeShadow(args: {
  environment: NodeJS.ProcessEnv; input: WrikeShadowInput | null;
  remainingTimeMs?: () => number;
  store?: (table: string) => WrikeShadowStore;
  report?: (summary: Summary) => void;
}): Promise<void> {
  if (args.environment.PATHFINDER_ENABLE_INTAKE_SHADOW !== "true" || !args.input || args.input.result.status !== "completed") return;
  const summary: Summary = { event: "intake_shadow_observation", status: "failed", observed: 0, written: 0, replayed: 0 };
  let store: WrikeShadowStore | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const c = config(args.environment); const { scope, discovery, result } = args.input;
    if (scope.customer_id !== c.customer || scope.import_method_id !== c.method || scope.connection_id !== c.connection || scope.configured_status_id !== c.status ||
      result.customer_id !== c.customer || result.import_method_id !== c.method) throw new Error("Shadow scope mismatch");
    wrikeIntakeIntentCandidates({ ...scope, approved_status_label: WRIKE_ORDER_INTENT_LABEL }, discovery);
    const tasks = [...discovery.order_candidates.map(t => ({ ...t, identity_matches: true, reasons: [] })), ...discovery.pending_order_candidates]
      .filter(t => t.identity_matches && (t.custom_status_id === c.status || t.reasons.every(r => r.code === "trigger_status")));
    if (tasks.length > c.max) throw new Error("Shadow candidate overflow");
    const seen = new Set<string>();
    // Validate the entire batch and copy only bounded existing results before any persistence.
    const rows = tasks.map(task => {
      if (!task.account_id || !task.root_folder_ids?.length || !task.updated_at || seen.has(task.task_id)) throw new Error("Incomplete shadow evidence");
      seen.add(task.task_id);
      const identity: WrikeIntentScope = { customer_id: c.customer, import_method_id: c.method, connection_id: c.connection, task_id: task.task_id, trigger_status_id: c.status };
      wrikeShadowKey(identity);
      const observation: WrikeIntentObservation = { task_id: task.task_id, custom_status_id: task.custom_status_id, source_updated_at: task.updated_at,
        observed_at: discovery.checked_at, scope_verified: true, identity_matches: true };
      observeWrikeIntent(null, identity, observation);
      const matches = result.results.filter(r => r.task_id === task.task_id);
      if (matches.length > 1) throw new Error("Ambiguous shadow outcome");
      const jobs = [...(matches[0]?.job_ids ?? [])];
      if (jobs.length > 25 || !jobs.every(safeId) || new Set(jobs).size !== jobs.length) throw new Error("Shadow job overflow");
      const outcomes = { preparation: matches[0]?.outcome ?? null, jobs,
        submits: (result.scheduled_submit.outcomes ?? []).filter(r => jobs.includes(r.job_id)).map(r => ({ job_id: r.job_id, outcome: r.outcome })),
        writebacks: (result.status_writeback.outcomes ?? []).filter(r => jobs.includes(r.job_id)).map(r => ({ job_id: r.job_id, outcome: r.outcome })) };
      if (outcomes.submits.length > 25 || outcomes.writebacks.length > 25 || JSON.stringify(outcomes).length > 16000) throw new Error("Shadow outcome overflow");
      return { identity, observation, outcomes };
    });
    const remaining = args.remainingTimeMs?.();
    if ((args.environment.PATHFINDER_RUNTIME === "lambda" || args.environment.AWS_LAMBDA_FUNCTION_NAME) &&
      (remaining === undefined || !Number.isFinite(remaining) || remaining < c.elapsed + 2000)) {
      summary.status = "skipped"; return;
    }
    if (!rows.length) { summary.status = "observed"; return; }
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), c.elapsed);
    store = (args.store ?? createDynamoWrikeShadowStore)(c.table);
    for (const row of rows) {
      controller.signal.throwIfAborted();
      const previous = await store.read(row.identity, controller.signal);
      if (previous) validate(previous, row.identity);
      const cursor = observeWrikeIntent(previous?.cursor ?? null, row.identity, row.observation);
      if (previous && cursor === previous.cursor && JSON.stringify(row.outcomes) === JSON.stringify(previous.outcomes)) { summary.replayed++; summary.observed++; continue; }
      const signal = wrikeIntentSignal(cursor);
      let attempt: IntakeAttempt | null = null;
      if (signal) {
        if (previous?.attempt?.attempt_id === cursor.attempt_id) attempt = previous.attempt;
        else {
          const initial = createIntakeAttempt(signal, new Date(Date.parse(signal.observed_at) + c.sla * 1000).toISOString());
          attempt = transitionIntake(initial, { event_id: `${initial.attempt_id}:shadow`, expected_revision: 0, occurred_at: signal.observed_at,
            state: "manual_review", reason: "reconciliation_ambiguity", next_action_at: initial.next_action_at });
        }
      }
      controller.signal.throwIfAborted();
      await store.write({ schema_version: 1, revision: (previous?.revision ?? 0) + 1, scope: row.identity, cursor, attempt, outcomes: row.outcomes }, previous?.revision ?? null, controller.signal);
      summary.observed++; summary.written++;
    }
    summary.status = "observed";
  } catch { /* Never leak task identities, provider errors, or persistence errors into ordinary results. */ }
  finally {
    if (timer) clearTimeout(timer);
    try { store?.close?.(); } catch { /* cleanup cannot change ordinary completion */ }
    try { (args.report ?? (value => console.info(JSON.stringify(value))))(summary); } catch { /* telemetry is isolated too */ }
  }
}

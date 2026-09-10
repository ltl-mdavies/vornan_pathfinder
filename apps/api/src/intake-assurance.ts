import { createHash } from "node:crypto";
import type { TransactionalEmail, TransactionalEmailResult } from "./email.js";

/** Identity is an intent occurrence, never a poll, mention, filename, or parsed payload. */
export interface IntakeSignal {
  schema_version: 1;
  customer_id: string;
  provider: string;
  connection_id: string;
  source_id: string;
  intent_key: string;
  intent_occurrence: string;
  observed_at: string;
}
export type IntakeState = "received" | "preparing" | "ready" | "reconciling" |
  "confirmed" | "customer_action_required" | "internal_action_required" |
  "manual_review" | "superseded" | "withdrawn";
export type IntakeOwner = "automation" | "customer" | "internal" | "none";
export const intakeFailures = {
  missing_order_grid: "customer",
  invalid_order_grid: "customer",
  ambiguous_order_grid: "customer",
  contract_mismatch: "customer",
  missing_required_data: "customer",
  unmapped_product: "customer",
  submission_timeout: "internal",
  duplicate_ext_id: "internal",
  duplicate_order_name: "internal",
  lift_failure: "internal",
  pathfinder_failure: "internal",
  reconciliation_ambiguity: "internal",
  success_writeback_missing: "internal",
  success_writeback_failed: "internal"
} as const;
export type IntakeFailure = keyof typeof intakeFailures;
/** Only adapters that validate the failure may classify it as customer-correctable. */
export class IntakePreparationError extends Error {
  constructor(public readonly reason: IntakeFailure) {
    super(reason);
    this.name = "IntakePreparationError";
  }
}
export interface IntakeEvent {
  event_id: string;
  expected_revision: number;
  occurred_at: string;
  state: IntakeState;
  reason: IntakeFailure | null;
  job_id?: string;
  submit_attempt_id?: string;
  /** Only supplied after the existing strict reconciliation/association path succeeds. */
  confirmed_order_number?: string;
  writeback_id?: string;
  superseded_by?: string;
  next_action_at: string | null;
}
export interface IntakeAttempt {
  schema_version: 1;
  attempt_id: string;
  signal: IntakeSignal;
  revision: number;
  state: IntakeState;
  owner: IntakeOwner;
  reason: IntakeFailure | null;
  created_at: string;
  updated_at: string;
  next_action_at: string | null;
  job_id: string | null;
  submit_attempt_id: string | null;
  confirmed_order_number: string | null;
  writeback_id: string | null;
  superseded_by: string | null;
  last_event: (IntakeEvent & { projection: IntakeEventProjection }) | null;
}
type IntakeEventProjection = Pick<IntakeAttempt, "state" | "owner" | "reason" | "updated_at" | "next_action_at" |
  "job_id" | "submit_attempt_id" | "confirmed_order_number" | "writeback_id" | "superseded_by">;
const projectionFields = ["state", "owner", "reason", "updated_at", "next_action_at", "job_id", "submit_attempt_id", "confirmed_order_number", "writeback_id", "superseded_by"] as const;
function intakeProjection(attempt: IntakeAttempt): IntakeEventProjection {
  return Object.fromEntries(projectionFields.map(key => [key, attempt[key]])) as IntakeEventProjection;
}
const digest = (parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
const eventDigest = (event: IntakeEvent) => digest([event.event_id, event.expected_revision,
  event.occurred_at, event.state, event.reason, event.job_id, event.submit_attempt_id,
  event.confirmed_order_number, event.writeback_id, event.superseded_by, event.next_action_at]);
function required(value: string) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) throw new Error("Invalid intake identity");
  return value;
}
function timestamp(value: string) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error("Invalid intake timestamp");
  return Date.parse(value);
}
export function intakeAttemptId(signal: IntakeSignal) {
  if (signal.schema_version !== 1) throw new Error("Unsupported intake schema");
  return `intake_${digest([signal.customer_id, signal.provider, signal.connection_id,
    signal.source_id, signal.intent_key, signal.intent_occurrence].map(required))}`;
}
export function createIntakeAttempt(signal: IntakeSignal, nextActionAt: string): IntakeAttempt {
  if (timestamp(nextActionAt) < timestamp(signal.observed_at)) throw new Error("Intake deadline precedes observation");
  return {
    schema_version: 1, attempt_id: intakeAttemptId(signal), signal: { ...signal }, revision: 0,
    state: "received", owner: "automation", reason: null,
    created_at: signal.observed_at, updated_at: signal.observed_at, next_action_at: nextActionAt,
    job_id: null, submit_attempt_id: null, confirmed_order_number: null,
    writeback_id: null, superseded_by: null, last_event: null
  };
}
const transitions: Record<IntakeState, readonly IntakeState[]> = {
  received: ["preparing", "customer_action_required", "internal_action_required", "manual_review", "withdrawn", "superseded"],
  preparing: ["ready", "customer_action_required", "internal_action_required", "manual_review", "withdrawn", "superseded"],
  ready: ["reconciling", "customer_action_required", "internal_action_required", "manual_review", "withdrawn", "superseded"],
  reconciling: ["confirmed", "internal_action_required", "manual_review"],
  confirmed: ["confirmed", "internal_action_required"],
  customer_action_required: ["preparing", "internal_action_required", "manual_review", "withdrawn", "superseded"],
  internal_action_required: ["preparing", "reconciling", "confirmed", "customer_action_required", "manual_review", "withdrawn", "superseded"],
  manual_review: ["preparing", "reconciling", "confirmed", "customer_action_required", "internal_action_required", "withdrawn", "superseded"],
  superseded: [], withdrawn: []
};
/** Corrupt persisted records must surface an operational failure, never disappear from a page. */
export function validatePersistedIntakeAttempt(value: unknown): IntakeAttempt {
  const attempt = value as IntakeAttempt | null;
  if (!attempt || attempt.schema_version !== 1 || !attempt.signal ||
    attempt.attempt_id !== intakeAttemptId(attempt.signal) ||
    !Object.hasOwn(transitions, attempt.state) || !Number.isSafeInteger(attempt.revision) || attempt.revision < 0 ||
    !["automation", "customer", "internal", "none"].includes(attempt.owner) ||
    (attempt.reason !== null && !Object.hasOwn(intakeFailures, attempt.reason))) {
    throw new Error("Invalid persisted intake attempt");
  }
  if (timestamp(attempt.updated_at) < timestamp(attempt.created_at)) throw new Error("Invalid persisted intake clock");
  timestamp(attempt.signal.observed_at);
  if (attempt.created_at !== attempt.signal.observed_at) throw new Error("Invalid persisted intake creation time");
  if (attempt.next_action_at !== null) timestamp(attempt.next_action_at);
  const closed = ["confirmed", "superseded", "withdrawn"].includes(attempt.state);
  const owner = closed ? "none" : attempt.state === "customer_action_required" ? "customer" : ["internal_action_required", "manual_review"].includes(attempt.state) ? "internal" : "automation";
  if (attempt.owner !== owner) throw new Error("Invalid persisted intake owner");
  if (closed ? attempt.next_action_at !== null : !attempt.next_action_at) throw new Error("Invalid persisted intake deadline");
  if (attempt.next_action_at && timestamp(attempt.next_action_at) < timestamp(attempt.created_at)) throw new Error("Invalid persisted intake deadline");
  for (const value of [attempt.job_id, attempt.submit_attempt_id, attempt.confirmed_order_number, attempt.writeback_id, attempt.superseded_by]) {
    if (value !== null) required(value);
  }
  if (attempt.state === "customer_action_required" && (!attempt.reason || intakeFailures[attempt.reason] !== "customer")) throw new Error("Invalid persisted customer reason");
  if (attempt.state === "internal_action_required" && (!attempt.reason || intakeFailures[attempt.reason] !== "internal")) throw new Error("Invalid persisted internal reason");
  if (attempt.reason && !["customer_action_required", "internal_action_required", "manual_review", "reconciling"].includes(attempt.state)) throw new Error("Invalid persisted intake reason");
  if (attempt.state === "ready" && !attempt.job_id) throw new Error("Invalid persisted ready association");
  if (attempt.submit_attempt_id && (!attempt.job_id || !["reconciling", "confirmed", "internal_action_required", "manual_review"].includes(attempt.state))) throw new Error("Invalid persisted submit association");
  if (attempt.state === "reconciling" && (!attempt.job_id || !attempt.submit_attempt_id)) throw new Error("Invalid persisted reconciliation association");
  if ((attempt.state === "confirmed" || attempt.confirmed_order_number) && (!attempt.job_id || !attempt.submit_attempt_id || !attempt.confirmed_order_number || !["confirmed", "internal_action_required", "manual_review"].includes(attempt.state))) throw new Error("Invalid persisted confirmation association");
  if (attempt.writeback_id && !attempt.confirmed_order_number) throw new Error("Invalid persisted writeback association");
  if (attempt.state === "superseded" ? !attempt.superseded_by || attempt.superseded_by === attempt.attempt_id : attempt.superseded_by !== null) throw new Error("Invalid persisted supersession");
  if (attempt.state === "received" && [attempt.job_id, attempt.submit_attempt_id, attempt.confirmed_order_number, attempt.writeback_id, attempt.superseded_by].some(value => value !== null)) throw new Error("Invalid persisted received association");
  if (attempt.revision === 0) {
    if (attempt.last_event !== null || attempt.state !== "received" || attempt.updated_at !== attempt.created_at) throw new Error("Invalid persisted initial intake");
  } else {
    const event = attempt.last_event;
    if (!event || event.expected_revision !== attempt.revision - 1 || event.state !== attempt.state || event.reason !== attempt.reason ||
      event.occurred_at !== attempt.updated_at || event.next_action_at !== attempt.next_action_at || !event.projection ||
      projectionFields.some(key => event.projection[key] !== attempt[key])) throw new Error("Invalid persisted intake event projection");
    required(event.event_id);
    for (const key of ["job_id", "submit_attempt_id", "confirmed_order_number", "writeback_id", "superseded_by"] as const) {
      if (event[key] !== undefined && event[key] !== attempt[key]) throw new Error("Invalid persisted intake event association");
    }
  }
  return attempt;
}
export function transitionIntake(attempt: IntakeAttempt, event: IntakeEvent): IntakeAttempt {
  validatePersistedIntakeAttempt(attempt);
  required(event.event_id);
  if (attempt.last_event?.event_id === event.event_id) {
    if (eventDigest(attempt.last_event) !== eventDigest(event)) throw new Error("Intake event identity conflict");
    return attempt;
  }
  if (event.expected_revision !== attempt.revision) throw new Error("Intake revision conflict");
  const updatesUnresolvedState = event.state === attempt.state && !["confirmed", "superseded", "withdrawn"].includes(attempt.state);
  if (!updatesUnresolvedState && !transitions[attempt.state].includes(event.state)) throw new Error("Unsafe intake transition");
  if (timestamp(event.occurred_at) < timestamp(attempt.updated_at)) throw new Error("Intake clock regression");
  if (event.reason !== null && !Object.hasOwn(intakeFailures, event.reason)) throw new Error("Unknown intake failure");
  const closed = ["confirmed", "superseded", "withdrawn"].includes(event.state);
  if (closed ? event.next_action_at !== null : !event.next_action_at) throw new Error("Intake deadline required for unresolved work only");
  if (event.next_action_at && event.next_action_at !== attempt.next_action_at && timestamp(event.next_action_at) < timestamp(event.occurred_at)) throw new Error("Intake deadline in past");
  const jobId = event.job_id === undefined ? attempt.job_id : required(event.job_id);
  const submitId = event.submit_attempt_id === undefined ? attempt.submit_attempt_id : required(event.submit_attempt_id);
  const orderNumber = event.confirmed_order_number === undefined ? attempt.confirmed_order_number : required(event.confirmed_order_number);
  const writebackId = event.writeback_id === undefined ? attempt.writeback_id : required(event.writeback_id);
  for (const [current, next] of [[attempt.job_id, jobId], [attempt.submit_attempt_id, submitId], [attempt.confirmed_order_number, orderNumber], [attempt.writeback_id, writebackId]]) {
    if (current && current !== next) throw new Error("Intake association is immutable");
  }
  if (submitId && ["preparing", "ready", "customer_action_required", "superseded", "withdrawn"].includes(event.state)) {
    throw new Error("Submission must reconcile without blind resubmission or closure");
  }
  if (event.state === "ready" && !jobId) throw new Error("Ready intake requires a durable job");
  if (event.state === "reconciling" && (!jobId || !submitId)) throw new Error("Reconciliation requires existing submit ledger");
  if (event.state === "confirmed" && (!jobId || !submitId || !orderNumber || event.reason)) throw new Error("Confirmation requires durable association");
  if (event.confirmed_order_number && event.state !== "confirmed") throw new Error("Order association requires confirmation");
  if (event.writeback_id && !orderNumber) throw new Error("Success feedback requires a confirmed order");
  if (event.state === "customer_action_required" && (!event.reason || intakeFailures[event.reason] !== "customer")) throw new Error("Customer action requires a safe customer reason");
  if (event.state === "internal_action_required" && (!event.reason || intakeFailures[event.reason] !== "internal")) throw new Error("Internal action requires an internal reason");
  if (event.reason && !["customer_action_required", "internal_action_required", "manual_review", "reconciling"].includes(event.state)) throw new Error("Unexpected intake failure");
  if (event.state === "superseded" && (!event.superseded_by || event.superseded_by === attempt.attempt_id)) throw new Error("Supersession requires a different durable attempt");
  if (event.superseded_by && event.state !== "superseded") throw new Error("Unexpected supersession");
  const next: IntakeAttempt = { ...attempt, revision: attempt.revision + 1, state: event.state,
    owner: closed ? "none" : event.state === "customer_action_required" ? "customer" :
      ["internal_action_required", "manual_review"].includes(event.state) ? "internal" : "automation",
    reason: event.reason, updated_at: event.occurred_at, next_action_at: event.next_action_at,
    job_id: jobId, submit_attempt_id: submitId, confirmed_order_number: orderNumber,
    writeback_id: writebackId,
    superseded_by: event.superseded_by ?? attempt.superseded_by, last_event: null
  };
  next.last_event = { ...event, projection: intakeProjection(next) };
  return validatePersistedIntakeAttempt(next);
}
export interface IntakeLedger {
  reserve(signal: IntakeSignal, nextActionAt: string): Promise<{ attempt: IntakeAttempt; created: boolean }>;
  get(customerId: string, attemptId: string): Promise<IntakeAttempt | null>;
  transition(customerId: string, attemptId: string, event: IntakeEvent): Promise<IntakeAttempt>;
}
/** Adapters must return references to existing ledgers; this core never submits an order. */
export interface IntakeSourceAdapter {
  discover(): AsyncIterable<IntakeSignal>;
  prepare(attempt: IntakeAttempt): Promise<{ job_id: string }>;
}
export interface IntakeTargetAdapter {
  reconcile(attempt: IntakeAttempt): Promise<{
    /** Reference to the existing submit-attempt ledger, never a replacement transport record. */
    submit_attempt_id: string;
    confirmed_order_number: string | null;
  }>;
}
export interface IntakeSourceFeedback {
  deliver(attempt: IntakeAttempt, deduplicationKey: string): Promise<{
    provider: string;
    /** Wrike adapters return the existing Wrike writeback ledger's record ID. */
    writeback_id: string;
  }>;
}
export interface IntakeInternalNotification {
  deliver(message: TransactionalEmail, deduplicationKey: string): Promise<TransactionalEmailResult>;
}
export const initialIntakeNotificationRecipient = "pathfinder@vornan.co";
export const intakeAssurancePosture = Object.freeze({ capture_enabled: false, source_feedback_enabled: false,
  internal_notifications_enabled: false, watchdog_enabled: false });
export function intakeEffectKey(attempt: IntakeAttempt, effect: "source_feedback" | "internal_notification" | "status_link_repair") {
  return digest([attempt.attempt_id, attempt.revision, effect]);
}
export function intakeWatchdog(attempt: IntakeAttempt, now: string) {
  const overdue = attempt.next_action_at !== null && timestamp(now) >= timestamp(attempt.next_action_at);
  const repair = Boolean(attempt.confirmed_order_number && !attempt.writeback_id);
  return { overdue, status_link_repair_required: repair,
    internal_action_required: overdue || repair, deduplication_key: intakeEffectKey(attempt, repair ? "status_link_repair" : "internal_notification") };
}
/** Reserve must finish before invoking evidence parsing or any job creation. Replays are watchdog-owned. */
export async function reserveThenPrepare(ledger: IntakeLedger, signal: IntakeSignal, deadline: string,
  prepare: IntakeSourceAdapter["prepare"]) {
  const reservation = await ledger.reserve(signal, deadline);
  if (!reservation.created) return reservation;
  const attempt = await ledger.transition(signal.customer_id, reservation.attempt.attempt_id, {
    event_id: `${reservation.attempt.attempt_id}:prepare`, expected_revision: 0,
    occurred_at: signal.observed_at, state: "preparing", reason: null, next_action_at: deadline
  });
  let result: { job_id: string };
  try {
    result = await prepare(attempt);
  } catch (error) {
    const reason = error instanceof IntakePreparationError ? error.reason : "pathfinder_failure";
    await ledger.transition(signal.customer_id, attempt.attempt_id, {
      event_id: `${attempt.attempt_id}:prepare-failed`, expected_revision: attempt.revision,
      occurred_at: signal.observed_at,
      state: intakeFailures[reason] === "customer" ? "customer_action_required" : "internal_action_required",
      reason, next_action_at: deadline
    });
    throw error;
  }
  return { created: true, attempt: await ledger.transition(signal.customer_id, attempt.attempt_id, {
    event_id: `${attempt.attempt_id}:prepared`, expected_revision: attempt.revision,
    occurred_at: signal.observed_at, state: "ready", reason: null, job_id: result.job_id, next_action_at: deadline
  }) };
}

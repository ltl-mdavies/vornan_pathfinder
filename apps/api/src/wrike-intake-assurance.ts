import type { WrikeScopedIntakeDiscoveryResult } from "@pathfinder/wrike-adapter";
import { intakeAttemptId, type IntakeAttempt, type IntakeFailure, type IntakeLedger, type IntakeSignal, type IntakeState } from "./intake-assurance.js";
import type { ProcessingJobPreview, SubmitAttempt } from "./store.js";

export interface WrikeAssuranceScope {
  customer_id: string;
  connection_id: string;
  import_method_id: string;
  /** Exact label must be resolved against production configuration before wiring. */
  approved_status_label: string;
  configured_status_label: string;
  configured_status_id: string;
}
export interface WrikeIntentCandidate { signal: IntakeSignal; prequalification_reason: IntakeFailure | null }
/** Consumes existing read-only discovery, including rejected prequalification. No provider reads. */
export function wrikeIntakeIntentCandidates(scope: WrikeAssuranceScope, discovery: Pick<WrikeScopedIntakeDiscoveryResult,
  "checked_at" | "order_candidates" | "pending_order_candidates" | "summary">): WrikeIntentCandidate[] {
  if (!scope.import_method_id.trim() || !scope.approved_status_label.trim() ||
    scope.configured_status_label !== scope.approved_status_label || !scope.configured_status_id ||
    discovery.summary.resolved_order_status_ids.length !== 1 ||
    discovery.summary.resolved_order_status_ids[0] !== scope.configured_status_id) {
    throw new Error("Wrike assurance intent boundary is not exact and verified");
  }
  const candidates = new Map<string, WrikeIntentCandidate>();
  const add = (taskId: string, reason: IntakeFailure | null) => {
    const signal: IntakeSignal = { schema_version: 1, customer_id: scope.customer_id, provider: "wrike",
      connection_id: scope.connection_id, source_id: taskId, intent_key: scope.approved_status_label,
      intent_occurrence: "initial", observed_at: discovery.checked_at };
    const id = intakeAttemptId(signal);
    const existing = candidates.get(id);
    if (existing && existing.prequalification_reason !== reason) throw new Error("Contradictory Wrike discovery evidence");
    candidates.set(id, { signal, prequalification_reason: reason });
  };
  for (const task of discovery.order_candidates) {
    if (task.custom_status_id === scope.configured_status_id) add(task.task_id, null);
  }
  for (const task of discovery.pending_order_candidates) {
    if (!task.identity_matches || task.custom_status_id !== scope.configured_status_id) continue;
    // Discovery's contract reason conflates customer data and missing method
    // configuration. It is unsafe to instruct the customer from this code alone.
    const reason = task.reasons.some((entry) => entry.code === "contract_number") ? "pathfinder_failure" : "missing_required_data";
    add(task.task_id, reason);
  }
  return [...candidates.values()].sort((left, right) => left.signal.source_id.localeCompare(right.signal.source_id));
}
/** Capture-only seam. Never prepares evidence or mutates the existing discovery result. */
export async function captureWrikeIntakeIntents(args: {
  enabled: boolean;
  scope: WrikeAssuranceScope;
  discovery: Parameters<typeof wrikeIntakeIntentCandidates>[1];
  ledger: IntakeLedger;
  next_action_at: string;
  max_candidates: number;
}) {
  if (!args.enabled) return { status: "disabled" as const, created: 0, replayed: 0 };
  if (!Number.isInteger(args.max_candidates) || args.max_candidates < 1 || args.max_candidates > 1000) throw new Error("Invalid assurance capture limit");
  const candidates = wrikeIntakeIntentCandidates(args.scope, args.discovery);
  if (candidates.length > args.max_candidates) throw new Error("Wrike assurance capture limit exceeded; no intents captured");
  let created = 0;
  for (const candidate of candidates) {
    const result = await args.ledger.reserve(candidate.signal, args.next_action_at);
    if (result.created) created++;
    if (candidate.prequalification_reason && result.attempt.state === "received") {
      const reason = candidate.prequalification_reason;
      await args.ledger.transition(args.scope.customer_id, result.attempt.attempt_id, {
        event_id: `${result.attempt.attempt_id}:prequalification`, expected_revision: result.attempt.revision,
        occurred_at: args.discovery.checked_at, next_action_at: args.next_action_at,
        state: reason === "pathfinder_failure" ? "internal_action_required" : "customer_action_required", reason
      });
    }
  }
  return { status: "captured" as const, created, replayed: candidates.length - created };
}

type AssuranceJob = Pick<ProcessingJobPreview, "customer_id" | "job_id" | "import_method_id" | "source_evidence" |
  "target_order_number" | "state" | "target_order_association_history" | "wrike_status_writebacks" | "lift_payload">;
export interface WrikeAssuranceOutcome {
  state: IntakeState;
  reason: IntakeFailure | null;
  job_id: string | null;
  submit_attempt_id: string | null;
  confirmed_order_number: string | null;
  writeback_id: string | null;
  repair: "none" | "existing_success_writeback" | "manual_review";
}
/** Projects authoritative existing ledgers. Never looks up or submits an order. */
export function projectWrikeAssuranceOutcome(args: {
  attempt: IntakeAttempt; import_method_id: string; jobs: AssuranceJob[]; submits: SubmitAttempt[];
}): WrikeAssuranceOutcome {
  const empty: WrikeAssuranceOutcome = { state: args.attempt.state, reason: args.attempt.reason,
    job_id: args.attempt.job_id, submit_attempt_id: args.attempt.submit_attempt_id,
    confirmed_order_number: args.attempt.confirmed_order_number, writeback_id: args.attempt.writeback_id, repair: "none" };
  if (args.attempt.signal.provider !== "wrike") throw new Error("Wrike assurance provider mismatch");
  const jobs = args.jobs.filter((job) => job.customer_id === args.attempt.signal.customer_id &&
    job.import_method_id === args.import_method_id && job.source_evidence?.provider === "wrike" &&
    job.source_evidence.task_id === args.attempt.signal.source_id &&
    job.source_evidence.connection_id === args.attempt.signal.connection_id);
  if (!jobs.length) return args.attempt.job_id ? { ...empty, state: "internal_action_required", reason: "pathfinder_failure", repair: "manual_review" } : empty;
  if (jobs.length !== 1) return { ...empty, state: "manual_review", reason: "reconciliation_ambiguity", repair: "manual_review" };
  const job = jobs[0]!;
  const linked = { ...empty, job_id: job.job_id };
  if (args.attempt.job_id && args.attempt.job_id !== job.job_id) return { ...linked, state: "manual_review", reason: "reconciliation_ambiguity", repair: "manual_review" };
  const submits = args.submits.filter((submit) => submit.customer_id === job.customer_id && submit.job_id === job.job_id && !["Blocked", "Gate Locked"].includes(submit.state));
  if (submits.length > 1) return { ...linked, state: "manual_review", reason: "reconciliation_ambiguity", repair: "manual_review" };
  const submit = submits[0];
  if (!submit) return { ...linked, state: job.target_order_number ? "manual_review" : job.state === "Needs Mapping" ? "customer_action_required" : job.state === "Ready" ? "ready" : "internal_action_required",
    reason: job.target_order_number ? "reconciliation_ambiguity" : job.state === "Needs Mapping" ? "unmapped_product" : job.state === "Ready" ? null : "pathfinder_failure",
    repair: job.target_order_number ? "manual_review" : "none" };
  const transport = { ...linked, submit_attempt_id: submit.attempt_id };
  if (submit.transport_mode !== "live" || !submit.external_submit_enabled || !submit.ext_id || submit.ext_id !== job.lift_payload.order.ext_id ||
    (args.attempt.submit_attempt_id && args.attempt.submit_attempt_id !== submit.attempt_id)) {
    return { ...transport, state: "manual_review", reason: "reconciliation_ambiguity", repair: "manual_review" };
  }
  const order = job.target_order_number?.trim();
  const association = job.target_order_association_history?.at(-1);
  const verifiedReconciliation = association?.source === "scheduled_uncertain_reconciliation" &&
    association.order_number === order && association.verification.order_number === order &&
    association.verification.external_order_id === submit.ext_id &&
    association.verification.submit_attempt_id === submit.attempt_id &&
    Boolean(submit.request_fingerprint) && association.verification.request_fingerprint === submit.request_fingerprint &&
    association.verification.company_id === submit.company_id;
  const directConfirmation = submit.state === "Submitted" && submit.response.status === "accepted" && submit.response.lift_order_id === order;
  if (order && (directConfirmation || verifiedReconciliation)) {
    if (args.attempt.confirmed_order_number && args.attempt.confirmed_order_number !== order) return { ...transport, state: "manual_review", reason: "reconciliation_ambiguity", repair: "manual_review" };
    const base = { ...transport, confirmed_order_number: order };
    const writebacks = (job.wrike_status_writebacks ?? []).filter((entry) => entry.task_id === args.attempt.signal.source_id && entry.connection_id === args.attempt.signal.connection_id && entry.order_number === order);
    const posted = writebacks.find((entry) => entry.state === "posted" && entry.comment_id && entry.status_url_sha256 && entry.posted_at);
    if (posted) return { ...base, state: "confirmed", reason: null, writeback_id: posted.writeback_id, repair: "none" };
    if (association?.automatic_wrike_status_writeback_suppressed || writebacks.some((entry) => entry.state === "submission_uncertain" || entry.state === "prepared")) {
      return { ...base, state: "internal_action_required", reason: "success_writeback_missing", repair: "manual_review" };
    }
    return { ...base, state: "internal_action_required", reason: writebacks.some((entry) => entry.state === "failed") ? "success_writeback_failed" : "success_writeback_missing", repair: "existing_success_writeback" };
  }
  if (order) return { ...transport, state: "manual_review", reason: "reconciliation_ambiguity", repair: "manual_review" };
  if (submit.state === "Submission Uncertain" || submit.state === "Submitted") return { ...transport, state: "reconciling", reason: "submission_timeout" };
  const category = submit.response.error_translation?.category;
  return { ...transport, state: "internal_action_required", reason: category === "duplicate_order_name" ? "duplicate_order_name" : category === "duplicate_ext_id" ? "duplicate_ext_id" : "lift_failure" };
}

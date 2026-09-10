import type { createSharedWrikeCapture, SharedWrikeCaptureResult } from "./wrike-shared-capture.js";
import { WRIKE_ORDER_INTENT_LABEL } from "@pathfinder/wrike-adapter";
import { intakeAttemptId, type IntakeAttempt, type IntakeEvent, type IntakeLedger } from "./intake-assurance.js";
import { captureWrikeIntakeIntents, projectWrikeAssuranceOutcome, wrikeIntakeIntentCandidates,
  type WrikeAssuranceOutcome, type WrikeAssuranceScope } from "./wrike-intake-assurance.js";
import type { WrikeScopedIntakeDiscoveryResult } from "@pathfinder/wrike-adapter";

export interface WrikeAssuranceCaptureConfig { enabled: boolean; customer_id: string; import_method_id: string; sla_seconds: number; max_candidates: number }
export function getWrikeAssuranceCaptureConfig(environment: NodeJS.ProcessEnv, scheduled: { customer_id: string; import_method_id: string }): WrikeAssuranceCaptureConfig {
  const disabled = { enabled: false, customer_id: "", import_method_id: "", sla_seconds: 0, max_candidates: 0 };
  if (environment.PATHFINDER_ENABLE_INTAKE_ASSURANCE_CAPTURE !== "true") return disabled;
  const customer = environment.PATHFINDER_INTAKE_ASSURANCE_CUSTOMER_ID ?? "";
  const method = environment.PATHFINDER_INTAKE_ASSURANCE_IMPORT_METHOD_ID ?? "";
  const sla = Number(environment.PATHFINDER_INTAKE_ASSURANCE_SLA_SECONDS);
  const max = Number(environment.PATHFINDER_INTAKE_ASSURANCE_MAX_CANDIDATES);
  if (!customer || !method || customer !== scheduled.customer_id || method !== scheduled.import_method_id ||
    !Number.isInteger(sla) || sla < 60 || sla > 604800 || !Number.isInteger(max) || max < 1 || max > 1000) {
    throw new Error("Intake assurance capture requires an exact scheduled scope and explicit bounded SLA and candidate limits");
  }
  return { enabled: true, customer_id: customer, import_method_id: method, sla_seconds: sla, max_candidates: max };
}
function deadline(now: string, config: WrikeAssuranceCaptureConfig) {
  return new Date(Date.parse(now) + config.sla_seconds * 1000).toISOString();
}
/** Applies only observations from authoritative existing ledgers. No parsing or transport dependency exists here. */
export async function applyWrikeAssuranceObservation(args: {
  ledger: IntakeLedger; attempt: IntakeAttempt; outcome: WrikeAssuranceOutcome; now: string; next_action_at: string;
}) {
  let current = args.attempt;
  if (current.signal.intent_occurrence.startsWith("wrike-intent_") && current.state === "manual_review") return current;
  if (["withdrawn", "superseded"].includes(current.state)) return current;
  async function set(state: IntakeEvent["state"], reason: IntakeEvent["reason"], links: Partial<IntakeEvent> = {}) {
    const values = { job_id: links.job_id ?? current.job_id, submit_attempt_id: links.submit_attempt_id ?? current.submit_attempt_id,
      confirmed_order_number: links.confirmed_order_number ?? current.confirmed_order_number, writeback_id: links.writeback_id ?? current.writeback_id };
    if (current.state === state && current.reason === reason && Object.entries(values).every(([key, value]) => current[key as keyof IntakeAttempt] === value)) return;
    current = await args.ledger.transition(current.signal.customer_id, current.attempt_id, {
      event_id: `${current.attempt_id}:observation:${current.revision + 1}`, expected_revision: current.revision,
      occurred_at: args.now, state, reason,
      next_action_at: state === "confirmed" ? null : current.next_action_at ?? args.next_action_at, ...links
    });
  }
  const outcome = args.outcome;
  if (current.confirmed_order_number && !["confirmed", "internal_action_required", "manual_review"].includes(outcome.state)) {
    await set("internal_action_required", "reconciliation_ambiguity");
    return current;
  }
  const conflict = (current.job_id && outcome.job_id && current.job_id !== outcome.job_id) ||
    (current.submit_attempt_id && outcome.submit_attempt_id && current.submit_attempt_id !== outcome.submit_attempt_id) ||
    (current.confirmed_order_number && outcome.confirmed_order_number && current.confirmed_order_number !== outcome.confirmed_order_number);
  if (conflict || outcome.state === "manual_review") {
    await set(current.state === "confirmed" ? "internal_action_required" : "manual_review", "reconciliation_ambiguity");
    return current;
  }
  const jobLink = outcome.job_id ? { job_id: outcome.job_id } : {};
  if (outcome.submit_attempt_id && !current.submit_attempt_id) {
    if (["received", "customer_action_required"].includes(current.state)) await set("preparing", null, jobLink);
    if (current.state === "preparing") await set("ready", null, jobLink);
    await set("reconciling", null, { ...jobLink, submit_attempt_id: outcome.submit_attempt_id });
  }
  if (outcome.confirmed_order_number && !current.confirmed_order_number) {
    await set("confirmed", null, { ...jobLink, confirmed_order_number: outcome.confirmed_order_number,
      ...(outcome.writeback_id ? { writeback_id: outcome.writeback_id } : {}) });
  }
  if (outcome.state === "ready" && ["received", "customer_action_required", "internal_action_required", "manual_review"].includes(current.state)) await set("preparing", null, jobLink);
  await set(outcome.state, outcome.reason, { ...jobLink, ...(outcome.writeback_id ? { writeback_id: outcome.writeback_id } : {}) });
  return current;
}

export function createWrikeAssuranceCycle(args: {
  config: WrikeAssuranceCaptureConfig; ledger: IntakeLedger;
  sharedCapture?: ReturnType<typeof createSharedWrikeCapture>;
  now?: () => Date;
}) {
  let captured: { scope: WrikeAssuranceScope; discovery: WrikeScopedIntakeDiscoveryResult; candidates: SharedWrikeCaptureResult[] } | null = null;
  const now = () => (args.now ?? (() => new Date()))().toISOString();
  return {
    async capture(scope: Omit<WrikeAssuranceScope, "approved_status_label">, discovery: WrikeScopedIntakeDiscoveryResult) {
      if (!args.config.enabled) return;
      if (scope.customer_id !== args.config.customer_id || scope.import_method_id !== args.config.import_method_id) throw new Error("Assurance cycle scope mismatch");
      const approvedScope = { ...scope, approved_status_label: WRIKE_ORDER_INTENT_LABEL };
      if (args.sharedCapture) {
        const candidates = await args.sharedCapture(approvedScope, discovery, args.config.sla_seconds, args.config.max_candidates);
        captured = { scope: approvedScope, discovery, candidates };
      } else {
        await captureWrikeIntakeIntents({ enabled: true, scope: approvedScope, discovery, ledger: args.ledger,
          next_action_at: deadline(discovery.checked_at, args.config), max_candidates: args.config.max_candidates });
        captured = { scope: approvedScope, discovery, candidates: wrikeIntakeIntentCandidates(approvedScope, discovery).map(candidate => ({ ...candidate, preparation_allowed: true })) };
      }

    },
    assertPreparationAllowed(taskId: string) {
      if (args.sharedCapture && !captured?.candidates.some(candidate => candidate.signal.source_id === taskId && candidate.preparation_allowed)) {
        throw new Error("Wrike intake requires manual review before preparation");
      }
    },
    async preparationFailed(taskId: string) {
      if (!captured) return;
      const candidate = captured.candidates.find((entry) => entry.signal.source_id === taskId);
      if (!candidate) throw new Error("Preparation lacks a captured intake intent");
      if (!candidate.preparation_allowed) return;
      const attempt = await args.ledger.get(candidate.signal.customer_id, intakeAttemptId(candidate.signal));
      if (!attempt) throw new Error("Captured intake attempt disappeared");
      if (attempt.submit_attempt_id || attempt.confirmed_order_number || ["withdrawn", "superseded"].includes(attempt.state)) return;
      await applyWrikeAssuranceObservation({ ledger: args.ledger, attempt, now: now(), next_action_at: deadline(now(), args.config),
        outcome: { state: "internal_action_required", reason: "pathfinder_failure", job_id: attempt.job_id,
          submit_attempt_id: null, confirmed_order_number: null, writeback_id: null, repair: "none" } });
    },
    async observe(snapshot: Omit<Parameters<typeof projectWrikeAssuranceOutcome>[0], "attempt" | "import_method_id">) {
      if (!captured) return;
      for (const candidate of captured.candidates) {
        if (!candidate.preparation_allowed) continue;
        const attempt = await args.ledger.get(candidate.signal.customer_id, intakeAttemptId(candidate.signal));
        if (!attempt) throw new Error("Captured intake attempt disappeared");
        const outcome = projectWrikeAssuranceOutcome({ ...snapshot, attempt, import_method_id: captured.scope.import_method_id });
        await applyWrikeAssuranceObservation({ ledger: args.ledger, attempt, outcome, now: now(), next_action_at: deadline(now(), args.config) });
      }
    }
  };
}

/** The disabled path returns the original callback unchanged. */
export function wrapWrikeAssurancePreparation<T extends { task_id: string }, R>(
  cycle: Pick<ReturnType<typeof createWrikeAssuranceCycle>, "preparationFailed" | "assertPreparationAllowed"> | null,
  prepare: (candidate: T) => Promise<R>
): (candidate: T) => Promise<R> {
  if (!cycle) return prepare;
  return async (candidate) => {
    cycle.assertPreparationAllowed(candidate.task_id);
    try { return await prepare(candidate); }
    catch (error) { await cycle.preparationFailed(candidate.task_id); throw error; }
  };
}

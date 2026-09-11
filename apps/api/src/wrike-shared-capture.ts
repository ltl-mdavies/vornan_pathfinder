import { intakeAttemptId, type IntakeLedger, type IntakeSignal } from "./intake-assurance.js";
import { observeWrikeIntent, wrikeIntentSignal, type WrikeIntentCursor, type WrikeIntentScope, type WrikeIntentObservation } from "./wrike-intent-observation.js";
import { wrikeIntakeIntentCandidates, type WrikeAssuranceScope } from "./wrike-intake-assurance.js";
import type { WrikeScopedIntakeDiscoveryResult } from "@pathfinder/wrike-adapter";
import type { readIntakeRecoverySnapshot, reserveWrikeCursorAttempt } from "./store.js";

export interface SharedWrikeCaptureResult { signal: IntakeSignal; preparation_allowed: boolean }
export function createSharedWrikeCapture(deps: {
  ledger: IntakeLedger;
  record: (scope: WrikeIntentScope, observation: WrikeIntentObservation) => Promise<WrikeIntentCursor>;
  reserve: typeof reserveWrikeCursorAttempt;
  snapshot: (customerId: string) => ReturnType<typeof readIntakeRecoverySnapshot>;
}) {
  return async (scope: WrikeAssuranceScope, discovery: WrikeScopedIntakeDiscoveryResult, slaSeconds: number, maxCandidates: number): Promise<SharedWrikeCaptureResult[]> => {
    // Validates the canonical label aliases and exact configured/provider status ID.
    wrikeIntakeIntentCandidates(scope, discovery);
    if (!Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 1000 ||
      !Number.isInteger(slaSeconds) || slaSeconds < 60 || slaSeconds > 604800) throw new Error("Invalid shared capture bounds");
    const tasks = [...discovery.order_candidates.map(task => ({ ...task, identity_matches: true, reasons: [] })), ...discovery.pending_order_candidates]
      .filter(task => task.identity_matches && (task.custom_status_id === scope.configured_status_id || task.reasons.every(reason => reason.code === "trigger_status")));
    if (tasks.length > maxCandidates) throw new Error("Shared capture observation limit exceeded");
    const observations = new Map<string, { scope: WrikeIntentScope; observation: WrikeIntentObservation; qualified: boolean }>();
    for (const task of tasks) {
      if (!task.root_folder_ids?.length || !task.account_id || !task.updated_at) throw new Error("Shared capture requires complete scoped task metadata");
      const identity = { customer_id: scope.customer_id, connection_id: scope.connection_id, import_method_id: scope.import_method_id,
        task_id: task.task_id, trigger_status_id: scope.configured_status_id };
      const observation = { task_id: task.task_id, custom_status_id: task.custom_status_id, source_updated_at: task.updated_at,
        observed_at: discovery.checked_at, scope_verified: true, identity_matches: true };
      observeWrikeIntent(null, identity, observation); // Validate the entire batch before any writes.
      if (observations.has(task.task_id)) throw new Error("Ambiguous duplicate Wrike task observation");
      observations.set(task.task_id, { scope: identity, observation, qualified: task.reasons.length === 0 });
    }
    const results: SharedWrikeCaptureResult[] = [];
    for (const row of observations.values()) {
      const cursor = await deps.record(row.scope, row.observation);
      if (!cursor.in_intent) continue;
      const signal = wrikeIntentSignal(cursor)!;
      const current = await deps.ledger.get(scope.customer_id, cursor.attempt_id!);
      const legacy = await deps.ledger.get(scope.customer_id, intakeAttemptId({ ...signal, intent_occurrence: "initial" }));
      const snapshot = await deps.snapshot(scope.customer_id);
      const jobs = snapshot.jobs.filter(job => job.customer_id === scope.customer_id && job.source_evidence?.provider === "wrike" &&
        job.source_evidence.task_id === signal.source_id);
      const review = !cursor.entry_proven || !row.qualified || cursor.generation > 1 || !!legacy || current?.state === "manual_review" || jobs.length > 1 ||
        jobs.some(job => job.source_evidence?.connection_id !== scope.connection_id || job.import_method_id !== scope.import_method_id || job.job_id !== current?.job_id || !!job.target_order_number || !!job.wrike_status_writebacks?.length || !!job.target_order_association_history?.length ||
          snapshot.submits.some(submit => submit.customer_id === scope.customer_id && submit.job_id === job.job_id));
      const deadline = new Date(Date.parse(signal.observed_at) + slaSeconds * 1000).toISOString();
      const attempt = await deps.reserve(cursor, deadline, review);
      results.push({ signal, preparation_allowed: !review && !attempt.submit_attempt_id && !attempt.confirmed_order_number &&
        !["confirmed", "withdrawn", "superseded", "manual_review"].includes(attempt.state) });
    }
    return results;
  };
}

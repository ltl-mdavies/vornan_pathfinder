import type { IntakeLedger } from "./intake-assurance.js";
import type { IntakeSweepScope } from "./intake-recovery-sweep.js";
import type { readIntakeRecoverySnapshot } from "./store.js";
import { projectWrikeAssuranceOutcome } from "./wrike-intake-assurance.js";
import { applyWrikeAssuranceObservation } from "./wrike-assurance-coordinator.js";
export interface IntakeStatusRepairTarget { customer_id: string; job_id: string; task_id: string; connection_id: string; order_number: string }
/** Existing writeback ledger is the only send authority. No new comment receipt or Lift transport. */
export async function repairIntakeStatusLink(args: {
  enabled: boolean; scope: IntakeSweepScope; attempt_id: string; ledger: IntakeLedger;
  snapshot: () => ReturnType<typeof readIntakeRecoverySnapshot>;
  writeBack: (target: IntakeStatusRepairTarget) => Promise<{ reused: boolean }>;
  canRepair?: () => boolean; assertLease?: () => unknown; now?: () => Date; sla_seconds: number;
}) {
  if (!args.enabled) return { status: "disabled" as const };
  const attempt = await args.ledger.get(args.scope.customer_id, args.attempt_id);
  if (!attempt || ["withdrawn", "superseded"].includes(attempt.state) || attempt.signal.customer_id !== args.scope.customer_id || attempt.signal.provider !== "wrike" || attempt.signal.connection_id !== args.scope.connection_id) return { status: "blocked" as const };
  const snapshot = await args.snapshot();
  if (!Number.isFinite(Date.parse(snapshot.checked_at)) || Date.parse(attempt.updated_at) > Date.parse(snapshot.checked_at)) return { status: "blocked" as const };
  const outcome = projectWrikeAssuranceOutcome({ attempt, import_method_id: args.scope.import_method_id, jobs: snapshot.jobs, submits: snapshot.submits });
  if (outcome.repair !== "existing_success_writeback" || !outcome.job_id || !outcome.confirmed_order_number || !outcome.submit_attempt_id) return { status: "blocked" as const };
  const jobs = snapshot.jobs.filter(job => job.customer_id === args.scope.customer_id && job.source_evidence?.task_id === attempt.signal.source_id && job.source_evidence.connection_id === args.scope.connection_id);
  if (jobs.length !== 1 || jobs[0]!.job_id !== outcome.job_id || jobs[0]!.wrike_status_writebacks?.some(row => row.task_id === attempt.signal.source_id && row.order_number === outcome.confirmed_order_number)) return { status: "blocked" as const };
  if (args.canRepair && !args.canRepair()) return { status: "deferred" as const };
  const current = await args.ledger.get(args.scope.customer_id, args.attempt_id);
  if (!current || current.revision !== attempt.revision) return { status: "blocked" as const };
  args.assertLease?.();
  const result = await args.writeBack({ customer_id: args.scope.customer_id, job_id: outcome.job_id, task_id: attempt.signal.source_id, connection_id: args.scope.connection_id, order_number: outcome.confirmed_order_number });
  const refreshed = await args.snapshot();
  const latest = await args.ledger.get(args.scope.customer_id, args.attempt_id);
  if (latest && Date.parse(latest.updated_at) <= Date.parse(refreshed.checked_at)) {
    const now = (args.now ?? (() => new Date()))().toISOString();
    await applyWrikeAssuranceObservation({ ledger: args.ledger, attempt: latest, now, next_action_at: new Date(Date.parse(now) + args.sla_seconds * 1000).toISOString(),
      outcome: projectWrikeAssuranceOutcome({ attempt: latest, import_method_id: args.scope.import_method_id, jobs: refreshed.jobs, submits: refreshed.submits }) });
  }
  return { status: result.reused ? "replayed" as const : "repaired" as const };
}

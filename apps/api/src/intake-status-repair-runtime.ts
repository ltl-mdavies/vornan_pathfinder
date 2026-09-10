import { getIntakeSweepConfig, runIntakeRecoverySweep } from "./intake-recovery-sweep.js";
import { getWrikeScheduledIntakeConfig } from "./wrike-scheduled-intake.js";
import { intakeLedger, intakeSweepCheckpoints, fencedIntakeSweepLedger, listIntakeAttemptsPage, readIntakeRecoverySnapshot } from "./store.js";
import { repairIntakeStatusLink, type IntakeStatusRepairTarget } from "./intake-status-repair.js";
export function getIntakeStatusRepairConfig(env: NodeJS.ProcessEnv) {
  const enabled = env.PATHFINDER_ENABLE_INTAKE_STATUS_REPAIR === "true";
  const sweep = getIntakeSweepConfig({ ...env, PATHFINDER_ENABLE_INTAKE_ASSURANCE_SWEEP: String(enabled) });
  const maxRepairs = Number(env.PATHFINDER_INTAKE_STATUS_REPAIR_MAX);
  if (enabled) {
    const existing = getWrikeScheduledIntakeConfig(env);
    if (!existing.status_writeback_enabled || existing.customer_id !== sweep.scope.customer_id || existing.import_method_id !== sweep.scope.import_method_id ||
      !Number.isInteger(maxRepairs) || maxRepairs < 1 || maxRepairs > 50) throw new Error("Intake status repair requires existing scoped writeback permission and explicit limits");
  }
  return { sweep: { ...sweep, scope: { ...sweep.scope, purpose: "status_link_repair" as const } }, maxRepairs };
}
export function isIntakeStatusRepairEvent(event: unknown) {
  const row = event as { source?: unknown; "detail-type"?: unknown; detail?: { automation?: unknown } } | null;
  return !!row && row.source === "pathfinder.intake" && row["detail-type"] === "Intake Status Link Repair" && row.detail?.automation === "existing_success_writeback";
}
export async function runIntakeStatusRepairs(writeBack: (target: IntakeStatusRepairTarget) => Promise<{ reused: boolean }>) {
  const config = getIntakeStatusRepairConfig(process.env);
  const counts = { repairs_attempted: 0, repaired: 0, replayed: 0, blocked: 0, deferred: 0 };
  const result = await runIntakeRecoverySweep({ config: config.sweep, checkpoints: intakeSweepCheckpoints,
    list: listIntakeAttemptsPage, ledger: intakeLedger, fencedLedger: fencedIntakeSweepLedger,
    snapshot: async () => ({ checked_at: new Date().toISOString() }),
    observe: async (attempt, _snapshot, ledger, _now, fence) => {
      const outcome = await repairIntakeStatusLink({ enabled: true, scope: config.sweep.scope, attempt_id: attempt.attempt_id, ledger,
        snapshot: () => readIntakeRecoverySnapshot(config.sweep.scope.customer_id, config.sweep.snapshot_limit), sla_seconds: config.sweep.sla_seconds,
        assertLease: fence, canRepair: () => counts.repairs_attempted < config.maxRepairs,
        writeBack: target => { counts.repairs_attempted++; return writeBack(target); } });
      if (outcome.status in counts) counts[outcome.status as "repaired" | "replayed" | "blocked" | "deferred"]++;
    }
  });
  return { ...result, ...counts };
}

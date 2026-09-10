import { getIntakeSweepConfig, runIntakeRecoverySweep } from "./intake-recovery-sweep.js";
import { fencedIntakeSweepLedger, intakeLedger, intakeSweepCheckpoints, listIntakeAttemptsPage, readIntakeRecoverySnapshot } from "./store.js";
import { projectWrikeAssuranceOutcome } from "./wrike-intake-assurance.js";
import { applyWrikeAssuranceObservation } from "./wrike-assurance-coordinator.js";

/** Observation only: no discovery, submission, repair or notification transport. */
export async function runConfiguredIntakeRecoverySweep(env: NodeJS.ProcessEnv = process.env) {
  const config = getIntakeSweepConfig(env);
  return runIntakeRecoverySweep({ config, checkpoints: intakeSweepCheckpoints,
    list: listIntakeAttemptsPage, ledger: intakeLedger, fencedLedger: fencedIntakeSweepLedger,
    snapshot: () => readIntakeRecoverySnapshot(config.scope.customer_id, config.snapshot_limit),
    observe: (attempt, snapshot, ledger, now) => applyWrikeAssuranceObservation({ attempt, ledger, now,
      next_action_at: new Date(Date.parse(now) + config.sla_seconds * 1000).toISOString(),
      outcome: projectWrikeAssuranceOutcome({ attempt, import_method_id: config.scope.import_method_id,
        jobs: snapshot.jobs, submits: snapshot.submits }) })
  });
}

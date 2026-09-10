import { postWrikeTaskComment, type WrikeOAuthCredentials } from "@pathfinder/wrike-adapter";
import { getIntakeSweepConfig, runIntakeRecoverySweep } from "./intake-recovery-sweep.js";
import { dispatchWrikeIntakeFeedback } from "./wrike-intake-feedback.js";
import { intakeLedger, intakeDeliveryLedger, intakeSweepCheckpoints, fencedIntakeSweepLedger, listIntakeAttemptsPage, readIntakeRecoverySnapshot, readWrikeIntakeFeedbackScope } from "./store.js";
import { readCustomerSourceConnectionSecrets, writeCustomerSourceConnectionSecrets, type WrikeConnectorSecrets } from "./secrets-store.js";
export function getWrikeIntakeFeedbackConfig(env: NodeJS.ProcessEnv) {
  const enabled = env.PATHFINDER_ENABLE_WRIKE_INTAKE_FEEDBACK === "true";
  const sweep = getIntakeSweepConfig({ ...env, PATHFINDER_ENABLE_INTAKE_ASSURANCE_SWEEP: String(enabled) });
  const maxComments = Number(env.PATHFINDER_INTAKE_FEEDBACK_MAX_COMMENTS);
  if (enabled && (!Number.isInteger(maxComments) || maxComments < 1 || maxComments > 50)) throw new Error("Wrike intake feedback requires an explicit comment limit (1–50)");
  return { sweep: { ...sweep, scope: { ...sweep.scope, purpose: "source_feedback" as const } }, maxComments };
}
export function isWrikeIntakeFeedbackEvent(event: unknown) {
  const row = event as { source?: unknown; "detail-type"?: unknown; detail?: { automation?: unknown } } | null;
  return !!row && row.source === "pathfinder.intake" && row["detail-type"] === "Wrike Intake Feedback" && row.detail?.automation === "customer_correction";
}
export async function runConfiguredWrikeIntakeFeedback() {
  const config = getWrikeIntakeFeedbackConfig(process.env);
  const scope = config.sweep.scope;
  const counts = { comments_attempted: 0, sent: 0, uncertain: 0, blocked: 0, suppressed: 0, deferred: 0, conflict: 0 };
  const result = await runIntakeRecoverySweep({ config: config.sweep, checkpoints: intakeSweepCheckpoints,
    list: listIntakeAttemptsPage, ledger: intakeLedger, fencedLedger: fencedIntakeSweepLedger,
    snapshot: async () => ({ checked_at: new Date().toISOString() }),
    observe: async (attempt, _snapshot, _ledger, _now, fence) => {
      let savedSecrets: WrikeConnectorSecrets = {};
      const outcome = await dispatchWrikeIntakeFeedback({ enabled: true, scope, attempt_id: attempt.attempt_id, intake: intakeLedger, receipts: intakeDeliveryLedger, fence,
        canDispatch: () => counts.comments_attempted < config.maxComments,
        loadScope: () => readWrikeIntakeFeedbackScope(scope),
        snapshot: () => readIntakeRecoverySnapshot(scope.customer_id, config.sweep.snapshot_limit),
        loadCredentials: async () => {
          savedSecrets = (await readCustomerSourceConnectionSecrets(scope.customer_id, scope.connection_id)).wrike ?? {};
          const oauth = savedSecrets.oauth;
          if (!oauth?.client_id || !oauth.client_secret || !oauth.refresh_token || !oauth.host) throw new Error("Wrike feedback credentials are unavailable");
          return oauth as WrikeOAuthCredentials;
        },
        saveCredentials: oauth => writeCustomerSourceConnectionSecrets(scope.customer_id, scope.connection_id, { provider: "wrike", wrike: { ...savedSecrets, oauth } }),
        post: async (...args) => { counts.comments_attempted++; return postWrikeTaskComment(...args); }
      });
      if (outcome.status in counts) counts[outcome.status as "sent" | "uncertain" | "blocked" | "suppressed" | "deferred" | "conflict"]++;
    }
  });
  return { ...result, ...counts };
}

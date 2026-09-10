import { getIntakeSweepConfig, runIntakeRecoverySweep } from "./intake-recovery-sweep.js";
import { intakeDeliveryLedger, intakeLedger, intakeSweepCheckpoints, fencedIntakeSweepLedger, listIntakeAttemptsPage } from "./store.js";
import { dispatchIntakeDelivery } from "./intake-dispatch.js";
import { getEmailRuntimeConfig, sendTransactionalEmail } from "./email.js";

export function getIntakeNotificationConfig(env: NodeJS.ProcessEnv) {
  const enabled = env.PATHFINDER_ENABLE_INTAKE_INTERNAL_NOTIFICATIONS === "true";
  const sweep = getIntakeSweepConfig({ ...env, PATHFINDER_ENABLE_INTAKE_ASSURANCE_SWEEP: String(enabled), PATHFINDER_INTAKE_SWEEP_SNAPSHOT_LIMIT: "1" });
  const maxSends = Number(env.PATHFINDER_INTAKE_NOTIFICATION_MAX_SENDS);
  if (enabled && (!Number.isInteger(maxSends) || maxSends < 1 || maxSends > 100)) throw new Error("Intake notifications require an explicit send limit (1–100)");
  return { sweep: { ...sweep, scope: { ...sweep.scope, purpose: "internal_notification" as const } }, maxSends };
}
export function isIntakeNotificationEvent(event: unknown) {
  const candidate = event as { source?: unknown; "detail-type"?: unknown; detail?: { automation?: unknown } } | null;
  return !!candidate && candidate.source === "pathfinder.intake" && candidate["detail-type"] === "Intake Assurance Notifications" && candidate.detail?.automation === "notify_internal";
}
/** A distinct gate and cursor; source comments and Status-link repair have no runtime sender here. */
export async function runConfiguredIntakeNotifications() {
  const config = getIntakeNotificationConfig(process.env);
  const counts = { sends_attempted: 0, sent: 0, uncertain: 0, suppressed: 0, deferred: 0, conflict: 0 };
  if (config.sweep.enabled && getEmailRuntimeConfig().mode !== "ses") throw new Error("Intake notifications require SES mode; log mode is not delivery");
  const result = await runIntakeRecoverySweep({ config: config.sweep, checkpoints: intakeSweepCheckpoints,
    list: listIntakeAttemptsPage, ledger: intakeLedger, fencedLedger: fencedIntakeSweepLedger,
    snapshot: async () => ({ checked_at: new Date().toISOString() }),
    observe: async (attempt, _snapshot, _ledger, _now, fence) => {
      const outcome = await dispatchIntakeDelivery({ enabled: true, customer_id: attempt.signal.customer_id, attempt_id: attempt.attempt_id,
        kind: "internal_notification", intake: intakeLedger, receipts: intakeDeliveryLedger, fence,
        canDispatch: () => counts.sends_attempted < config.maxSends,
        send: async payload => {
          if (payload.kind !== "internal_notification" || getEmailRuntimeConfig().mode !== "ses") throw new Error("Invalid notification transport");
          counts.sends_attempted++;
          const response = await sendTransactionalEmail(payload.message, { disableRetries: true });
          if (response.mode !== "ses" || response.status !== "sent" || !response.provider_message_id) throw new Error("Notification acknowledgement missing");
          return { provider_message_id: response.provider_message_id };
        } });
      if (outcome.status in counts) counts[outcome.status as "sent" | "uncertain" | "suppressed" | "deferred" | "conflict"]++;
    }
  });
  return { ...result, ...counts };
}

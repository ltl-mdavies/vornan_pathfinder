import serverless from "serverless-http";
import { isIntakeRecoverySweepEvent } from "./intake-recovery-sweep.js";
import { runConfiguredIntakeRecoverySweep } from "./intake-recovery-runtime.js";
import { isIntakeNotificationEvent, runConfiguredIntakeNotifications } from "./intake-notification-runtime.js";
import { isWrikeIntakeFeedbackEvent, runConfiguredWrikeIntakeFeedback } from "./wrike-intake-feedback-runtime.js";
import {
  app,
  runConfiguredIntakeStatusRepairs,
  recordConfiguredWrikeScheduledIntakeFailure,
  runConfiguredWrikeScheduledIntake
} from "./server.js";
import { withPathfinderStoreReadScope } from "./store.js";
import { isIntakeStatusRepairEvent } from "./intake-status-repair-runtime.js";
import { isWrikeScheduledIntakeEvent } from "./wrike-scheduled-intake.js";
import {
  buildWrikeScheduledIntakeCompletionLog,
  buildWrikeScheduledIntakeFailureLog
} from "./wrike-scheduled-telemetry.js";

const httpHandler = serverless(app, {
  binary: false
});

export async function handler(event: unknown, context: unknown) {
  if (isIntakeStatusRepairEvent(event)) {
    try {
      const result = await runConfiguredIntakeStatusRepairs();
      console.log(JSON.stringify({ event: "intake_status_repair_completed", ...result }));
      return result;
    } catch (error) {
      console.log(JSON.stringify({ event: "intake_status_repair_failed", failure_category: "repair_failed" }));
      throw error;
    }
  }
  if (isWrikeIntakeFeedbackEvent(event)) {
    try {
      const result = await runConfiguredWrikeIntakeFeedback();
      console.log(JSON.stringify({ event: "wrike_intake_feedback_completed", ...result }));
      return result;
    } catch (error) {
      console.log(JSON.stringify({ event: "wrike_intake_feedback_failed", failure_category: "feedback_failed" }));
      throw error;
    }
  }
  if (isIntakeNotificationEvent(event)) {
    try {
      const result = await runConfiguredIntakeNotifications();
      console.log(JSON.stringify({ event: "intake_notifications_completed", ...result }));
      return result;
    } catch (error) {
      console.log(JSON.stringify({ event: "intake_notifications_failed", failure_category: "dispatch_failed" }));
      throw error;
    }
  }
  if (isIntakeRecoverySweepEvent(event)) {
    try {
      const result = await runConfiguredIntakeRecoverySweep();
      console.log(JSON.stringify({ event: "intake_recovery_sweep_completed", ...result }));
      return result;
    } catch (error) {
      console.log(JSON.stringify({ event: "intake_recovery_sweep_failed", failure_category: "observation_failed" }));
      throw error;
    }
  }
  if (isWrikeScheduledIntakeEvent(event)) {
    try {
      const remaining = context && typeof context === "object" && "getRemainingTimeInMillis" in context
        ? context.getRemainingTimeInMillis : undefined;
      const result = await withPathfinderStoreReadScope(() => runConfiguredWrikeScheduledIntake({
        remainingTimeMs: typeof remaining === "function" ? () => remaining.call(context) as number : undefined
      }));
      console.log(JSON.stringify(buildWrikeScheduledIntakeCompletionLog(result)));
      return result;
    } catch (error) {
      try {
        await withPathfinderStoreReadScope(() => recordConfiguredWrikeScheduledIntakeFailure());
      } catch (markerError) {
        console.warn(JSON.stringify({
          event: "wrike_scheduled_failure_marker_failed",
          failure_category: markerError instanceof Error ? markerError.name : "unknown"
        }));
      }
      console.log(JSON.stringify(buildWrikeScheduledIntakeFailureLog(error)));
      throw error;
    }
  }
  return httpHandler(event as never, context as never);
}

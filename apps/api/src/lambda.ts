import serverless from "serverless-http";
import { isIntakeRecoverySweepEvent } from "./intake-recovery-sweep.js";
import { runConfiguredIntakeRecoverySweep } from "./intake-recovery-runtime.js";
import {
  app,
  recordConfiguredWrikeScheduledIntakeFailure,
  runConfiguredWrikeScheduledIntake
} from "./server.js";
import { withPathfinderStoreReadScope } from "./store.js";
import { isWrikeScheduledIntakeEvent } from "./wrike-scheduled-intake.js";
import {
  buildWrikeScheduledIntakeCompletionLog,
  buildWrikeScheduledIntakeFailureLog
} from "./wrike-scheduled-telemetry.js";

const httpHandler = serverless(app, {
  binary: false
});

export async function handler(event: unknown, context: unknown) {
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
      const result = await withPathfinderStoreReadScope(() => runConfiguredWrikeScheduledIntake());
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

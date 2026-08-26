import serverless from "serverless-http";
import {
  app,
  recordConfiguredWrikeScheduledIntakeFailure,
  runConfiguredWrikeScheduledIntake
} from "./server.js";
import { withPathfinderStoreReadScope } from "./store.js";
import { isWrikeScheduledIntakeEvent } from "./wrike-scheduled-intake.js";
import { buildWrikeScheduledIntakeCompletionLog } from "./wrike-scheduled-telemetry.js";

const httpHandler = serverless(app, {
  binary: false
});

export async function handler(event: unknown, context: unknown) {
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
      throw error;
    }
  }
  return httpHandler(event as never, context as never);
}

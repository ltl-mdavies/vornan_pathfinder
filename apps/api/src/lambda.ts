import serverless from "serverless-http";
import { app, runConfiguredWrikeScheduledIntake } from "./server.js";
import { withPathfinderStoreReadScope } from "./store.js";
import { isWrikeScheduledIntakeEvent } from "./wrike-scheduled-intake.js";
import { buildWrikeScheduledIntakeCompletionLog } from "./wrike-scheduled-telemetry.js";

const httpHandler = serverless(app, {
  binary: false
});

export async function handler(event: unknown, context: unknown) {
  if (isWrikeScheduledIntakeEvent(event)) {
    const result = await withPathfinderStoreReadScope(() => runConfiguredWrikeScheduledIntake());
    console.log(JSON.stringify(buildWrikeScheduledIntakeCompletionLog(result)));
    return result;
  }
  return httpHandler(event as never, context as never);
}

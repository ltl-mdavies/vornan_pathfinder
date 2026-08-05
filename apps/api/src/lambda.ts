import serverless from "serverless-http";
import { app, runConfiguredWrikeScheduledIntake } from "./server.js";

const httpHandler = serverless(app, {
  binary: false
});

function isWrikeScheduledIntakeEvent(event: unknown) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return false;
  const record = event as Record<string, unknown>;
  return (
    record.source === "pathfinder.wrike" &&
    record["detail-type"] === "Wrike Scheduled Intake" &&
    typeof record.detail === "object" &&
    record.detail !== null &&
    !Array.isArray(record.detail) &&
    (record.detail as Record<string, unknown>).prepare_only === true
  );
}

export async function handler(event: unknown, context: unknown) {
  if (isWrikeScheduledIntakeEvent(event)) {
    const result = await runConfiguredWrikeScheduledIntake();
    console.log(JSON.stringify({
      event: "wrike_scheduled_intake_completed",
      status: result.status,
      checked_at: result.checked_at,
      discovered_count: result.discovered_count,
      scoped_task_count: result.discovery_summary.task_count,
      matched_order_status_id_count: result.discovery_summary.order_status_id_count,
      prepared_count: result.prepared_count,
      replayed_count: result.replayed_count,
      failed_count: result.failed_count,
      status_comments_posted: result.status_writeback.posted_count,
      status_comments_failed: result.status_writeback.failed_count
    }));
    return result;
  }
  return httpHandler(event as never, context as never);
}

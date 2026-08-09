import assert from "node:assert/strict";
import test from "node:test";

import { buildWrikeScheduledIntakeCompletionLog } from "../src/wrike-scheduled-telemetry.js";

test("emits complete scheduler counters and one aggregate failure metric", () => {
  const event = buildWrikeScheduledIntakeCompletionLog(
    {
      status: "completed",
      checked_at: "2026-08-09T18:12:54.000Z",
      discovered_count: 4,
      prepared_count: 2,
      replayed_count: 1,
      failed_count: 1,
      discovery_summary: {
        task_count: 40,
        scoped_task_count: 30,
        order_identity_match_count: 8,
        order_status_match_count: 7,
        order_status_and_identity_match_count: 6,
        order_vendor_match_count: 5,
        order_contract_ready_count: 4,
        order_status_id_count: 3
      },
      scheduled_submit: {
        eligible_count: 3,
        submitted_count: 1,
        replayed_count: 1,
        failed_count: 1
      },
      status_writeback: {
        eligible_count: 2,
        posted_count: 1,
        replayed_count: 0,
        failed_count: 1
      }
    },
    1_786_296_774_000
  );

  assert.deepEqual(event._aws, {
    Timestamp: 1_786_296_774_000,
    CloudWatchMetrics: [
      {
        Namespace: "Pathfinder/WrikeScheduledIntake",
        Dimensions: [[]],
        Metrics: [
          { Name: "discovered_count", Unit: "Count" },
          { Name: "prepared_count", Unit: "Count" },
          { Name: "scheduled_submits_submitted", Unit: "Count" },
          { Name: "status_comments_posted", Unit: "Count" },
          { Name: "candidate_failures", Unit: "Count" }
        ]
      }
    ]
  });
  assert.equal(event.scheduled_submits_eligible, 3);
  assert.equal(event.scheduled_submits_submitted, 1);
  assert.equal(event.scheduled_submits_replayed, 1);
  assert.equal(event.scheduled_submits_failed, 1);
  assert.equal(event.status_comments_eligible, 2);
  assert.equal(event.status_comments_posted, 1);
  assert.equal(event.status_comments_replayed, 0);
  assert.equal(event.status_comments_failed, 1);
  assert.equal(event.candidate_failures, 3);
});

test("reports a healthy replay-only cycle without false failures", () => {
  const event = buildWrikeScheduledIntakeCompletionLog({
    status: "completed",
    checked_at: "2026-08-09T18:27:54.000Z",
    discovered_count: 2,
    prepared_count: 0,
    replayed_count: 2,
    failed_count: 0,
    discovery_summary: {
      task_count: 3375,
      scoped_task_count: 3375,
      order_identity_match_count: 2,
      order_status_match_count: 2,
      order_status_and_identity_match_count: 2,
      order_vendor_match_count: 2,
      order_contract_ready_count: 2,
      order_status_id_count: 1
    },
    scheduled_submit: {
      eligible_count: 2,
      submitted_count: 0,
      replayed_count: 2,
      failed_count: 0
    },
    status_writeback: {
      eligible_count: 0,
      posted_count: 0,
      replayed_count: 0,
      failed_count: 0
    }
  });

  assert.equal(event.candidate_failures, 0);
  assert.equal(event.scheduled_submits_replayed, 2);
  assert.equal(event.status_comments_failed, 0);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWrikeScheduledIntakeCompletionLog,
  buildWrikeScheduledIntakeFailureLog
} from "../src/wrike-scheduled-telemetry.js";

test("emits complete scheduler counters and one aggregate failure metric", () => {
  const event = buildWrikeScheduledIntakeCompletionLog(
    {
      status: "completed",
      checked_at: "2026-08-09T18:12:54.000Z",
      discovered_count: 4,
      prepared_count: 2,
      replayed_count: 1,
      failed_count: 1,
      results: [{
        task_id: "TASK-A",
        outcome: "failed",
        failure_category: "preview_failed",
        failure_details: [{
          failure_stage: "preview_creation",
          reason_code: "preview_failed",
          evidence_ids: ["evidence-safe", "unsafe evidence value"],
          job_ids: ["job-safe"]
        }]
      }],
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
        failed_count: 1,
        outcomes: [{
          job_id: "job-submit",
          outcome: "failed",
          failure_category: "TypeError"
        }]
      },
      status_writeback: {
        eligible_count: 2,
        posted_count: 1,
        replayed_count: 0,
        failed_count: 1,
        outcomes: [{
          job_id: "job-writeback",
          outcome: "failed",
          failure_category: "WrikeWritebackBlocked"
        }]
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
          { Name: "scheduled_submits_reconciliation_needed", Unit: "Count" },
          { Name: "scheduled_submits_reconciled", Unit: "Count" },
          { Name: "status_comments_posted", Unit: "Count" },
          { Name: "candidate_failures", Unit: "Count" },
          { Name: "submission_inhibited_ready", Unit: "Count" }
        ]
      }
    ]
  });
  assert.equal(event.scheduled_submits_eligible, 3);
  assert.equal(event.scheduled_submits_submitted, 1);
  assert.equal(event.scheduled_submits_replayed, 1);
  assert.equal(event.scheduled_submits_reconciliation_needed, 0);
  assert.equal(event.scheduled_submits_reconciled, 0);
  assert.equal(event.scheduled_submits_failed, 1);
  assert.equal(event.status_comments_eligible, 2);
  assert.equal(event.status_comments_posted, 1);
  assert.equal(event.status_comments_replayed, 0);
  assert.equal(event.status_comments_failed, 1);
  assert.equal(event.candidate_failures, 3);
  assert.equal(event.submission_inhibited_ready, 0);
  assert.equal(event.candidate_failure_detail_count, 3);
  assert.deepEqual(event.candidate_failure_details, [
    {
      stage: "preview_creation",
      reason_code: "preview_failed",
      task_id: "TASK-A",
      evidence_ids: ["evidence-safe"],
      job_ids: ["job-safe"]
    },
    {
      stage: "submit",
      reason_code: "TypeError",
      task_id: null,
      evidence_ids: [],
      job_ids: ["job-submit"]
    },
    {
      stage: "writeback",
      reason_code: "WrikeWritebackBlocked",
      task_id: null,
      evidence_ids: [],
      job_ids: ["job-writeback"]
    }
  ]);
});

test("reports uncertain submit reconciliation separately from candidate failures", () => {
  const event = buildWrikeScheduledIntakeCompletionLog({
    status: "completed",
    checked_at: "2026-08-26T17:12:00.000Z",
    discovered_count: 1,
    prepared_count: 0,
    replayed_count: 1,
    failed_count: 0,
    discovery_summary: {
      task_count: 1,
      scoped_task_count: 1,
      order_identity_match_count: 1,
      order_status_match_count: 1,
      order_status_and_identity_match_count: 1,
      order_vendor_match_count: 1,
      order_contract_ready_count: 1,
      order_status_id_count: 1
    },
    scheduled_submit: {
      eligible_count: 1,
      submitted_count: 0,
      replayed_count: 0,
      reconciliation_needed_count: 1,
      reconciled_count: 0,
      failed_count: 0,
      outcomes: [{
        job_id: "job_20260826165801_4e2284",
        outcome: "reconciliation_needed",
        failure_category: null
      }]
    },
    status_writeback: {
      eligible_count: 0,
      posted_count: 0,
      replayed_count: 0,
      failed_count: 0
    }
  });
  assert.equal(event.scheduled_submits_reconciliation_needed, 1);
  assert.equal(event.candidate_failures, 0);
  assert.deepEqual(event.candidate_failure_details, []);
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
  assert.deepEqual(event.candidate_failure_details, []);
  assert.equal(event.scheduled_submits_replayed, 2);
  assert.equal(event.status_comments_failed, 0);
});

test("emits an aggregate failure metric for intake-wide configuration failures", () => {
  const event = buildWrikeScheduledIntakeFailureLog(
    Object.assign(new Error("provider detail must not be logged"), {
      code: "invalid_configuration",
      task_id: "MAAAAASECRET",
      provider_payload: { secret: "do-not-log" }
    }),
    "2026-09-03T17:42:58.000Z",
    1_788_457_378_000
  );

  assert.equal(event.event, "wrike_scheduled_intake_failed");
  assert.equal(event.status, "failed");
  assert.equal(event.checked_at, "2026-09-03T17:42:58.000Z");
  assert.equal(event.candidate_failures, 1);
  assert.equal(event.discovered_count, 0);
  assert.equal(event.scheduled_submits_submitted, 0);
  assert.deepEqual(event.candidate_failure_details, [{
    stage: "discover",
    reason_code: "invalid_configuration",
    task_id: null,
    evidence_ids: [],
    job_ids: []
  }]);
  assert.match(JSON.stringify(event), /invalid_configuration/);
  assert.doesNotMatch(JSON.stringify(event), /provider detail|MAAAAASECRET|do-not-log/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { buildScheduledSubmissionHealth } from "../src/wrike-scheduled-health.js";

const config = { enabled: true, lift_submit_enabled: false, customer_id: "284619", import_method_id: "method-1784901795973" };
const readyJob = {
  customer_id: "284619", import_method_id: "method-1784901795973", state: "Ready", target_order_number: null,
  created_at: "2026-08-26T14:00:00.000Z",
  source_evidence: { provider: "wrike", task_id: "task-ready-1" },
  scheduled_wrike_intake: { source: "scheduled_polling" as const, task_id: "task-ready-1", import_method_id: "method-1784901795973", discovered_at: "2026-08-26T13:45:00.000Z" }
};

test("reports only aggregate inhibited scheduled-submit backlog", () => {
  assert.deepEqual(buildScheduledSubmissionHealth(config, [readyJob], null, "2026-08-26T14:00:00.000Z"), {
    configured: true, submission_enabled: false, state: "submission_inhibited", ready_count: 1, oldest_ready_at: "2026-08-26T13:45:00.000Z",
    last_cycle_at: null, last_cycle_prepared_count: null, last_cycle_submitted_count: null, cycle_overdue: false
  }, "2026-08-26T14:45:00.000Z");
});

test("fails closed for unrelated or already-confirmed jobs and surfaces failed cycles", () => {
  assert.equal(buildScheduledSubmissionHealth(config, [{ ...readyJob, customer_id: "1249" }]).ready_count, 0);
  const health = buildScheduledSubmissionHealth({ ...config, lift_submit_enabled: true }, [readyJob], {
    checked_at: "2026-08-26T14:42:54.000Z",
    prepared_count: 1,
    submitted_count: 0,
    candidate_failure_count: 1,
    failed_count: 0,
    scheduled_submit_failed_count: 0
  });
  assert.equal(health.state, "unhealthy");
  assert.equal(health.last_cycle_at, "2026-08-26T14:42:54.000Z");
  assert.equal(health.last_cycle_prepared_count, 1);
});

test("excludes jobs without the exact durable Wrike source identity", () => {
  const mismatches = [
    { ...readyJob, source_evidence: { provider: "manual", task_id: "task-ready-1" } },
    { ...readyJob, source_evidence: { provider: "wrike", task_id: "" } },
    { ...readyJob, scheduled_wrike_intake: { ...readyJob.scheduled_wrike_intake, task_id: "task-other" } }
  ];
  for (const job of mismatches) {
    assert.equal(buildScheduledSubmissionHealth(config, [job]).ready_count, 0);
  }
});

test("marks the scheduler unhealthy when a scheduled cycle is overdue", () => {
  const health = buildScheduledSubmissionHealth({ ...config, lift_submit_enabled: true }, [], {
    checked_at: "2026-08-26T14:00:00.000Z",
    prepared_count: 0,
    submitted_count: 0,
    candidate_failure_count: 0,
    failed_count: 0,
    scheduled_submit_failed_count: 0
  }, "2026-08-26T14:31:00.000Z");
  assert.equal(health.state, "unhealthy");
  assert.equal(health.cycle_overdue, true);
});

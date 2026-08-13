import assert from "node:assert/strict";
import test from "node:test";
import {
  projectLastMeaningfulActivity,
  projectLiftCreation
} from "../src/job-operational-timestamps.js";
import type { ProcessingJobPreview } from "../src/store.js";

function job(overrides: Partial<ProcessingJobPreview> = {}) {
  return {
    job_id: "job_1",
    customer_id: "284619",
    state: "Order Confirmed",
    target_order_number: "A0228506",
    created_at: "2026-08-13T14:28:10.258Z",
    updated_at: "2026-08-13T14:58:00.000Z",
    order_confirmed_at: "2026-08-13T14:28:17.997Z",
    ...overrides
  } as ProcessingJobPreview;
}

test("Pathfinder submit confirmation supplies exact Lift creation when Lift only has a date", () => {
  assert.deepEqual(projectLiftCreation(job(), "2026-08-13"), {
    value: "2026-08-13T14:28:17.997Z",
    precision: "timestamp",
    source: "pathfinder_submit_confirmation"
  });
});

test("manual association never turns link time into Lift creation time", () => {
  const manual = job({
    order_confirmed_at: "2026-08-13T15:05:00.000Z",
    target_order_association_history: [{
      association_id: "association_1",
      source: "manual_verified",
      action: "linked",
      previous_order_number: null,
      order_number: "A0228506",
      linked_at: "2026-08-13T15:05:00.000Z",
      linked_by_email: "operator@example.com",
      reason: "Confirmed existing order",
      verification: {
        order_number: "A0228506",
        customer_id: "284619",
        customer_name: "Empirical - Momentara",
        order_title: "Order",
        contract_number: "C316994",
        created_by: "PATHFINDER",
        order_status: "To Be Proofed",
        line_count: 2,
        fetched_at: "2026-08-13T15:04:58.000Z"
      }
    }]
  });
  assert.deepEqual(projectLiftCreation(manual, "2026-08-13"), {
    value: "2026-08-13",
    precision: "date",
    source: "lift_header"
  });
});

test("a trustworthy Lift timestamp remains authoritative", () => {
  assert.deepEqual(projectLiftCreation(job(), "2026-08-13T14:28:16.000Z"), {
    value: "2026-08-13T14:28:16.000Z",
    precision: "timestamp",
    source: "lift_header"
  });
});

test("no-op scheduler updates do not advance confirmed job activity", () => {
  assert.equal(projectLastMeaningfulActivity(job()), "2026-08-13T14:28:17.997Z");
});

test("processing-only source checks do not advance activity, but human review does", () => {
  const processingOnly = job({
    source_order_history: [{
      event_id: "event-no-impact",
      action: "source_change_assessed_no_impact",
      created_at: "2026-08-13T15:00:00.000Z",
      source_evidence_id: "evidence",
      import_method_fingerprint: "fingerprint",
      reference_proof_evidence_ids: [],
      message: "No order impact."
    }]
  });
  assert.equal(projectLastMeaningfulActivity(processingOnly), "2026-08-13T14:28:17.997Z");
  assert.equal(
    projectLastMeaningfulActivity({
      ...processingOnly,
      source_order_review_dispositions: [{
        disposition_id: "disposition",
        event_id: "event-material",
        disposition: "resolved",
        actor_id: "operator@vornan.co",
        created_at: "2026-08-13T15:05:00.000Z",
        note: null
      }]
    }),
    "2026-08-13T15:05:00.000Z"
  );
});

test("failure result and durable writeback events advance meaningful activity", () => {
  assert.equal(
    projectLastMeaningfulActivity(job({
      state: "Submit Failed",
      target_order_number: null,
      order_confirmed_at: null
    })),
    "2026-08-13T14:58:00.000Z"
  );
  assert.equal(
    projectLastMeaningfulActivity(job({
      wrike_status_writebacks: [{
        writeback_id: "writeback_1",
        task_id: "task_1",
        connection_id: "connection_1",
        order_number: "A0228506",
        contract_number: "C316994",
        comment_sha256: "sha",
        status_url_sha256: "sha",
        state: "posted",
        prepared_at: "2026-08-13T14:29:00.000Z",
        updated_at: "2026-08-13T14:30:00.000Z",
        posted_at: "2026-08-13T14:30:00.000Z",
        comment_id: "comment_1",
        failure_category: null,
        prepared_by_email: null
      }]
    })),
    "2026-08-13T14:30:00.000Z"
  );
});

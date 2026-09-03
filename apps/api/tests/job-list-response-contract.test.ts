import assert from "node:assert/strict";
import test from "node:test";
import {
  buildJobListPage,
  compactWorkspaceJobs,
  toJobListItem
} from "../src/job-list.js";
import type { ProcessingJobPreview } from "../src/store.js";

const lambdaResponseLimit = 6_291_456;
const compactResponseBudget = 1_048_576;

function heavyJob(index: number): ProcessingJobPreview {
  const suffix = String(index).padStart(3, "0");
  const heavyWorkbookEvidence = "x".repeat(65_000);
  return {
    job_id: `job-heavy-${suffix}`,
    pathfinder_order_id: `PF-${suffix}`,
    customer_id: "284619",
    customer_name: "Empirical - Momentara",
    import_method_name: "Wrike intake",
    output_route_name: "Lift production",
    state: "Order Confirmed",
    source_file_name: `C${suffix}.xlsx`,
    target_order_number: `A0230${suffix}`,
    target_order_status: { label: "In Production", code: null, color: null, step: null },
    target_order_status_checked_at: "2026-09-03T20:00:00.000Z",
    target_order_created_at: "2026-09-03",
    target_order_created_precision: "date",
    target_order_created_source: "lift_header",
    last_activity_at: "2026-09-03T20:00:00.000Z",
    order_confirmed_at: "2026-09-03T19:00:00.000Z",
    created_at: "2026-09-03T18:00:00.000Z",
    updated_at: "2026-09-03T20:00:00.000Z",
    archived_at: null,
    public_intake: null,
    source_evidence: {
      provider: "wrike",
      campaign_name: `Campaign ${suffix}`
    },
    source_order_summary: {
      source_order_key: `wrike-${suffix}`,
      related_record_count: 2,
      related_records: []
    },
    canonical_order: {
      order: { contract_number: `C317${suffix}` },
      lines: [],
      retained_heavy_evidence: heavyWorkbookEvidence
    },
    lift_payload: {
      order: {
        ext_id: `PFEXT${suffix}`,
        order_title: `C317${suffix} - Momentara Web Order`
      },
      lines: Array.from({ length: 8 }, (_, lineIndex) => ({ line_number: lineIndex + 1 }))
    },
    source_grid: { columns: [], rows: [{ evidence: heavyWorkbookEvidence }] },
    source_sheets: [{ evidence: heavyWorkbookEvidence }],
    parsed_order_rows: [{ evidence: heavyWorkbookEvidence }],
    reference_rows: [],
    mappings: [],
    product_resolution_results: [],
    unresolved_products: [],
    canonical_validation: [],
    lift_validation: [],
    submit_request_masked: { headers: { Password: "********" }, body: { evidence: heavyWorkbookEvidence } }
  } as unknown as ProcessingJobPreview;
}

test("projects 103 heavy jobs below the compact list response budget", () => {
  const jobs = Array.from({ length: 103 }, (_, index) => heavyJob(index));
  assert.ok(Buffer.byteLength(JSON.stringify(jobs)) > lambdaResponseLimit);

  const result = buildJobListPage(jobs);
  const serialized = JSON.stringify({ jobs: result.items, jobs_page: result.page });

  assert.ok(Buffer.byteLength(serialized) < compactResponseBudget);
  assert.deepEqual(result.page, {
    returned_count: 103,
    total_count: 103,
    next_cursor: null
  });
  assert.equal(result.items[0]?.line_count, 8);
  assert.equal(result.items[0]?.contract_number, "C317000");
  assert.equal(result.items[0]?.campaign_name, "Campaign 000");
});

test("workspace responses use the same compact job item contract", () => {
  const jobs = Array.from({ length: 103 }, (_, index) => heavyJob(index));
  const workspace = compactWorkspaceJobs({
    customer: { lift_customer_id: "284619" },
    settings: "y".repeat(128_000),
    submit_attempts: Array.from({ length: 103 }, (_, index) => ({
      attempt_id: `attempt-${index}`,
      submit_request_masked: { evidence: "z".repeat(65_000) }
    })),
    jobs
  });

  assert.ok(Buffer.byteLength(JSON.stringify(workspace)) < compactResponseBudget);
  assert.equal(workspace.jobs.length, 103);
  assert.equal(workspace.submit_attempts.length, 1);
  assert.equal(workspace.submit_attempts[0]?.attempt_id, "attempt-0");
  assert.equal(workspace.jobs_page.total_count, 103);
});

test("list projection excludes full-detail evidence without mutating the durable job", () => {
  const job = heavyJob(1);
  const item = toJobListItem(job) as unknown as Record<string, unknown>;

  for (const forbidden of [
    "canonical_order",
    "lift_payload",
    "source_grid",
    "source_sheets",
    "parsed_order_rows",
    "product_resolution_results",
    "submit_certification",
    "submit_request_masked"
  ]) {
    assert.equal(forbidden in item, false, forbidden);
  }
  assert.equal(job.lift_payload.lines.length, 8);
  assert.ok(JSON.stringify(job).includes("retained_heavy_evidence"));
});

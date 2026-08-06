import assert from "node:assert/strict";
import test from "node:test";
import type { PublicOrderStatusSnapshot } from "../src/store.js";
import {
  mergePublicStatusRefresh,
  summarizePublicStatusRefresh
} from "../src/public-status-refresh.js";

function snapshot(overrides: Partial<PublicOrderStatusSnapshot> = {}): PublicOrderStatusSnapshot {
  return {
    snapshot_id: "snapshot-job-1",
    order_key: "LTL:A100:job-1",
    order_number: "A100",
    source_order_id: "C100",
    customer: { source_customer_name: "Customer", submit_customer_name: "LTL" },
    job: {
      job_id: "job-1",
      state: "Order Confirmed",
      import_method_name: "Wrike",
      source_file_name: "order.xlsx",
      created_at: "2026-08-05T12:00:00.000Z",
      updated_at: "2026-08-05T12:00:00.000Z"
    },
    route: { name: "Lift", target: "Lift", template: "Order" },
    header: { ext_id: "EXT-1", order_title: "Original" },
    live_order: null,
    order_status: null,
    proof_summary: null,
    proof_visibility: "status_only",
    shipment_summary: null,
    lines: [
      {
        line_number: 1,
        order_line_id: 10,
        product_name: "Poster",
        description: "Poster",
        quantity: 2,
        proof_count: 1,
        package_count: 1,
        latest_proof_status: "PENDING",
        latest_tracking_message: "Label created",
        proofs: [{ proof_filename: "proof.pdf" }],
        packages: [{ tracking_number: "TRACK-OLD" }]
      }
    ],
    lookups: {
      order: { ok: true, http_status: 200, fetched_at: "2026-08-05T12:00:00.000Z" },
      proofs: { ok: true, http_status: 200, fetched_at: "2026-08-05T12:00:00.000Z" },
      packages: {
        ok: true,
        http_status: 200,
        fetched_at: "2026-08-05T12:00:00.000Z",
        redacted_fields: ["NEGOTIATED_RATE"]
      }
    },
    issues: [],
    visibility_policy: {
      audience: "public_status",
      redacted_fields: ["NEGOTIATED_RATE"],
      token_required: true,
      proof_visibility: "status_only"
    },
    refreshed_at: "2026-08-05T12:00:00.000Z",
    ...overrides
  };
}

test("advances successful order and proof data while retaining packages after a transient package failure", () => {
  const previous = snapshot();
  const fresh = snapshot({
    header: { ext_id: "EXT-1", order_title: "Updated" },
    lines: [
      {
        ...previous.lines[0],
        quantity: 3,
        latest_proof_status: "APPROVED",
        proofs: [{ proof_filename: "approved.pdf", proof_approval_status: "APPROVED" }],
        latest_tracking_message: null,
        packages: []
      }
    ],
    lookups: {
      ...previous.lookups,
      packages: { ok: false, http_status: 503, fetched_at: "2026-08-05T12:01:00.000Z", redacted_fields: [] }
    },
    refreshed_at: "2026-08-05T12:01:00.000Z"
  });

  const merged = mergePublicStatusRefresh(previous, fresh);
  assert.equal(merged.header.order_title, "Updated");
  assert.equal(merged.lines[0].quantity, 3);
  assert.equal(merged.lines[0].latest_proof_status, "APPROVED");
  assert.equal(merged.lines[0].latest_tracking_message, "Label created");
  assert.equal(merged.lines[0].packages[0]?.tracking_number, "TRACK-OLD");
});

test("retains the entire previous order shape when the live order lookup is unavailable", () => {
  const previous = snapshot();
  const fresh = snapshot({
    header: { ext_id: "EXT-1", order_title: null },
    lines: [{ ...previous.lines[0], quantity: 0 }],
    lookups: {
      ...previous.lookups,
      order: { ok: false, http_status: 500, fetched_at: "2026-08-05T12:01:00.000Z" }
    }
  });

  const merged = mergePublicStatusRefresh(previous, fresh);
  assert.equal(merged.header.order_title, "Original");
  assert.equal(merged.lines[0].quantity, 2);
});

test("does not claim a newer customer update when every Lift read is unavailable", () => {
  const previous = snapshot();
  const failedLookup = { ok: false, http_status: 503, fetched_at: "2026-08-05T12:01:00.000Z" };
  const fresh = snapshot({
    refreshed_at: "2026-08-05T12:01:00.000Z",
    lookups: {
      order: failedLookup,
      proofs: failedLookup,
      packages: { ...failedLookup, redacted_fields: [] }
    }
  });

  const merged = mergePublicStatusRefresh(previous, fresh);
  assert.equal(merged.refreshed_at, previous.refreshed_at);
});

test("reports a degraded aggregate when any order refresh must use retained data", () => {
  const result = summarizePublicStatusRefresh([
    { status: "live", checked_at: "2026-08-05T12:00:00.000Z" },
    { status: "degraded", checked_at: "2026-08-05T12:00:05.000Z" }
  ]);

  assert.equal(result.status, "degraded");
  assert.equal(result.checked_at, "2026-08-05T12:00:05.000Z");
  assert.equal(result.next_refresh_at, "2026-08-05T12:00:35.000Z");
  assert.equal(result.poll_after_seconds, 30);
});

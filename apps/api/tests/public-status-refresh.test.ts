import assert from "node:assert/strict";
import test from "node:test";
import type { PublicOrderStatusSnapshot } from "../src/store.js";
import {
  buildPublicStatusSourceStatus,
  customerSafeIssueForSource,
  mergePublicStatusRefresh,
  summarizePublicStatusRefresh
} from "../src/public-status-refresh.js";

const checkedAt = "2026-08-05T12:00:00.000Z";

function availableSource(source: "order" | "proofs" | "packages" | "shipping") {
  return buildPublicStatusSourceStatus({ source, outcome: "success", checked_at: checkedAt });
}

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
      order: { ok: true, http_status: 200, fetched_at: checkedAt },
      proofs: { ok: true, http_status: 200, fetched_at: checkedAt },
      packages: {
        ok: true,
        http_status: 200,
        fetched_at: checkedAt,
        redacted_fields: ["NEGOTIATED_RATE"]
      },
      shipping: { ok: true, http_status: 200, fetched_at: checkedAt }
    },
    source_status: {
      order: availableSource("order"),
      proofs: availableSource("proofs"),
      packages: availableSource("packages"),
      shipping: availableSource("shipping")
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

test("retains last-confirmed proofs while order and shipment portions advance", () => {
  const previous = snapshot();
  const proofFailure = buildPublicStatusSourceStatus({
    source: "proofs",
    outcome: "non_2xx",
    checked_at: "2026-08-05T12:01:00.000Z"
  });
  const fresh = snapshot({
    header: { ext_id: "EXT-1", order_title: "Updated" },
    lines: [{
      ...previous.lines[0],
      quantity: 4,
      proof_count: 0,
      latest_proof_status: null,
      proofs: [],
      package_count: 2,
      latest_tracking_message: "In transit",
      packages: [{ tracking_number: "TRACK-NEW", tracker_message: "In transit" }]
    }],
    lookups: {
      ...previous.lookups,
      proofs: { ok: false, http_status: 503, fetched_at: "2026-08-05T12:01:00.000Z" },
      packages: { ok: true, http_status: 200, fetched_at: "2026-08-05T12:01:00.000Z", redacted_fields: [] },
      shipping: { ok: true, http_status: 200, fetched_at: "2026-08-05T12:01:00.000Z" }
    },
    source_status: {
      ...previous.source_status,
      order: buildPublicStatusSourceStatus({ source: "order", outcome: "success", checked_at: "2026-08-05T12:01:00.000Z" }),
      proofs: proofFailure,
      packages: buildPublicStatusSourceStatus({ source: "packages", outcome: "success", checked_at: "2026-08-05T12:01:00.000Z" }),
      shipping: buildPublicStatusSourceStatus({ source: "shipping", outcome: "success", checked_at: "2026-08-05T12:01:00.000Z" })
    }
  });

  const merged = mergePublicStatusRefresh(previous, fresh);
  assert.equal(merged.header.order_title, "Updated");
  assert.equal(merged.lines[0].quantity, 4);
  assert.equal(merged.lines[0].proofs[0]?.proof_filename, "proof.pdf");
  assert.equal(merged.lines[0].latest_proof_status, "PENDING");
  assert.equal(merged.lines[0].package_count, 2);
  assert.equal(merged.lines[0].packages[0]?.tracking_number, "TRACK-NEW");
  assert.equal(merged.source_status?.proofs?.availability, "stale");
});

test("does not claim a newer customer update when every Lift read is unavailable", () => {
  const previous = snapshot();
  const failedLookup = { ok: false, http_status: 503, fetched_at: "2026-08-05T12:01:00.000Z" };
  const fresh = snapshot({
    refreshed_at: "2026-08-05T12:01:00.000Z",
    lookups: {
      order: failedLookup,
      proofs: failedLookup,
      packages: { ...failedLookup, redacted_fields: [] },
      shipping: failedLookup
    }
  });

  const merged = mergePublicStatusRefresh(previous, fresh);
  assert.equal(merged.refreshed_at, previous.refreshed_at);
});

test("retains last-confirmed shipping enrichment independently while fresh package data advances", () => {
  const previous = snapshot({
    shipment_summary: {
      source: "package_details",
      state: "tracking_available",
      package_count: 1,
      tracking_count: 1,
      methods: ["UPS"],
      locations: ["Cincinnati"],
      status_messages: ["In transit"],
      destinations: [{
        destination: { company: "Customer", address_1: "123 Main", city: "Cincinnati", state: "OH", postal_code: "45202" },
        location_name: "Cincinnati",
        package_count: 1,
        methods: ["UPS"],
        status_messages: ["In transit"],
        line_numbers: [1],
        tracking: [{
          tracking_number: "TRACK-OLD",
          ship_method: "UPS",
          tracker_message: "In transit",
          box_numbers: ["1"],
          package_types: ["Box"],
          line_numbers: [1]
        }]
      }]
    },
    lines: [{
      ...snapshot().lines[0],
      packages: [{
        tracking_number: "TRACK-OLD",
        box_number: "1",
        ship_method: "UPS",
        tracker_message: "In transit",
        location_name: "Cincinnati",
        destination: { company: "Customer", address_1: "123 Main", city: "Cincinnati", state: "OH", postal_code: "45202" }
      }]
    }]
  });
  const shippingTimeout = buildPublicStatusSourceStatus({
    source: "shipping",
    outcome: "timeout",
    checked_at: "2026-08-05T12:01:00.000Z"
  });
  const fresh = snapshot({
    refreshed_at: "2026-08-05T12:01:00.000Z",
    shipment_summary: {
      source: "package_details",
      state: "tracking_available",
      package_count: 1,
      tracking_count: 1,
      methods: ["UPS"],
      locations: [],
      status_messages: ["Label updated"],
      destinations: []
    },
    lines: [{
      ...previous.lines[0],
      package_count: 2,
      packages: [{ tracking_number: "TRACK-OLD", box_number: "1", tracker_message: "Label updated" }]
    }],
    lookups: {
      ...previous.lookups,
      packages: { ok: true, http_status: 200, fetched_at: "2026-08-05T12:01:00.000Z", redacted_fields: [] },
      shipping: { ok: false, http_status: 0, fetched_at: "2026-08-05T12:01:00.000Z" }
    },
    source_status: {
      ...previous.source_status,
      packages: buildPublicStatusSourceStatus({ source: "packages", outcome: "success", checked_at: "2026-08-05T12:01:00.000Z" }),
      shipping: shippingTimeout
    },
    issues: [{ source: "shipping", severity: "warning", message: "The operation was aborted due to timeout" }]
  });

  const merged = mergePublicStatusRefresh(previous, fresh);
  assert.equal(merged.lines[0].package_count, 2);
  assert.equal(merged.lines[0].packages[0]?.tracker_message, "Label updated");
  assert.equal(merged.lines[0].packages[0]?.destination?.address_1, "123 Main");
  assert.equal(merged.shipment_summary?.destinations[0]?.destination?.address_1, "123 Main");
  assert.equal(merged.source_status?.shipping?.availability, "stale");
  assert.equal(merged.source_status?.shipping?.last_success_at, checkedAt);
  assert.equal(merged.issues[0]?.message, "Some shipment details are temporarily unavailable. We’re showing the last confirmed update and will retry automatically.");
  assert.equal(JSON.stringify(merged).includes("aborted"), false);
});

test("classifies timeout, rejection, and non-2xx outcomes for every source without exposing diagnostics", () => {
  for (const source of ["order", "proofs", "packages", "shipping"] as const) {
    for (const [outcome, reason] of [["timeout", "timeout"], ["rejected", "request_failed"], ["non_2xx", "upstream_non_2xx"]] as const) {
      const status = buildPublicStatusSourceStatus({ source, outcome, checked_at: checkedAt });
      const issue = customerSafeIssueForSource(status);
      assert.equal(status.reason_code, reason);
      assert.equal(status.availability, "unavailable");
      assert.equal(status.impact, source === "order" ? "core_unavailable" : "section_stale");
      assert.equal(issue?.message.includes("http"), false);
      assert.equal(issue?.message.includes("aborted"), false);
      assert.equal(issue?.message.includes("timeout"), false);
    }
  }
});

test("clears a transient source warning after the source recovers", () => {
  const stale = snapshot({
    source_status: {
      ...snapshot().source_status,
      shipping: buildPublicStatusSourceStatus({
        source: "shipping",
        outcome: "timeout",
        checked_at: "2026-08-05T12:01:00.000Z",
        last_success_at: checkedAt
      })
    }
  });
  const recovered = snapshot({
    refreshed_at: "2026-08-05T12:02:00.000Z",
    source_status: {
      ...snapshot().source_status,
      shipping: buildPublicStatusSourceStatus({ source: "shipping", outcome: "success", checked_at: "2026-08-05T12:02:00.000Z" })
    }
  });
  const merged = mergePublicStatusRefresh(stale, recovered);
  assert.equal(merged.source_status?.shipping?.availability, "available");
  assert.equal(merged.issues.some((issue) => issue.source === "shipping"), false);
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

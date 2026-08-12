import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OrderRollup, safeProofAssetUrl } from "@pathfinder/order-rollup-ui";
import type { OrderRollupSnapshot } from "@pathfinder/order-rollup";

function realSiblingSnapshot(): OrderRollupSnapshot {
  return {
    order_number: "A0221132",
    source_order_id: "REDACTED-EXT-ID",
    customer: {
      source_customer_name: "Redacted customer",
      submit_customer_name: "Redacted submit customer"
    },
    header: {
      ext_id: "REDACTED-EXT-ID",
      order_title: "Redacted proof order",
      po_number: "PO-LIFT-9001",
      contract_number: "CONTRACT-SUBMITTED-12",
      requested_ship_date: "2026-07-23",
      due_date: "2026-07-25",
      actual_ship_date: "2026-07-24",
      shipping: {
        company: "Redacted receiving",
        address_1: "123 Main St",
        city: "Cincinnati",
        state: "OH",
        postal_code: "45202"
      },
      field_sources: {
        po_number: "lift",
        contract_number: "submitted",
        requested_ship_date: "lift",
        due_date: "submitted",
        actual_ship_date: "lift",
        shipping: "submitted"
      }
    },
    order_status: null,
    proof_summary: {
      source: "proof_cache",
      health: "active",
      pending: 4,
      regenerating: 0,
      waiting: 0,
      reviewed: 0,
      total: 4,
      review_required: true,
      last_synced_at: "2026-07-20T12:00:00.000Z",
      decisions_enabled: false
    },
    lines: [{
      line_number: 1,
      order_line_id: 9301338,
      product_id: "348218",
      unit_number: "INTERNAL-UNIT-01",
      product_name: "Redacted product",
      quantity: 20,
      final_height: 46.375,
      final_width: 30.375,
      material: ".020 Styrene",
      proof_count: 4,
      package_count: 2,
      latest_proof_status: "PENDING",
      latest_tracking_message: "In transit",
      packages: [{
        tracking_number: "1ZTEST001",
        ship_method: "UPS Ground",
        tracker_message: "In transit",
        box_number: "1",
        package_type: "Box",
        location_name: "Cincinnati Hub"
      }, {
        tracking_number: null,
        ship_method: "Courier",
        tracker_message: null,
        box_number: "2",
        package_type: "Custom Package",
        location_name: "Cincinnati Hub"
      }],
      proofs: Array.from({ length: 4 }, (_, index) => ({
        proof_filename: index === 0
          ? "redacted-proof-with-an-intentionally-long-filename-that-must-wrap-within-the-card-at-320px.jpg"
          : `redacted-proof-${index + 1}.jpg`,
        proof_approval_status: "PENDING",
        proof_link_low: `https://proof-assets.example.invalid/redacted-proof-${index + 1}-low.jpg`,
        proof_link_high: `https://proof-assets.example.invalid/redacted-proof-${index + 1}.jpg`,
        creation_date: `2026-07-19T10:0${index}:00.000Z`,
        preview_kind: "image" as const,
        proof_state: "pending" as const
      }))
    }],
    issues: [],
    refreshed_at: "2026-07-20T12:00:00.000Z"
  };
}

test("renders the four real-shape sibling proofs as distinct view-only gallery cards", () => {
  const markup = renderToStaticMarkup(
    <OrderRollup snapshot={realSiblingSnapshot()} audience="internal" displayDate={(value) => value ?? "Not available"} />
  );

  assert.equal((markup.match(/class="order-rollup__proof-card /g) ?? []).length, 4);
  assert.equal((markup.match(/<img /g) ?? []).length, 4);
  assert.equal((markup.match(/aria-label="Open high-resolution proof /g) ?? []).length, 4);
  assert.equal((markup.match(/order-rollup__proof-card-copy/g) ?? []).length, 4);
  assert.equal((markup.match(/order-rollup__proof-filename/g) ?? []).length, 4);
  assert.doesNotMatch(markup, /Preview larger/);
  assert.doesNotMatch(markup, /Open full resolution/);
  assert.equal((markup.match(/Posted 2026-07-19/g) ?? []).length, 4);
  assert.match(markup, /Proof review required/);
  assert.match(markup, /Normalized Proof cache synchronized/);
  assert.match(markup, /PO-LIFT-9001/);
  assert.match(markup, /CONTRACT-SUBMITTED-12/);
  assert.match(markup, /Jul 23, 2026/);
  assert.match(markup, /Jul 25, 2026/);
  assert.match(markup, /Jul 24, 2026/);
  assert.match(markup, /Redacted receiving · Cincinnati, OH 45202/);
  assert.equal((markup.match(/Confirmed by Lift/g) ?? []).length >= 4, true);
  assert.equal((markup.match(/Submitted order/g) ?? []).length >= 3, true);
  assert.match(markup, /Tracking is available/);
  assert.match(markup, /Tracking numbers/);
  assert.match(markup, /Track 1ZTEST001/);
  assert.match(markup, /www\.ups\.com\/track\?loc=en_US&amp;tracknum=1ZTEST001/);
  assert.match(markup, /View shipment destinations and tracking/);
  assert.match(markup, /123 Main St/);
  assert.match(markup, /Package 2/);
  assert.match(markup, /Tracking pending/);
  assert.match(markup, /UPS Ground, Courier/);
  assert.match(markup, /Qty 20 · 46.375”h x 30.375”w · .020 Styrene/);
  assert.doesNotMatch(markup, /Product ID/);
  assert.doesNotMatch(markup, /348218/);
  assert.doesNotMatch(markup, /INTERNAL-UNIT-01/);
  assert.doesNotMatch(markup, />Approve</);
  assert.doesNotMatch(markup, />Request revision</);
});

test("sorts a precomputed shipment summary by package number at the final render boundary", () => {
  const snapshot = realSiblingSnapshot();
  snapshot.shipment_summary = {
    source: "package_details",
    state: "tracking_available",
    package_count: 3,
    tracking_count: 3,
    methods: ["UPS Ground"],
    locations: ["Cincinnati Hub"],
    status_messages: ["Label created"],
    destinations: [{
      destination: snapshot.header.shipping ?? null,
      location_name: "Cincinnati Hub",
      package_count: 3,
      methods: ["UPS Ground"],
      status_messages: ["Label created"],
      line_numbers: [1],
      tracking: [3, 1, 2].map((boxNumber) => ({
        tracking_number: `1ZTEST00${boxNumber}`,
        ship_method: "UPS Ground",
        tracker_message: "Label created",
        box_numbers: [String(boxNumber)],
        package_types: ["Box"],
        line_numbers: [1]
      }))
    }]
  };

  const markup = renderToStaticMarkup(
    <OrderRollup snapshot={snapshot} audience="internal" displayDate={(value) => value ?? "Not available"} />
  );

  const packageOne = markup.indexOf("Package 1");
  const packageTwo = markup.indexOf("Package 2");
  const packageThree = markup.indexOf("Package 3");
  assert.equal(packageOne >= 0, true);
  assert.equal(packageOne < packageTwo, true);
  assert.equal(packageTwo < packageThree, true);
});

test("uses one safe proof control with high-resolution preference and low-resolution fallback", () => {
  const snapshot = realSiblingSnapshot();
  snapshot.lines[0].proofs = [
    {
      ...snapshot.lines[0].proofs[0],
      proof_filename: "safe-high.jpg",
      proof_link_low: "https://proof-assets.example.invalid/safe-high-low.jpg",
      proof_link_high: "https://proof-assets.example.invalid/safe-high.jpg"
    },
    {
      ...snapshot.lines[0].proofs[1],
      proof_filename: "unsafe-high.jpg",
      proof_link_low: "https://proof-assets.example.invalid/unsafe-high-low.jpg",
      proof_link_high: "javascript:alert(1)"
    },
    {
      ...snapshot.lines[0].proofs[2],
      proof_filename: "unsafe-low.jpg",
      proof_link_low: "javascript:alert(1)",
      proof_link_high: "https://proof-assets.example.invalid/unsafe-low-high.jpg"
    },
    {
      ...snapshot.lines[0].proofs[3],
      proof_filename: "unsafe-both.jpg",
      proof_link_low: "http://proof-assets.example.invalid/unsafe-both-low.jpg",
      proof_link_high: "https://user:secret@proof-assets.example.invalid/unsafe-both.jpg"
    }
  ];

  const markup = renderToStaticMarkup(
    <OrderRollup snapshot={snapshot} audience="internal" displayDate={(value) => value ?? "Not available"} />
  );

  assert.equal((markup.match(/aria-label="Open high-resolution proof /g) ?? []).length, 2);
  assert.doesNotMatch(markup, /href="https:\/\/proof-assets\.example\.invalid/);
  assert.doesNotMatch(markup, /Open full resolution/);
  assert.doesNotMatch(markup, /javascript:alert/);
  assert.doesNotMatch(markup, /unsafe-both-low/);
  assert.doesNotMatch(markup, /user:secret/);
  assert.equal((markup.match(/<img /g) ?? []).length, 2);
});

test("never renders direct Proof assets for the public Status audience and hides Proof entirely when disabled", () => {
  const statusOnly = realSiblingSnapshot();
  statusOnly.proof_visibility = "status_only";
  statusOnly.proof_summary = {
    ...statusOnly.proof_summary!,
    access_mode: "status_only",
    review_url: null
  };
  const publicMarkup = renderToStaticMarkup(
    <OrderRollup snapshot={statusOnly} audience="public" displayDate={(value) => value ?? "Not available"} />
  );
  assert.equal((publicMarkup.match(/<img /g) ?? []).length, 0);
  assert.equal((publicMarkup.match(/aria-label="Open high-resolution proof /g) ?? []).length, 0);
  assert.match(publicMarkup, /Files and review access are not included/);

  const hidden = realSiblingSnapshot();
  hidden.proof_visibility = "off";
  hidden.proof_summary = null;
  const hiddenMarkup = renderToStaticMarkup(
    <OrderRollup snapshot={hidden} audience="public" displayDate={(value) => value ?? "Not available"} />
  );
  assert.doesNotMatch(hiddenMarkup, /Proof review required/);
  assert.doesNotMatch(hiddenMarkup, /<strong>Proofs<\/strong>/);
  assert.doesNotMatch(hiddenMarkup, /4 proofs/);
});

test("renders safe transient Proof assets only when a token-authorized public caller opts in", () => {
  const snapshot = realSiblingSnapshot();
  snapshot.proof_visibility = "status_only";
  const markup = renderToStaticMarkup(
    <OrderRollup
      snapshot={snapshot}
      audience="public"
      allowProofAssetLinks
      displayDate={(value) => value ?? "Not available"}
    />
  );

  assert.equal((markup.match(/<img /g) ?? []).length, 4);
  assert.equal((markup.match(/aria-label="Open high-resolution proof /g) ?? []).length, 4);
  assert.doesNotMatch(markup, /Open full resolution/);
  assert.doesNotMatch(markup, /javascript:alert/);
});

test("explains that missing public thumbnails are being refreshed", () => {
  const snapshot = realSiblingSnapshot();
  snapshot.proof_visibility = "status_only";
  snapshot.lines[0].proofs = snapshot.lines[0].proofs.map((proof) => ({
    ...proof,
    proof_link_low: null,
    proof_link_high: null,
    preview_kind: "unavailable" as const
  }));
  const markup = renderToStaticMarkup(
    <OrderRollup snapshot={snapshot} audience="public" allowProofAssetLinks proofAssetsLoading />
  );

  assert.equal((markup.match(/Loading current artwork…/g) ?? []).length, 4);
});

test("rejects unsafe proof assets before they reach an image or link", () => {
  assert.equal(safeProofAssetUrl("javascript:alert(1)"), null);
  assert.equal(safeProofAssetUrl("http://proof.example.invalid/file.jpg"), null);
  assert.equal(safeProofAssetUrl("https://user:secret@proof.example.invalid/file.jpg"), null);
  assert.equal(
    safeProofAssetUrl("https://proof.example.invalid/file.jpg"),
    "https://proof.example.invalid/file.jpg"
  );
});

test("localizes transient shipping and proof failures without a global live warning", () => {
  const snapshot = realSiblingSnapshot();
  snapshot.source_status = {
    shipping: {
      source: "shipping",
      availability: "stale",
      reason_code: "timeout",
      severity: "warning",
      impact: "section_stale",
      checked_at: "2026-08-12T16:00:00.000Z",
      last_success_at: "2026-08-12T15:59:00.000Z"
    },
    proofs: {
      source: "proofs",
      availability: "stale",
      reason_code: "upstream_non_2xx",
      severity: "warning",
      impact: "section_stale",
      checked_at: "2026-08-12T16:00:00.000Z",
      last_success_at: "2026-08-12T15:59:00.000Z"
    }
  };
  snapshot.issues = [
    {
      source: "shipping",
      severity: "warning",
      impact: "section_stale",
      message: "Some shipment details are temporarily unavailable. We’re showing the last confirmed update and will retry automatically."
    },
    {
      source: "proofs",
      severity: "warning",
      impact: "section_stale",
      message: "Some proof details are temporarily unavailable. We’re showing the last confirmed update and will retry automatically."
    }
  ];

  const markup = renderToStaticMarkup(
    <OrderRollup snapshot={snapshot} audience="public" displayDate={(value) => value ?? "Not available"} />
  );

  assert.match(markup, /Shipping update/);
  assert.match(markup, /Some shipment details are temporarily unavailable\. We’re showing the last confirmed update and will retry automatically\./);
  assert.match(markup, /Proof update/);
  assert.match(markup, /Some proof details are temporarily unavailable\. We’re showing the last confirmed update and will retry automatically\./);
  assert.doesNotMatch(markup, /data notes?/);
  assert.doesNotMatch(markup, /role="status"/);
});

test("reserves the global public warning for unavailable core order status", () => {
  const snapshot = realSiblingSnapshot();
  snapshot.source_status = {
    order: {
      source: "order",
      availability: "stale",
      reason_code: "request_failed",
      severity: "error",
      impact: "core_unavailable",
      checked_at: "2026-08-12T16:00:00.000Z",
      last_success_at: "2026-08-12T15:59:00.000Z"
    }
  };
  snapshot.issues = [{
    source: "order",
    severity: "error",
    impact: "core_unavailable",
    message: "raw provider failure"
  }];

  const markup = renderToStaticMarkup(
    <OrderRollup snapshot={snapshot} audience="public" displayDate={(value) => value ?? "Not available"} />
  );

  assert.match(markup, /Order update/);
  assert.match(markup, /Current order status is temporarily unavailable\. We’re showing the last confirmed update and will retry automatically\./);
  assert.doesNotMatch(markup, /raw provider failure/);
  assert.doesNotMatch(markup, /role="status"/);
});

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
      product_name: "Redacted product",
      quantity: 20,
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
        proof_filename: `redacted-proof-${index + 1}.jpg`,
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
    <OrderRollup snapshot={realSiblingSnapshot()} audience="public" displayDate={(value) => value ?? "Not available"} />
  );

  assert.equal((markup.match(/order-rollup__proof-card/g) ?? []).length, 4);
  assert.equal((markup.match(/<img /g) ?? []).length, 4);
  assert.equal((markup.match(/>View proof<\/a>/g) ?? []).length, 4);
  assert.equal((markup.match(/>High resolution<\/a>/g) ?? []).length, 4);
  assert.equal((markup.match(/Posted 2026-07-19/g) ?? []).length, 4);
  assert.match(markup, /Proof review required/);
  assert.match(markup, /dedicated Vornan Proof email/);
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
  assert.match(markup, /Tracking 1ZTEST001/);
  assert.match(markup, /Package 2/);
  assert.match(markup, /Tracking pending/);
  assert.match(markup, /UPS Ground, Courier/);
  assert.doesNotMatch(markup, />Approve</);
  assert.doesNotMatch(markup, />Request revision</);
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

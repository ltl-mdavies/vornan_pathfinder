import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProofOrder, type ProofOrder } from "@pathfinder/proof-domain";

process.env.PATHFINDER_RUNTIME = "lambda";
process.env.PATHFINDER_REQUIRE_AUTH = "false";

const { buildOrderSnapshot, publicOrderStatusSnapshotFromInternal } = await import("../src/server.ts");

const checkedAt = "2026-07-20T20:30:00.000Z";

function buildFixtureSnapshot(proofOrder: ProofOrder | null = null) {
  return buildOrderSnapshot({
    customer: {} as never,
    job: {
      job_id: "job-order-rollup-contract",
      state: "Order Confirmed",
      import_method_name: "Manual XLSX – Momentara",
      source_file_name: "momentara-order.xlsx",
      created_at: "2026-07-20T20:00:00.000Z",
      updated_at: "2026-07-20T20:20:00.000Z",
      source_customer_id: "284619",
      source_customer_name: "Empirical – Momentara",
      submit_customer_id: "1249",
      submit_customer_name: "LTL Demo",
      lift_payload: {
        order: {
          ext_id: "PFMRTNIZAX18FE",
          po_number: "PO-4471",
          contract_number: "CONTRACT-SUBMITTED-12",
          order_title: "Momentara Web Order",
          requested_ship_date: "2026-07-23",
          due_date: "2026-07-25",
          shipping: {
            company: "Momentara",
            address_1: "123 Main St",
            city: "Cincinnati",
            state: "OH",
            postal_code: "45202",
            email: "private@example.com",
            phone: "555-0100",
            account_number: "PRIVATE-ACCOUNT",
            instructions: "Private delivery instructions"
          }
        },
        lines: [{
          line_number: 1,
          product_id: "348218",
          product_name: "One Sheet (30.375×46.375)",
          description: "One Sheet",
          quantity: 17,
          unit_number: "ONE_SHEET_30_375X46_375",
          dimensions: { final_height: 46.375, final_width: 30.375 },
          production: { material: ".020 Styrene" }
        }]
      }
    } as never,
    route: {
      output_route_id: "route-ltl-lift-91-premium-graphics",
      name: "Larger Than Life · Lift / 91 · Premium Graphics",
      environment_id: "prod",
      output_template: "Lift Premium Graphics Order"
    } as never,
    target: { name: "Lift ERP" } as never,
    attempts: [{ attempt_id: "submit-contract-fixture" }] as never,
    orderNumber: "A0226692",
    orderLookup: {
      ok: true,
      http_status: 200,
      fetched_at: checkedAt,
      payload: {
        rowset: [{
          ORDER_NUMBER: "A0226692",
          CUSTOMER_ID: 1249,
          CUSTOMER_NAME: "LTL Demo",
          ORDER_TITLE: "Momentara Web Order",
          PO_NUMBER: "PO-LIFT-9001",
          SHIP_DATE: "2026-07-24",
          ACTUAL_SHIP_DATE: "2026-07-26",
          ORDER_TYPE_NAME: "Premium Graphics",
          ORDER_STATUS: "Pending Art",
          ORDER_STEP_ID: 1040,
          HEADER_STEP_NUMBER: 6,
          LINES: [{
            LINE_NUMBER: 1,
            ORDER_LINE_ID: 9742987,
            QUANTITY: 17,
            PRODUCT_NAME: "One Sheet (30.375×46.375)",
            MATERIAL: ".020 Styrene",
            LINE_STEP_ID: 1040,
            LINE_STEP_NUMBER: 6,
            PRINT_H_IN: 46.375,
            PRINT_W_IN: 30.375
          }]
        }]
      }
    } as never,
    proofReport: {
      ok: true,
      http_status: 200,
      fetched_at: checkedAt,
      proofs: [{
        order_line_id: 9742987,
        line_number: 99,
        attachment_id: 555,
        proof_filename: "one-sheet-proof.pdf",
        proof_approval_status: "Awaiting Approval",
        proof_link_low: "https://proof.example.invalid/low.jpg",
        proof_link_high: "https://proof.example.invalid/high.pdf",
        proof_approved_by: "internal@example.com",
        comments: [{ proof_comment: "internal feedback" }],
        detailed_report: { internal_id: "private-report" }
      }]
    } as never,
    proofOrder,
    packageDetails: {
      ok: true,
      http_status: 200,
      fetched_at: checkedAt,
      redacted_fields: ["NEGOTIATED_RATE"],
      packages: [{
        order_line_id: 9742987,
        line_number: 99,
        tracking_number: "1ZTEST",
        tracker_message: "Label created",
        ship_method: "UPS Ground",
        box_number: 4,
        package_type: "Custom Package",
        location_name: "Cincinnati Hub",
        shipping_id: 991,
        header_id: 22,
        negotiated_rate: "99.00",
        dimensions: { length: 20, width: 10, height: 5, weight: 40 },
        account_number: "PRIVATE-ACCOUNT"
      }]
    } as never,
    issues: []
  });
}

function cachedProofOrder() {
  return normalizeProofOrder({
    order_number: "A0226692",
    order_payload: {
      rowset: [{
        ORDER_NUMBER: "A0226692",
        ORDER_STATUS: "Pending Art",
        LINES: [{
          LINE_NUMBER: 1,
          ORDER_LINE_ID: 9742987,
          QUANTITY: 17,
          PRODUCT_NAME: "One Sheet (30.375×46.375)"
        }]
      }]
    },
    proof_payloads: [{
      rowset: [{
        ORDER_NUMBER: "A0226692",
        ORDER_LINE_ID: 9742987,
        LINE_NUMBER: 99,
        ATTACHMENT_ID: 556,
        PROOF_FILENAME: "normalized-proof.jpg",
        PROOF_LINK_LOW: "https://proof.example.invalid/normalized-low.jpg",
        PROOF_LINK_HIGH: "https://proof.example.invalid/normalized-high.jpg",
        PROOF_APPROVAL_STATUS: "PENDING"
      }]
    }],
    synced_at: checkedAt
  });
}

test("keeps enriched Lift order, line, proof, and package data in the internal snapshot", () => {
  const snapshot = buildFixtureSnapshot();

  assert.equal(snapshot.order_status?.label, "Pending Art");
  assert.equal(snapshot.header.po_number, "PO-LIFT-9001");
  assert.equal(snapshot.header.contract_number, "CONTRACT-SUBMITTED-12");
  assert.equal(snapshot.header.requested_ship_date, "2026-07-24");
  assert.equal(snapshot.header.due_date, "2026-07-25");
  assert.equal(snapshot.header.actual_ship_date, "2026-07-26");
  assert.equal(snapshot.header.field_sources.po_number, "lift");
  assert.equal(snapshot.header.field_sources.contract_number, "submitted");
  assert.equal(snapshot.header.field_sources.shipping, "submitted");
  assert.equal(snapshot.live_order?.order_type, "Premium Graphics");
  assert.equal(snapshot.lines[0]?.order_line_id, 9742987);
  assert.equal(snapshot.lines[0]?.step?.step_name, "Obtain Art");
  assert.equal(snapshot.lines[0]?.proof_count, 1);
  assert.equal(snapshot.lines[0]?.proofs[0]?.proof_filename, "one-sheet-proof.pdf");
  assert.equal(snapshot.lines[0]?.package_count, 1);
  assert.equal(snapshot.lines[0]?.packages[0]?.tracking_number, "1ZTEST");
  assert.deepEqual(snapshot.shipment_summary, {
    source: "package_details",
    state: "tracking_available",
    package_count: 1,
    tracking_count: 1,
    methods: ["UPS Ground"],
    locations: ["Cincinnati Hub"],
    status_messages: ["Label created"]
  });
  assert.equal(snapshot.lookups.order?.payload != null, true);
  assert.equal(Number.isNaN(Date.parse(snapshot.refreshed_at)), false);
});

test("preserves customer-safe rollup detail while removing internal submit and raw lookup data", () => {
  const internal = buildFixtureSnapshot();
  const publicSnapshot = publicOrderStatusSnapshotFromInternal(internal);

  assert.equal(publicSnapshot.order_status?.label, "Pending Art");
  assert.equal(publicSnapshot.lines[0]?.order_line_id, 9742987);
  assert.equal(publicSnapshot.lines[0]?.proof_count, 1);
  assert.equal(publicSnapshot.lines[0]?.package_count, 1);
  assert.deepEqual(publicSnapshot.lines[0]?.packages[0], {
    tracking_number: "1ZTEST",
    ship_method: "UPS Ground",
    tracker_message: "Label created",
    box_number: "4",
    package_type: "Custom Package",
    location_name: "Cincinnati Hub"
  });
  assert.deepEqual(publicSnapshot.shipment_summary, {
    source: "package_details",
    state: "tracking_available",
    package_count: 1,
    tracking_count: 1,
    methods: ["UPS Ground"],
    locations: ["Cincinnati Hub"],
    status_messages: ["Label created"]
  });
  assert.equal(publicSnapshot.header.po_number, "PO-LIFT-9001");
  assert.equal(publicSnapshot.header.contract_number, "CONTRACT-SUBMITTED-12");
  assert.equal(publicSnapshot.header.actual_ship_date, "2026-07-26");
  assert.equal(publicSnapshot.header.field_sources?.po_number, "lift");
  assert.equal(publicSnapshot.header.field_sources?.contract_number, "submitted");
  assert.deepEqual(publicSnapshot.header.shipping, {
    company: "Momentara",
    attention_to: null,
    address_1: "123 Main St",
    address_2: null,
    city: "Cincinnati",
    state: "OH",
    postal_code: "45202",
    country: null
  });
  assert.equal(publicSnapshot.visibility_policy.token_required, true);
  assert.equal(JSON.stringify(publicSnapshot.lines[0]?.proofs).includes("internal feedback"), false);
  assert.equal(JSON.stringify(publicSnapshot.lines[0]?.proofs).includes("internal@example.com"), false);
  assert.equal(JSON.stringify(publicSnapshot.lines[0]?.proofs).includes("private-report"), false);
  assert.equal(JSON.stringify(publicSnapshot.lines[0]?.proofs).includes("attachment_id"), false);
  assert.equal(JSON.stringify(publicSnapshot.header).includes("private@example.com"), false);
  assert.equal(JSON.stringify(publicSnapshot.header).includes("555-0100"), false);
  assert.equal(JSON.stringify(publicSnapshot.header).includes("PRIVATE-ACCOUNT"), false);
  assert.equal(JSON.stringify(publicSnapshot.header).includes("Private delivery instructions"), false);
  assert.equal(JSON.stringify(publicSnapshot.lines).includes("99.00"), false);
  assert.equal(JSON.stringify(publicSnapshot.lines).includes("PRIVATE-ACCOUNT"), false);
  assert.equal(JSON.stringify(publicSnapshot.lines).includes("shipping_id"), false);
  assert.equal(JSON.stringify(publicSnapshot.lines).includes("header_id"), false);
  assert.equal(JSON.stringify(publicSnapshot.lines).includes("dimensions"), false);
  assert.equal("submit_history" in publicSnapshot, false);
  assert.equal("proofs" in publicSnapshot, false);
  assert.equal("packages" in publicSnapshot, false);
  assert.equal("payload" in (publicSnapshot.lookups.order ?? {}), false);
  assert.deepEqual(publicSnapshot.visibility_policy.redacted_fields, [
    "NEGOTIATED_RATE",
    "package dimensions and weight",
    "internal shipment identifiers",
    "submit_history",
    "raw Lift lookup payloads"
  ]);
});

test("prefers the normalized cached Proof projection without sharing Proof authorization", () => {
  const internal = buildFixtureSnapshot(cachedProofOrder());
  const publicSnapshot = publicOrderStatusSnapshotFromInternal(internal);

  assert.equal(internal.lines[0]?.proofs[0]?.proof_filename, "normalized-proof.jpg");
  assert.equal(internal.lines[0]?.proofs[0]?.proof_state, "pending");
  assert.deepEqual(publicSnapshot.proof_summary, {
    source: "proof_cache",
    health: "active",
    pending: 1,
    regenerating: 0,
    waiting: 0,
    reviewed: 0,
    total: 1,
    review_required: true,
    last_synced_at: checkedAt,
    decisions_enabled: false
  });
  assert.equal(publicSnapshot.lines[0]?.proofs[0]?.proof_filename, "normalized-proof.jpg");
  const serialized = JSON.stringify(publicSnapshot);
  assert.equal(serialized.includes("one-sheet-proof.pdf"), false);
  assert.equal(serialized.includes("task_id"), false);
  assert.equal(serialized.includes("attachment_id"), false);
  assert.equal(serialized.includes("grant"), false);
  assert.equal(serialized.includes("session"), false);
  assert.match(serialized, /"decisions_enabled":false/);
});

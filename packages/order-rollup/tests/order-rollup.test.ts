import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOrderRollupShipmentSummary,
  matchLiftLineRecord,
  normalizeLiftOrderLookupPayload,
  resolveLiftStep,
  standardGraphicsRail,
  stepProgressIndex,
  toCustomerSafeOrderRollupDestination,
  toCustomerSafeOrderRollupPackage
} from "../src/index.ts";

test("matches Lift records by ORDER_LINE_ID before LINE_NUMBER fallback", () => {
  const lines = [
    { order_line_id: 100, line_number: 1, label: "first" },
    { order_line_id: 200, line_number: 2, label: "second" }
  ];

  const authoritativeMatch = matchLiftLineRecord(lines, {
    order_line_id: "200",
    line_number: 1
  });
  assert.equal(authoritativeMatch?.line.label, "second");
  assert.equal(authoritativeMatch?.matched_by, "order_line_id");

  const fallbackMatch = matchLiftLineRecord(lines, {
    order_line_id: 999,
    line_number: "01"
  });
  assert.equal(fallbackMatch?.line.label, "first");
  assert.equal(fallbackMatch?.matched_by, "line_number");

  assert.equal(matchLiftLineRecord(lines, { order_line_id: 999, line_number: 99 }), null);
});

test("resolves supplied Standard Graphics Lift steps", () => {
  assert.deepEqual(resolveLiftStep(1040, 6), {
    step_id: "1040",
    step_number: "6",
    job_flow_id: "1006",
    step_name: "Obtain Art",
    step_code: "OBTAIN_ART",
    order_status: "Pending Art",
    order_status_code: "PENDING_ART",
    order_status_color: "blue",
    active: true
  });
  assert.equal(standardGraphicsRail.length, 12);
  assert.equal(stepProgressIndex(resolveLiftStep(1043, "15.07")), 6);
});

test("normalizes authoritative header status and per-line Lift steps", () => {
  const order = normalizeLiftOrderLookupPayload({
    rowset: [{
      ORDER_NUMBER: "A0226692",
      CUSTOMER_ID: 1249,
      CUSTOMER_NAME: "LTL Demo",
      ORDER_TITLE: "Momentara Web Order",
      PO_NUMBER: "PO-LIFT-4471",
      CONTRACT_NUMBER: "CONTRACT-LIFT-12",
      ORDER_TYPE_NAME: "Premium Graphics",
      CREATED_BY: "PATHFINDER",
      CREATION_DATE: "2026-07-20",
      SHIP_DATE: "2026-07-23",
      DUE_DATE: "2026-07-25",
      ACTUAL_SHIP_DATE: "2026-07-24",
      SHIP_TO_COMPANY: "Momentara Receiving",
      SHIP_TO_CITY: "Cincinnati",
      SHIP_TO_STATE: "OH",
      SHIP_TO_POSTAL_CODE: "45202",
      ORDER_STATUS: "Pending Art",
      ORDER_STEP_ID: 1040,
      HEADER_STEP_NUMBER: 6,
      LINES: [{
        LINE_NUMBER: 1,
        ORDER_LINE_ID: 9742987,
        QUANTITY: 17,
        PRODUCT_NAME: "One Sheet (30.375x46.375)",
        MATERIAL: ".020 Styrene",
        LINE_STEP_ID: 1040,
        LINE_STEP_NUMBER: 6,
        PRINT_H_IN: 46.375,
        PRINT_W_IN: 30.375
      }]
    }]
  });

  assert.equal(order?.status?.label, "Pending Art");
  assert.equal(order?.po_number, "PO-LIFT-4471");
  assert.equal(order?.contract_number, "CONTRACT-LIFT-12");
  assert.equal(order?.requested_ship_date, "2026-07-23");
  assert.equal(order?.due_date, "2026-07-25");
  assert.equal(order?.actual_ship_date, "2026-07-24");
  assert.deepEqual(order?.shipping, {
    company: "Momentara Receiving",
    attention_to: null,
    address_1: null,
    address_2: null,
    city: "Cincinnati",
    state: "OH",
    postal_code: "45202",
    country: null
  });
  assert.equal(order?.status?.step?.step_name, "Obtain Art");
  assert.equal(order?.lines[0]?.order_line_id, 9742987);
  assert.equal(order?.lines[0]?.step?.order_status_code, "PENDING_ART");
  assert.equal(order?.lines[0]?.material, ".020 Styrene");
});

test("limits public destination context to customer-safe address fields", () => {
  const destination = toCustomerSafeOrderRollupDestination({
    company: "Momentara Receiving",
    attention_to: "Receiving dock",
    address_1: "123 Main St",
    city: "Cincinnati",
    state: "OH",
    postal_code: "45202",
    country: "US",
    phone: "555-0100",
    email: "private@example.com",
    account_number: "PRIVATE-ACCOUNT",
    instructions: "Private delivery instructions"
  });

  assert.deepEqual(destination, {
    company: "Momentara Receiving",
    attention_to: "Receiving dock",
    address_1: "123 Main St",
    address_2: null,
    city: "Cincinnati",
    state: "OH",
    postal_code: "45202",
    country: "US"
  });
  const serialized = JSON.stringify(destination);
  assert.equal(serialized.includes("private@example.com"), false);
  assert.equal(serialized.includes("PRIVATE-ACCOUNT"), false);
  assert.equal(serialized.includes("Private delivery instructions"), false);
});

test("builds a bounded shipment summary from customer-safe package fields", () => {
  const unsafePackage = {
    tracking_number: " 1Z TEST 001 ",
    ship_method: "UPS Ground",
    tracker_message: "In transit",
    box_number: 2,
    package_type: "Box",
    location_name: "Cincinnati Hub",
    shipping_id: 991,
    negotiated_rate: "99.00",
    dimensions: { weight: 120 },
    account_number: "PRIVATE-ACCOUNT"
  };
  assert.deepEqual(toCustomerSafeOrderRollupPackage(unsafePackage), {
    tracking_number: "1Z TEST 001",
    ship_method: "UPS Ground",
    tracker_message: "In transit",
    box_number: "2",
    package_type: "Box",
    location_name: "Cincinnati Hub"
  });

  const summary = buildOrderRollupShipmentSummary([{
    line_number: 1,
    quantity: 5,
    proof_count: 0,
    package_count: 2,
    latest_proof_status: null,
    latest_tracking_message: "In transit",
    proofs: [],
    packages: [unsafePackage, { ship_method: "Courier", location_name: "Cincinnati Hub" }]
  }]);
  assert.deepEqual(summary, {
    source: "package_details",
    state: "tracking_available",
    package_count: 2,
    tracking_count: 1,
    methods: ["UPS Ground", "Courier"],
    locations: ["Cincinnati Hub"],
    status_messages: ["In transit"]
  });
  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes("99.00"), false);
  assert.equal(serialized.includes("PRIVATE-ACCOUNT"), false);
  assert.equal(serialized.includes("weight"), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCarrierTrackingUrl,
  buildOrderRollupShipmentSummary,
  isExplicitLiftOrderAbsence,
  isLiftCancelledLine,
  liftLineHasClearedProofApproval,
  liftLineProofApprovalDisposition,
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

test("uses Lift 7.05 as the authoritative proof-approval boundary", () => {
  assert.equal(liftLineHasClearedProofApproval(7.02), false);
  assert.equal(liftLineHasClearedProofApproval("7.05"), true);
  assert.equal(liftLineHasClearedProofApproval(10), true);
  assert.equal(liftLineHasClearedProofApproval(15.22), true);
  assert.equal(liftLineHasClearedProofApproval(null), false);
  assert.equal(liftLineHasClearedProofApproval("not-a-step"), false);
});

test("interprets the latest Lift proof step in both forward and reverse directions", () => {
  assert.equal(liftLineProofApprovalDisposition(6), "waiting");
  assert.equal(liftLineProofApprovalDisposition("7.01"), "waiting");
  assert.equal(liftLineProofApprovalDisposition(7), "pending");
  assert.equal(liftLineProofApprovalDisposition(7.02), "pending");
  assert.equal(liftLineProofApprovalDisposition(7.049), "pending");
  assert.equal(liftLineProofApprovalDisposition(7.05), "approved");
  assert.equal(liftLineProofApprovalDisposition(15.22), "approved");
  assert.equal(liftLineProofApprovalDisposition(4), null);
  assert.equal(liftLineProofApprovalDisposition(null), null);
  assert.equal(liftLineProofApprovalDisposition("not-a-step"), null);
});

test("normalizes authoritative header status and per-line Lift steps", () => {
  const order = normalizeLiftOrderLookupPayload({
    rowset: [{
      ORDER_NUMBER: "A0226692",
      EXT_ID: "PFMRTNIZAX18FE",
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
  assert.equal(order?.external_order_id, "PFMRTNIZAX18FE");
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
  assert.equal(order?.lines[0]?.cancelled, false);
});

test("recognizes only Lift's exact canceled-order and canceled-line signatures", () => {
  assert.equal(isExplicitLiftOrderAbsence({ rowset: null }), true);
  assert.equal(isExplicitLiftOrderAbsence({ rowset: [] }), false);
  assert.equal(isExplicitLiftOrderAbsence(null), false);

  assert.equal(isLiftCancelledLine({ LINE_STEP_ID: -1, LINE_STEP_NUMBER: null }), true);
  assert.equal(isLiftCancelledLine({ LINE_STEP_ID: "-1", LINE_STEP_NUMBER: null }), true);
  assert.equal(isLiftCancelledLine({ LINE_STEP_ID: -1 }), false);
  assert.equal(isLiftCancelledLine({ LINE_STEP_ID: -1, LINE_STEP_NUMBER: 0 }), false);
  assert.equal(isLiftCancelledLine({ LINE_STEP_ID: 1040, LINE_STEP_NUMBER: null }), false);
});

test("retains canceled Lift lines as customer-visible history without assigning a production step", () => {
  const order = normalizeLiftOrderLookupPayload({
    rowset: [{
      ORDER_NUMBER: "A0230026",
      LINES: [
        { LINE_NUMBER: 1, ORDER_LINE_ID: 100, LINE_STEP_ID: -1, LINE_STEP_NUMBER: null },
        { LINE_NUMBER: 2, ORDER_LINE_ID: 200, LINE_STEP_ID: 1040, LINE_STEP_NUMBER: 6 }
      ]
    }]
  });

  assert.deepEqual(order?.lines.map((line) => ({
    id: line.order_line_id,
    cancelled: line.cancelled,
    step: line.step?.step_number ?? null
  })), [
    { id: 100, cancelled: true, step: null },
    { id: 200, cancelled: false, step: "6" }
  ]);
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
    location_name: "Cincinnati Hub",
    destination: null
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
    status_messages: ["In transit"],
    destinations: [{
      destination: null,
      location_name: "Cincinnati Hub",
      package_count: 2,
      methods: ["UPS Ground", "Courier"],
      status_messages: ["In transit"],
      line_numbers: [1],
      tracking: [{
        tracking_number: "1Z TEST 001",
        ship_method: "UPS Ground",
        tracker_message: "In transit",
        box_numbers: ["2"],
        package_types: ["Box"],
        line_numbers: [1]
      }]
    }]
  });
  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes("99.00"), false);
  assert.equal(serialized.includes("PRIVATE-ACCOUNT"), false);
  assert.equal(serialized.includes("weight"), false);
});

test("deduplicates physical packages across lines and builds only known carrier links", () => {
  const sharedPackage = {
    tracking_number: "1Z60V157P299088946",
    ship_method: "UPS Ground",
    tracker_message: "Label created",
    box_number: 3,
    package_type: "Custom Package",
    location_name: "Customer Receiving"
  };
  const line = (lineNumber: number) => ({
    line_number: lineNumber,
    quantity: 1,
    proof_count: 0,
    package_count: 1,
    latest_proof_status: null,
    latest_tracking_message: "Label created",
    proofs: [],
    packages: [sharedPackage]
  });
  const summary = buildOrderRollupShipmentSummary([line(12), line(13)], {
    company: "Customer Receiving",
    address_1: "123 Main St",
    city: "Cincinnati",
    state: "OH",
    postal_code: "45202"
  });

  assert.equal(summary.package_count, 1);
  assert.equal(summary.tracking_count, 1);
  assert.deepEqual(summary.destinations[0]?.line_numbers, [12, 13]);
  assert.deepEqual(summary.destinations[0]?.tracking[0]?.line_numbers, [12, 13]);
  assert.equal(summary.destinations[0]?.destination?.address_1, "123 Main St");
  assert.equal(
    buildCarrierTrackingUrl("1Z60V157P299088946", "UPS Ground"),
    "https://www.ups.com/track?loc=en_US&tracknum=1Z60V157P299088946"
  );
  assert.equal(
    buildCarrierTrackingUrl("123456789012", "PRIORITY_OVERNIGHT"),
    "https://www.fedex.com/fedextrack/?trknbr=123456789012"
  );
  assert.equal(buildCarrierTrackingUrl("not a safe value", "Unknown"), null);
});

test("sorts shipment tracking groups by package number within each destination", () => {
  const packages = [3, 1, 2].map((boxNumber) => ({
    tracking_number: `1Z60V157P29908894${boxNumber}`,
    ship_method: "UPS Ground",
    tracker_message: "Label created",
    box_number: boxNumber,
    package_type: "Custom Package",
    location_name: "Customer Receiving"
  }));
  const summary = buildOrderRollupShipmentSummary([{
    line_number: 1,
    quantity: 1,
    proof_count: 0,
    package_count: 3,
    latest_proof_status: null,
    latest_tracking_message: "Label created",
    proofs: [],
    packages
  }]);

  assert.deepEqual(
    summary.destinations[0]?.tracking.map((tracking) => tracking.box_numbers),
    [["1"], ["2"], ["3"]]
  );
});

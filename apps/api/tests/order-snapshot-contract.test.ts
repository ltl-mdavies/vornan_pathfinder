import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProofOrder, type ProofOrder } from "@pathfinder/proof-domain";

process.env.PATHFINDER_RUNTIME = "lambda";
process.env.PATHFINDER_REQUIRE_AUTH = "false";

const {
  applyPublicProofVisibility,
  buildOrderSnapshot,
  mergeShippingReportIntoPackages,
  normalizePackageDetailsPayload,
  normalizeShippingReportPayload,
  publicOrderStatusSnapshotFromInternal
} = await import("../src/server.ts");

const checkedAt = "2026-07-20T20:30:00.000Z";

test("enriches exact package records with ShippingReport recipients and addresses without duplicating tracking", () => {
  const shippingRows = normalizeShippingReportPayload({
    rowset: [
      {
        ORDER_NUMBER: "A0221993",
        ORDER_LINE_ID: 9368150,
        TRACKING_NUMBER: "1Z60V1572999272694",
        TRACKER_MESSAGE: "Label created",
        SHIP_METHOD: "UPS Next Day Saver",
        LOCATION_NAME: "J. Perez and Associates",
        ADDRESS_LINE1: "1460 Tully Road",
        ADDRESS_LINE2: "Suite 605",
        ADDRESS_LINE3: "Receiving",
        CITY: "San Jose",
        STATE: "CA",
        ZIP: 95122
      },
      {
        ORDER_NUMBER: "A0221993",
        ORDER_LINE_ID: 9368151,
        TRACKING_NUMBER: "1Z60V1572999272694",
        TRACKER_MESSAGE: "Label created",
        SHIP_METHOD: "UPS Next Day Saver",
        LOCATION_NAME: "J. Perez and Associates",
        ADDRESS_LINE1: "1460 Tully Road",
        ADDRESS_LINE2: "Suite 605",
        CITY: "San Jose",
        STATE: "CA",
        ZIP: 95122
      },
      {
        ORDER_NUMBER: "A0221993",
        ORDER_LINE_ID: 9368152,
        TRACKING_NUMBER: null,
        SHIP_METHOD: "UPS Next Day Saver",
        LOCATION_NAME: "J. Perez and Associates",
        ADDRESS_LINE1: "1460 Tully Road",
        CITY: "San Jose",
        STATE: "CA",
        ZIP: 95122
      },
      {
        ORDER_NUMBER: "A9999999",
        ORDER_LINE_ID: 9368150,
        TRACKING_NUMBER: "1Z60V1572999272694",
        LOCATION_NAME: "Wrong order",
        ADDRESS_LINE1: "Never merge this address"
      }
    ]
  });
  const packages = mergeShippingReportIntoPackages([
    {
      header_id: 1,
      order_number: "A0221993",
      order_line_id: 9368150,
      shipping_id: 10,
      line_number: 1,
      product: "One Sheet",
      material: null,
      laminate: null,
      height: null,
      width: null,
      quantity: 1,
      box_number: 1,
      package_type: "Custom Package",
      tracking_number: "1Z60V1572999272694",
      dimensions: { length: null, width: null, height: null, weight: null },
      tracker_message: "Label created",
      location_name: "Legacy destination label",
      ship_method: "UPS Next Day Saver",
      destination: null
    }
  ], shippingRows);

  assert.equal(packages.length, 2);
  assert.equal(packages[0]?.box_number, 1);
  assert.equal(packages[0]?.location_name, "J. Perez and Associates");
  assert.deepEqual(packages[0]?.destination, {
    company: "J. Perez and Associates",
    attention_to: null,
    address_1: "1460 Tully Road",
    address_2: "Suite 605, Receiving",
    city: "San Jose",
    state: "CA",
    postal_code: "95122",
    country: null
  });
  assert.equal(packages[1]?.order_line_id, 9368151);
  assert.equal(packages[1]?.tracking_number, "1Z60V1572999272694");
  assert.equal(JSON.stringify(packages).includes("ACTUAL_SHIP_DATE"), false);
});

test("preserves numeric Lift tracking numbers from package and shipping reports", () => {
  const packages = normalizePackageDetailsPayload({
    rowset: [{
      ORDER_NUMBER: "A0228214",
      ORDER_LINE_ID: 9864989,
      LINE_NUMBER: 1,
      BOX_NUMBER: 6,
      PACKAGE_TRACKING_NUMBER: 123456789012,
      SHIP_METHOD: "PRIORITY_OVERNIGHT"
    }]
  });
  const shipping = normalizeShippingReportPayload({
    rowset: [{
      ORDER_NUMBER: "A0228214",
      ORDER_LINE_ID: 9864989,
      TRACKING_NUMBER: 123456789012,
      SHIP_METHOD: "PRIORITY_OVERNIGHT"
    }]
  });

  assert.equal(packages[0]?.tracking_number, "123456789012");
  assert.equal(shipping[0]?.tracking_number, "123456789012");
});

function buildFixtureSnapshot(
  proofOrder: ProofOrder | null = null,
  options: {
    orderPayload?: unknown;
    proofLineStep?: { id: string | number | null; number: string | number | null };
    orderLookupOk?: boolean;
    proofReportOk?: boolean;
  } = {}
) {
  return buildOrderSnapshot({
    customer: {} as never,
    job: {
      job_id: "job-order-rollup-contract",
      state: "Order Confirmed",
      import_method_name: "Manual XLSX – Momentara",
      source_file_name: "momentara-order.xlsx",
      created_at: "2026-07-20T20:00:00.000Z",
      updated_at: "2026-07-20T20:20:00.000Z",
      order_confirmed_at: "2026-07-20T20:18:00.000Z",
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
      ok: options.orderLookupOk ?? true,
      http_status: 200,
      fetched_at: checkedAt,
      payload: options.orderPayload ?? {
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
      ok: options.proofReportOk ?? true,
      http_status: 200,
      fetched_at: checkedAt,
      proofs: [{
        order_line_id: 9742987,
        line_number: 99,
        attachment_id: 555,
        proof_filename: "one-sheet-proof.pdf",
        proof_approval_status: "Awaiting Approval",
        ...(options.proofLineStep ? {
          line_step_id: options.proofLineStep.id,
          line_step_number: options.proofLineStep.number
        } : {}),
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

test("projects a successful Orders rowset:null as a durable canceled order without a data-feed warning", () => {
  const snapshot = buildFixtureSnapshot(null, { orderPayload: { rowset: null } });
  const publicSnapshot = publicOrderStatusSnapshotFromInternal(snapshot, "review_link");

  assert.equal(snapshot.lifecycle.state, "cancelled");
  assert.equal(snapshot.lifecycle.cancellation_source, "orders_report");
  assert.equal(snapshot.order_status?.label, "Canceled");
  assert.equal(snapshot.lines.length, 1);
  assert.equal(snapshot.lines[0]?.cancelled, true);
  assert.equal(snapshot.lines[0]?.proof_review_required, false);
  assert.equal(snapshot.source_status?.order?.availability, undefined);
  assert.equal(publicSnapshot.lifecycle?.state, "cancelled");
  assert.equal(publicSnapshot.lines[0]?.proof_review_required, false);
  assert.equal(publicSnapshot.issues.length, 0);
});

test("marks individual canceled lines while keeping an order active when another Lift line remains active", () => {
  const snapshot = buildFixtureSnapshot(null, {
    orderPayload: {
      rowset: [{
        ORDER_NUMBER: "A0230026",
        ORDER_STATUS: "In Production",
        LINES: [
          { LINE_NUMBER: 1, ORDER_LINE_ID: 9742987, LINE_STEP_ID: -1, LINE_STEP_NUMBER: null },
          { LINE_NUMBER: 2, ORDER_LINE_ID: 9742988, LINE_STEP_ID: 1043, LINE_STEP_NUMBER: 15.07 }
        ]
      }]
    }
  });

  assert.equal(snapshot.lifecycle.state, "active");
  assert.equal(snapshot.lines[0]?.cancelled, true);
  assert.equal(snapshot.lines[0]?.step, null);
  assert.equal(snapshot.lines[1]?.cancelled, false);
  assert.equal(snapshot.lines[1]?.step?.step_name, "Cut");
});

test("uses the proof-report canceled-line signature when the Orders report has not caught up", () => {
  const snapshot = buildFixtureSnapshot(null, { proofLineStep: { id: -1, number: null } });

  assert.equal(snapshot.lifecycle.state, "cancelled");
  assert.equal(snapshot.lifecycle.cancellation_source, "order_lines");
  assert.equal(snapshot.lines[0]?.cancelled, true);
  assert.equal(snapshot.lines[0]?.proof_review_required, false);
});

test("never infers cancellation from a canceled signature delivered by a failed Lift read", () => {
  const failedOrderRead = buildFixtureSnapshot(null, {
    orderLookupOk: false,
    orderPayload: {
      rowset: [{
        ORDER_NUMBER: "A0230026",
        LINES: [{ LINE_NUMBER: 1, ORDER_LINE_ID: 9742987, LINE_STEP_ID: -1, LINE_STEP_NUMBER: null }]
      }]
    }
  });
  const failedProofRead = buildFixtureSnapshot(null, {
    proofReportOk: false,
    proofLineStep: { id: -1, number: null }
  });

  assert.equal(failedOrderRead.lifecycle.state, "active");
  assert.equal(failedOrderRead.lines[0]?.cancelled, false);
  assert.equal(failedProofRead.lifecycle.state, "active");
  assert.equal(failedProofRead.lines[0]?.cancelled, false);
});

test("uses the complete current Lift line set when lines were added after Pathfinder submission", () => {
  const snapshot = buildFixtureSnapshot();
  const livePayload = snapshot.lookups.order?.payload as { rowset: Array<{ LINES: Array<Record<string, unknown>> }> };
  livePayload.rowset[0]?.LINES.push(
    {
      LINE_NUMBER: 2,
      ORDER_LINE_ID: 10011821,
      QUANTITY: 210,
      PRODUCT_NAME: "Fat Head (18.5x23.5)",
      MATERIAL: "WallMark 226",
      LINE_STEP_ID: 1019,
      LINE_STEP_NUMBER: 17,
      PRINT_H_IN: 23.5,
      PRINT_W_IN: 18.5
    },
    {
      LINE_NUMBER: 3,
      ORDER_LINE_ID: 10011822,
      QUANTITY: 125,
      PRODUCT_NAME: "Fat Head (18.5x23.5)",
      MATERIAL: "WallMark 226",
      LINE_STEP_ID: 1019,
      LINE_STEP_NUMBER: 17,
      PRINT_H_IN: 23.5,
      PRINT_W_IN: 18.5
    }
  );

  const refreshed = buildFixtureSnapshot();
  refreshed.lookups.order!.payload = livePayload;
  const rebuilt = buildOrderSnapshot({
    customer: {} as never,
    job: {
      job_id: refreshed.job.job_id,
      state: refreshed.job.state,
      import_method_name: refreshed.job.import_method_name,
      source_file_name: refreshed.job.source_file_name,
      created_at: refreshed.job.created_at,
      updated_at: refreshed.job.updated_at,
      source_customer_id: "284619",
      source_customer_name: refreshed.customer.source_customer_name,
      submit_customer_id: "1249",
      submit_customer_name: refreshed.customer.submit_customer_name,
      lift_payload: {
        order: snapshot.header,
        lines: [{
          line_number: 1,
          product_id: "348225",
          product_name: "Fat Head (18.5x23.5)",
          description: "Fat Head (18.5x23.5)",
          quantity: 265,
          unit_number: "line_1",
          dimensions: { final_height: 23.5, final_width: 18.5 },
          production: { material: "WallMark 226" }
        }]
      }
    } as never,
    route: { output_route_id: "route", name: "Lift", environment_id: "prod", output_template: "Lift" } as never,
    target: { name: "Lift ERP" } as never,
    attempts: [] as never,
    orderNumber: "A0229465",
    orderLookup: { ok: true, http_status: 200, fetched_at: checkedAt, payload: livePayload } as never,
    proofReport: {
      ok: true,
      http_status: 200,
      fetched_at: checkedAt,
      proofs: [{
        order_line_id: 10011822,
        line_number: 3,
        proof_filename: "manually-added-line-proof.pdf",
        proof_approval_status: "APPROVED"
      }]
    } as never,
    packageDetails: {
      ok: true,
      http_status: 200,
      fetched_at: checkedAt,
      redacted_fields: ["NEGOTIATED_RATE"],
      packages: [{
        order_line_id: 10011821,
        line_number: 2,
        tracking_number: "TRACK-ADDED-LINE",
        tracker_message: "Departed FedEx location"
      }]
    } as never,
    issues: []
  });

  assert.deepEqual(rebuilt.lines.map((line) => ({
    line_number: line.line_number,
    order_line_id: line.order_line_id,
    quantity: line.quantity,
    product_name: line.product_name,
    product_id: line.product_id
  })), [
    { line_number: 1, order_line_id: 9742987, quantity: 17, product_name: "One Sheet (30.375×46.375)", product_id: "348225" },
    { line_number: 2, order_line_id: 10011821, quantity: 210, product_name: "Fat Head (18.5x23.5)", product_id: null },
    { line_number: 3, order_line_id: 10011822, quantity: 125, product_name: "Fat Head (18.5x23.5)", product_id: null }
  ]);
  assert.equal(rebuilt.lines[1]?.package_count, 1);
  assert.equal(rebuilt.lines[1]?.packages[0]?.tracking_number, "TRACK-ADDED-LINE");
  assert.equal(rebuilt.lines[2]?.proof_count, 1);
  assert.equal(rebuilt.lines[2]?.proofs[0]?.proof_filename, "manually-added-line-proof.pdf");

  const publicSnapshot = publicOrderStatusSnapshotFromInternal(rebuilt);
  assert.equal(publicSnapshot.lines.length, 3);
  assert.deepEqual(publicSnapshot.lines.map((line) => line.order_line_id), [9742987, 10011821, 10011822]);
});

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
  assert.equal(snapshot.lines[0]?.proof_review_required, true);
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
    status_messages: ["Label created"],
    destinations: [{
      destination: {
        company: "Momentara",
        attention_to: null,
        address_1: "123 Main St",
        address_2: null,
        city: "Cincinnati",
        state: "OH",
        postal_code: "45202",
        country: null
      },
      location_name: "Cincinnati Hub",
      package_count: 1,
      methods: ["UPS Ground"],
      status_messages: ["Label created"],
      line_numbers: [1],
      tracking: [{
        tracking_number: "1ZTEST",
        ship_method: "UPS Ground",
        tracker_message: "Label created",
        box_numbers: ["4"],
        package_types: ["Custom Package"],
        line_numbers: [1]
      }]
    }]
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
    location_name: "Cincinnati Hub",
    destination: null
  });
  assert.deepEqual(publicSnapshot.shipment_summary, {
    source: "package_details",
    state: "tracking_available",
    package_count: 1,
    tracking_count: 1,
    methods: ["UPS Ground"],
    locations: ["Cincinnati Hub"],
    status_messages: ["Label created"],
    destinations: [{
      destination: {
        company: "Momentara",
        attention_to: null,
        address_1: "123 Main St",
        address_2: null,
        city: "Cincinnati",
        state: "OH",
        postal_code: "45202",
        country: null
      },
      location_name: "Cincinnati Hub",
      package_count: 1,
      methods: ["UPS Ground"],
      status_messages: ["Label created"],
      line_numbers: [1],
      tracking: [{
        tracking_number: "1ZTEST",
        ship_method: "UPS Ground",
        tracker_message: "Label created",
        box_numbers: ["4"],
        package_types: ["Custom Package"],
        line_numbers: [1]
      }]
    }]
  });
  assert.equal(publicSnapshot.header.po_number, "PO-LIFT-9001");
  assert.equal(publicSnapshot.job.order_confirmed_at, "2026-07-20T20:18:00.000Z");
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
  assert.equal(publicSnapshot.proof_visibility, "status_only");
  assert.equal(publicSnapshot.lines[0]?.proofs[0]?.proof_link_low, null);
  assert.equal(publicSnapshot.lines[0]?.proofs[0]?.proof_link_high, null);
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
    "raw Lift lookup payloads",
    "direct Lift proof URLs"
  ]);
});

test("maps structured source health to fixed public copy and strips legacy raw exception messages", () => {
  const internal = buildFixtureSnapshot();
  internal.source_status = {
    shipping: {
      source: "shipping",
      availability: "unavailable",
      reason_code: "timeout",
      severity: "warning",
      impact: "section_stale",
      checked_at: checkedAt,
      last_success_at: null
    }
  };
  internal.issues = [{
    source: "shipping_report",
    severity: "warning",
    message: "The operation was aborted due to timeout at https://provider.example.invalid/private"
  }];

  const projected = publicOrderStatusSnapshotFromInternal(internal);
  const serialized = JSON.stringify(projected);
  assert.equal(projected.issues[0]?.message, "Some shipment details are temporarily unavailable. We’re showing the last confirmed update and will retry automatically.");
  assert.equal(serialized.includes("aborted"), false);
  assert.equal(serialized.includes("provider.example"), false);

  const legacy = {
    ...projected,
    source_status: undefined,
    issues: internal.issues
  };
  const sanitizedLegacy = applyPublicProofVisibility(legacy, "status_only");
  assert.deepEqual(sanitizedLegacy.issues, []);
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
    decisions_enabled: false,
    access_mode: "status_only",
    review_url: null
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

test("applies all three customer Proof visibility modes without exposing Lift asset URLs", () => {
  const internal = buildFixtureSnapshot(cachedProofOrder());
  const hidden = publicOrderStatusSnapshotFromInternal(internal, "off");
  const statusOnly = publicOrderStatusSnapshotFromInternal(internal, "status_only");
  const reviewLink = publicOrderStatusSnapshotFromInternal(internal, "review_link");

  assert.equal(hidden.proof_summary, null);
  assert.equal(hidden.lines[0]?.proof_count, 0);
  assert.equal(hidden.lines[0]?.proof_review_required, true);
  assert.deepEqual(hidden.lines[0]?.proofs, []);
  assert.equal(hidden.lookups.proofs, null);

  assert.equal(statusOnly.proof_summary?.access_mode, "status_only");
  assert.equal(reviewLink.proof_summary?.access_mode, "review_link");
  assert.equal(reviewLink.proof_summary?.review_url, null);
  assert.equal(statusOnly.lines[0]?.proofs[0]?.proof_filename, "normalized-proof.jpg");

  for (const snapshot of [hidden, statusOnly, reviewLink]) {
    const serialized = JSON.stringify(snapshot);
    assert.equal(serialized.includes("proof-low.example.invalid"), false);
    assert.equal(serialized.includes("proof-high.example.invalid"), false);
    assert.equal(snapshot.proof_summary?.decisions_enabled ?? false, false);
  }
});

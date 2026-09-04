import assert from "node:assert/strict";
import test from "node:test";

import { sampleCanonicalOrder } from "@pathfinder/canonical";
import {
  applyLiftOrderDateFormat,
  applyLiftOrderOutputMappings,
  buildLiftOrderLookupUrl,
  buildLiftSubmitRequest,
  buildLiftProofReportUrl,
  buildLiftShippingReportUrl,
  generateLiftPayload,
  prepareLiftOrderDateFormat,
  validateLiftPayload,
  type LiftOrderPayload
} from "../src/index.ts";

test("builds an AS360Orders lookup with customer and Ext_ID identity parameters", () => {
  const built = buildLiftOrderLookupUrl(
    "https://lift.example/AS360Orders/N?offset=0&p2=30",
    "A0230112",
    { customerId: "284619", externalId: "PFMTLOIWSFEFAF" }
  );
  const url = new URL(built!);
  assert.equal(url.searchParams.get("p0"), "A0230112");
  assert.equal(url.searchParams.get("p1"), "284619");
  assert.equal(url.searchParams.has("p2"), false);
  assert.equal(url.searchParams.get("p3"), "PFMTLOIWSFEFAF");
});

test("formats Lift order dates with four-digit years at the output boundary", () => {
  const source = generateLiftPayload({
    ...sampleCanonicalOrder,
    order: {
      ...sampleCanonicalOrder.order,
      ship_date: "7/3/26",
      due_date: "2026-11-09"
    }
  });

  const formatted = applyLiftOrderDateFormat(source, "MM/DD/YYYY");

  assert.equal(formatted.order.requested_ship_date, "07/03/2026");
  assert.equal(formatted.order.due_date, "11/09/2026");
});

test("supports an explicit ISO Lift target date format", () => {
  const source = generateLiftPayload({
    ...sampleCanonicalOrder,
    order: {
      ...sampleCanonicalOrder.order,
      ship_date: "07/03/2026",
      due_date: "11/9/26"
    }
  });

  const formatted = applyLiftOrderDateFormat(source, "YYYY-MM-DD");

  assert.equal(formatted.order.requested_ship_date, "2026-07-03");
  assert.equal(formatted.order.due_date, "2026-11-09");
});

test("the Lift transport boundary formats legacy prepared payloads and rejects invalid dates", () => {
  const legacy = generateLiftPayload({
    ...sampleCanonicalOrder,
    order: {
      ...sampleCanonicalOrder.order,
      ship_date: "7/3/26",
      due_date: "11/9/26"
    }
  });
  const request = buildLiftSubmitRequest(legacy);

  assert.equal(request.body.order.requested_ship_date, "07/03/2026");
  assert.equal(request.body.order.due_date, "11/09/2026");
  assert.equal(legacy.order.requested_ship_date, "7/3/26");
  assert.throws(
    () =>
      buildLiftSubmitRequest({
        ...legacy,
        order: { ...legacy.order, requested_ship_date: "02/30/2026" }
      }),
    /Requested ship date must be a real date/
  );
});

test("preview formatting blocks an invalid date without retaining it in Lift output", () => {
  const source = generateLiftPayload({
    ...sampleCanonicalOrder,
    order: {
      ...sampleCanonicalOrder.order,
      ship_date: "02/30/2026",
      due_date: "11/09/2026"
    }
  });

  const result = prepareLiftOrderDateFormat(source);

  assert.equal("requested_ship_date" in result.payload.order, false);
  assert.equal(result.payload.order.due_date, "11/09/2026");
  assert.deepEqual(result.validation.map((message) => message.code), ["LIFT-ORDER-DATE-FORMAT"]);
});

test("always scopes ProofReport reads to one exact order and optional line", () => {
  const base = "https://lift.example.invalid/ords/lifterp/lift/erp/flush/ondemand/91/AS360ProofReport/N?offset=0";
  assert.equal(
    buildLiftProofReportUrl(base, "A0226753"),
    "https://lift.example.invalid/ords/lifterp/lift/erp/flush/ondemand/91/AS360ProofReport/N?offset=0&p1=A0226753"
  );
  assert.equal(
    buildLiftProofReportUrl(base, "A0226753", 9748545),
    "https://lift.example.invalid/ords/lifterp/lift/erp/flush/ondemand/91/AS360ProofReport/N?offset=0&p1=A0226753&p2=9748545"
  );
  assert.equal(buildLiftProofReportUrl(base, ""), null);
});

test("always scopes ShippingReport reads to one exact order and optional line", () => {
  const base = "https://lift.example.invalid/ords/lifterp/lift/erp/flush/ondemand/91/ShippingReport/N?offset=0";
  assert.equal(
    buildLiftShippingReportUrl(base, "A0221993"),
    "https://lift.example.invalid/ords/lifterp/lift/erp/flush/ondemand/91/ShippingReport/N?offset=0&p1=A0221993"
  );
  assert.equal(
    buildLiftShippingReportUrl(base, "A0221993", 9368150),
    "https://lift.example.invalid/ords/lifterp/lift/erp/flush/ondemand/91/ShippingReport/N?offset=0&p1=A0221993&p2=9368150"
  );
  assert.equal(buildLiftShippingReportUrl(base, ""), null);
});

function payload(orderTitle: string | null): LiftOrderPayload {
  return {
    customer: {
      lift_customer_id: "1249",
      customer_name: "LTL Demo",
      crm_id: null
    },
    contacts: [],
    source: {
      platform: "Pathfinder",
      pathfinder_customer_id: "lift:284619",
      source_system: "Manual Upload",
      source_customer: "Momentara",
      source_record_id: "C316860",
      source_record_url: null,
      source_template: "Manual XLSX",
      submitted_at: "2026-07-21T14:24:30.752Z",
      pathfinder_job_id: "job_test",
      pathfinder_canonical_order_id: "co_test"
    },
    order: {
      ext_id: "PFMRT-TEST",
      po_number: null,
      contract_number: "C316860",
      order_title: orderTitle,
      order_note: null,
      requested_ship_date: null,
      due_date: null,
      order_attachment: null,
      artwork_folder_url: null,
      reference_proof_url: null,
      shipping: {
        method: null,
        account_number: null,
        acct_billing_zip: null,
        acct_billing_country: null,
        attention_to: null,
        company: null,
        address_1: null,
        address_2: null,
        city: null,
        state: null,
        postal_code: null,
        country: "US",
        phone: null,
        email: null,
        instructions: null
      }
    },
    lines: [
      {
        line_number: 1,
        unit_number: "TEST-UNIT",
        customer_sku: "TEST-SKU",
        description: "Test product",
        product_id: "348390",
        product_name: "Test product",
        quantity: 1,
        artwork: { file_name: null, file_url: null, checksum: null },
        dimensions: {
          final_height: null,
          final_width: null,
          live_height: null,
          live_width: null,
          bleed: null
        },
        production: {
          material: null,
          laminate: null,
          coating: null,
          premask: null,
          ink: null
        },
        line_note: null
      }
    ]
  };
}

test("Lift validation blocks a missing order title", () => {
  const messages = validateLiftPayload(payload(null));

  assert.equal(messages.some((message) => message.code === "LIFT-ORDER-TITLE" && message.severity === "FAIL"), true);
});

test("Lift validation accepts a resolved order title", () => {
  const messages = validateLiftPayload(payload("C316860 - Momentara Web Order - 20260721"));

  assert.deepEqual(messages.map((message) => message.code), ["LIFT-OK"]);
});

test("one canonical order value can fan out to multiple configured output fields", () => {
  const canonical = {
    ...sampleCanonicalOrder,
    order: { ...sampleCanonicalOrder.order, contract_number: "C316870", po_number: null }
  };
  const result = applyLiftOrderOutputMappings(generateLiftPayload(canonical), canonical, [
    { sourceColumn: "body:order.contract_number", targetField: "order.contract_number" },
    { sourceColumn: "body:order.po_number", targetField: "order.contract_number" }
  ]);

  assert.equal(result.order.contract_number, "C316870");
  assert.equal(result.order.po_number, "C316870");
});

test("omits empty optional values from the final Lift JSON without removing zero or false", () => {
  const canonical = {
    ...sampleCanonicalOrder,
    customer: { ...sampleCanonicalOrder.customer, crm_id: null },
    source: { ...sampleCanonicalOrder.source, source_record_url: null, source_template: null },
    order: {
      ...sampleCanonicalOrder.order,
      po_number: null,
      order_note: null,
      due_date: null,
      shipping: null
    },
    lines: sampleCanonicalOrder.lines.map((line) => ({
      ...line,
      customer_sku: null,
      artwork: { file_name: null, file_url: null, checksum: null },
      dimensions: {
        ...line.dimensions,
        final_width: 0,
        live_width: null,
        bleed: null
      },
      production: { material: null, laminate: false },
      line_note: null
    }))
  };

  const result = generateLiftPayload(canonical);
  const serialized = JSON.stringify(result);

  assert.equal(serialized.includes(":null"), false);
  assert.equal("crm_id" in result.customer, false);
  assert.equal("source_record_url" in result.source, false);
  assert.equal("po_number" in result.order, false);
  assert.equal("shipping" in result.order, false);
  assert.equal("artwork" in result.lines[0], false);
  assert.equal("customer_sku" in result.lines[0], false);
  assert.equal(result.lines[0].dimensions.final_width, 0);
  assert.equal(result.lines[0].production?.laminate, false);
  assert.equal("material" in (result.lines[0].production ?? {}), false);
});

test("output mappings cannot reintroduce a null value", () => {
  const canonical = {
    ...sampleCanonicalOrder,
    order: { ...sampleCanonicalOrder.order, po_number: null }
  };
  const result = applyLiftOrderOutputMappings(generateLiftPayload(canonical), canonical, [
    { sourceColumn: "body:order.po_number", targetField: "order.po_number" }
  ]);

  assert.equal("po_number" in result.order, false);
  assert.equal(JSON.stringify(result).includes(":null"), false);
});

test("strips null values again at the transport boundary for previously stored payloads", () => {
  const request = buildLiftSubmitRequest(payload("C316860 - Momentara Web Order - 20260721"));

  assert.equal(JSON.stringify(request.body).includes(":null"), false);
  assert.equal("po_number" in request.body.order, false);
  assert.equal("artwork" in request.body.lines[0], false);
});

test("maps source-document URLs to distinct configurable Lift create-order fields", () => {
  const result = generateLiftPayload({
    ...sampleCanonicalOrder,
    order: {
      ...sampleCanonicalOrder.order,
      order_attachment: "https://wrike.example/attachments/order.xlsx",
      artwork_folder_url: "https://momentara.sharepoint.com/sites/art/Shared%20Documents/C123456",
      reference_proof_url: "https://go.vornan.co/d/reference/proof.pdf"
    }
  }, undefined, {
    order_attachment: "source_order_grid_url",
    artwork_folder_url: "artwork_folder_url",
    reference_proof_url: "reference_proof_pdf_url"
  });

  assert.equal(result.order.source_order_grid_url, "https://wrike.example/attachments/order.xlsx");
  assert.equal(
    result.order.artwork_folder_url,
    "https://momentara.sharepoint.com/sites/art/Shared%20Documents/C123456"
  );
  assert.equal(result.order.reference_proof_pdf_url, "https://go.vornan.co/d/reference/proof.pdf");
  assert.equal("FLEX_FIELD9" in result.order, false);
});

test("rejects colliding or unsafe document output-field configuration", () => {
  assert.throws(
    () => generateLiftPayload(sampleCanonicalOrder, undefined, {
      order_attachment: "attachment_url",
      artwork_folder_url: "attachment_url",
      reference_proof_url: "reference_proof_url"
    }),
    /must be distinct/
  );
  assert.throws(
    () => generateLiftPayload(sampleCanonicalOrder, undefined, {
      order_attachment: "order_attachment",
      artwork_folder_url: "bad.field",
      reference_proof_url: "reference_proof_url"
    }),
    /output field is invalid/
  );
  assert.throws(
    () => generateLiftPayload(sampleCanonicalOrder, undefined, {
      order_attachment: "order_attachment",
      artwork_folder_url: "ext_id",
      reference_proof_url: "reference_proof_url"
    }),
    /output field is invalid/
  );
});

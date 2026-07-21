import assert from "node:assert/strict";
import test from "node:test";

import { validateLiftPayload, type LiftOrderPayload } from "../src/index.ts";

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

import assert from "node:assert/strict";
import test from "node:test";
import {
  As360OrdersV2Error,
  buildAs360OrdersV2Url,
  readAs360OrdersV2
} from "../src/as360-orders-v2.ts";

const baseUrl = "https://lift.example/AS360Orders/N?offset=99&rows=500";

test("builds a tenant-bound exact-order URL and omits days and unsupported page size", () => {
  const url = new URL(buildAs360OrdersV2Url(baseUrl, {
    verified_customer_id: "1249",
    order_number: "a0229276",
    days_back: 30
  }));
  assert.equal(url.searchParams.get("offset"), "0");
  assert.equal(url.searchParams.get("p0"), "A0229276");
  assert.equal(url.searchParams.get("p1"), "1249");
  assert.equal(url.searchParams.has("p2"), false);
  assert.equal(url.searchParams.has("rows"), false);
});

test("builds a bounded customer-history URL from the supported day presets", () => {
  const url = new URL(buildAs360OrdersV2Url(baseUrl, {
    verified_customer_id: "1249",
    days_back: 90
  }));
  assert.equal(url.searchParams.has("p0"), false);
  assert.equal(url.searchParams.get("p1"), "1249");
  assert.equal(url.searchParams.get("p2"), "90");
  assert.throws(
    () => buildAs360OrdersV2Url(baseUrl, { verified_customer_id: "1249", days_back: 365 }),
    /1, 7, 30, 90, 180, or 360/
  );
});

test("normalizes only the safe source-neutral customer order projection", async () => {
  let fetchedUrl = "";
  const result = await readAs360OrdersV2(baseUrl, {
    verified_customer_id: "1249",
    days_back: 30,
    fetcher: async (input) => {
      fetchedUrl = String(input);
      return new Response(JSON.stringify({
        rowset: [{
          ORDER_NUMBER: "A0229276",
          CUSTOMER_ID: 1249,
          ORDER_TITLE: "Proof QA clone",
          PO_NUMBER: 10002,
          CUSTOMER_NAME: "LTL Demo",
          CREATION_DATE: "2026-08-24",
          CREATED_BY: "PATHFINDER",
          ORDER_TYPE_NAME: "Premium Graphics",
          ORDER_STATUS: "Pending Art Approval",
          ORDER_STEP_ID: 1037,
          HEADER_STEP_NUMBER: 7.02,
          INTERNAL_URL: "https://lift.example/private",
          LINES: [{
            LINE_NUMBER: 1.01,
            ORDER_LINE_ID: 9955284,
            QUANTITY: 1,
            PRODUCT_NAME: null,
            UNIT_NUMBER: null,
            MATERIAL: ".020 Styrene",
            LINE_STEP_ID: 1037,
            LINE_STEP_NUMBER: 7.02,
            PRINT_H_IN: 46.375,
            PRINT_W_IN: 30.375,
            DOWNLOAD_URL: "https://lift.example/private/art"
          }]
        }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });

  assert.equal(new URL(fetchedUrl).searchParams.get("p1"), "1249");
  assert.equal(result.adapter_version, "as360_orders_v2");
  assert.equal(result.total_count, 1);
  assert.deepEqual(result.orders[0], {
    source: "as360_orders_v2",
    source_order_reference: "A0229276",
    order_number: "A0229276",
    customer_id: "1249",
    customer_name: "LTL Demo",
    order_title: "Proof QA clone",
    po_number: "10002",
    creation_date: "2026-08-24",
    created_by: "PATHFINDER",
    order_type_name: "Premium Graphics",
    order_status: "Pending Art Approval",
    order_step_id: "1037",
    header_step_number: 7.02,
    line_count: 1,
    proof_availability: "not_checked",
    lines: [{
      line_number: "1.01",
      source_line_id: "9955284",
      quantity: 1,
      product_name: null,
      unit_number: null,
      material: ".020 Styrene",
      line_step_id: "1037",
      line_step_number: 7.02,
      print_height_inches: 46.375,
      print_width_inches: 30.375
    }]
  });
  assert.equal("INTERNAL_URL" in result.orders[0], false);
  assert.equal("DOWNLOAD_URL" in result.orders[0].lines[0]!, false);
});

test("treats a null rowset as an empty cross-customer exact-order result", async () => {
  const result = await readAs360OrdersV2(baseUrl, {
    verified_customer_id: "1249",
    order_number: "A0228360",
    fetcher: async () => new Response(JSON.stringify({ rowset: null }), { status: 200 })
  });
  assert.equal(result.total_count, 0);
  assert.deepEqual(result.orders, []);
});

test("fails closed if Lift returns any row outside the verified customer boundary", async () => {
  await assert.rejects(
    readAs360OrdersV2(baseUrl, {
      verified_customer_id: "1249",
      days_back: 30,
      fetcher: async () => new Response(JSON.stringify({
        rowset: [{
          ORDER_NUMBER: "A0228360",
          CUSTOMER_ID: 3201,
          CREATION_DATE: "2026-08-11",
          LINES: []
        }]
      }), { status: 200 })
    }),
    (error: unknown) =>
      error instanceof As360OrdersV2Error && error.code === "customer_boundary_mismatch"
  );
});

test("caps the normalized response locally without sending an unsupported rows parameter", async () => {
  let fetchedUrl = "";
  const result = await readAs360OrdersV2(baseUrl, {
    verified_customer_id: "1249",
    days_back: 7,
    result_limit: 1,
    fetcher: async (input) => {
      fetchedUrl = String(input);
      return new Response(JSON.stringify({
        rowset: [
          { ORDER_NUMBER: "A0229276", CUSTOMER_ID: 1249, CREATION_DATE: "2026-08-24", LINES: [] },
          { ORDER_NUMBER: "A0228753", CUSTOMER_ID: 1249, CREATION_DATE: "2026-08-17", LINES: [] }
        ]
      }), { status: 200 });
    }
  });
  assert.equal(new URL(fetchedUrl).searchParams.has("rows"), false);
  assert.equal(result.total_count, 2);
  assert.equal(result.returned_count, 1);
  assert.equal(result.truncated, true);
  assert.equal(result.orders[0]?.order_number, "A0229276");
});

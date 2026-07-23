import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";

import { mapSourceRowsToCanonicalOrder, parseWorkbookArrayBuffer } from "../src/index.ts";

function workbookBuffer(sheets: Record<string, unknown[][]>) {
  const workbook = XLSX.utils.book_new();
  Object.entries(sheets).forEach(([sheetName, rows]) => {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  });
  return XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

test("auto-detects a single header row and audits repeated headers", async () => {
  const parsed = await parseWorkbookArrayBuffer(
    workbookBuffer({
      Orders: [
        ["Customer order export"],
        ["Generated for Pathfinder"],
        ["Order Number", "SKU", "Qty"],
        ["A-100", "SKU-1", 2],
        ["Order Number", "SKU", "Qty"],
        ["A-101", "SKU-2", 4]
      ]
    })
  );

  const [orders] = parsed.source_sheets;
  assert.deepEqual(orders.columns, ["Order Number", "SKU", "Qty"]);
  assert.equal(orders.header_row, 3);
  assert.equal(orders.header_row_count, 1);
  assert.deepEqual(orders.ignored_header_rows, [5]);
  assert.equal(orders.order_row_count, 2);
  assert.equal(orders.reference_row_count, 0);
  assert.deepEqual(orders.parsed_rows.map((row) => row.row_number), [4, 6]);
});

test("combines duplicate child labels in a two-row grouped header", async () => {
  const parsed = await parseWorkbookArrayBuffer(
    workbookBuffer({
      Orders: [
        ["Order", "Shipping", null, "Billing", null, "Line"],
        ["Order Number", "Address", "City", "Address", "City", "Print Qty"],
        ["A-100", "1 Main St", "Boston", "2 State St", "Chicago", 1]
      ]
    }),
    { headerRowCount: 2 }
  );

  const [orders] = parsed.source_sheets;
  assert.equal(orders.header_row, 1);
  assert.equal(orders.header_row_count, 2);
  assert.deepEqual(orders.columns, [
    "Order Number",
    "Shipping Address",
    "Shipping City",
    "Billing Address",
    "Billing City",
    "Print Qty"
  ]);
  assert.equal(orders.order_row_count, 1);
});

test("keeps blank single-row header cells independent", async () => {
  const parsed = await parseWorkbookArrayBuffer(
    workbookBuffer({
      Orders: [
        ["Order Number", null, "Qty"],
        ["A-100", "unlabeled value", 1]
      ]
    }),
    { headerRow: 1, headerRowCount: 1 }
  );

  assert.deepEqual(parsed.source_sheets[0].columns, ["Order Number", "Column 2", "Qty"]);
  assert.equal(parsed.source_sheets[0].parsed_rows[0].values["Column 2"], "unlabeled value");
});

test("applies independent header row and span overrides to exact workbook sheets", async () => {
  const parsed = await parseWorkbookArrayBuffer(
    workbookBuffer({
      Orders: [
        ["Orders export"],
        ["Prepared for Pathfinder"],
        ["Order Number", "SKU", "Qty"],
        ["A-100", "SKU-1", 2]
      ],
      Catalog: [
        ["Catalog export"],
        ["Product", null, "Inventory"],
        ["SKU", "Description", "Qty"],
        ["SKU-1", "Window decal", 5]
      ]
    }),
    {
      headerRow: 1,
      headerRowCount: 1,
      sheetHeaderOverrides: {
        Orders: { headerRow: 3, headerRowCount: 1 },
        Catalog: { headerRow: 2, headerRowCount: 2 }
      }
    }
  );

  const orders = parsed.source_sheets.find((sheet) => sheet.sheet_name === "Orders");
  const catalog = parsed.source_sheets.find((sheet) => sheet.sheet_name === "Catalog");

  assert.ok(orders);
  assert.ok(catalog);
  assert.equal(orders.header_row, 3);
  assert.equal(orders.header_row_count, 1);
  assert.deepEqual(orders.columns, ["Order Number", "SKU", "Qty"]);
  assert.deepEqual(orders.parsed_rows.map((row) => row.row_number), [4]);
  assert.equal(orders.order_row_count, 1);
  assert.equal(catalog.header_row, 2);
  assert.equal(catalog.header_row_count, 2);
  assert.deepEqual(catalog.columns, ["SKU", "Description", "Qty"]);
  assert.deepEqual(catalog.parsed_rows.map((row) => row.row_number), [4]);
  assert.equal(catalog.order_row_count, 1);
});

test("maps a customer artwork-folder field separately from the imported order attachment", () => {
  const order = mapSourceRowsToCanonicalOrder(
    [
      {
        "Order Number": "C123456",
        "Artwork Folder": "https://momentara.sharepoint.com/sites/art/Shared%20Documents/C123456",
        "Source Workbook": "https://wrike.example/attachments/order.xlsx",
        Quantity: 1,
        Width: 12,
        Height: 18,
        Product: "Poster"
      }
    ],
    [
      { sourceColumn: "Order Number", targetField: "order.external_order_id", required: true },
      { sourceColumn: "Artwork Folder", targetField: "order.artwork_folder_url", required: false },
      { sourceColumn: "Source Workbook", targetField: "order.order_attachment", required: false },
      { sourceColumn: "Quantity", targetField: "lines[].quantity", required: true },
      { sourceColumn: "Width", targetField: "lines[].dimensions.final_width", required: true },
      { sourceColumn: "Height", targetField: "lines[].dimensions.final_height", required: true },
      { sourceColumn: "Product", targetField: "lines[].unit_number", required: true }
    ],
    {
      customerId: "lift:284619",
      customerName: "Momentara",
      sourceSystem: "Wrike",
      sourceCustomer: "Momentara",
      targetSystem: "Lift"
    }
  );

  assert.equal(
    order.order.artwork_folder_url,
    "https://momentara.sharepoint.com/sites/art/Shared%20Documents/C123456"
  );
  assert.equal(order.order.order_attachment, "https://wrike.example/attachments/order.xlsx");
});

import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { sampleCanonicalOrder, validateCanonicalOrder } from "@pathfinder/canonical";

import {
  mapSourceRowsToCanonicalOrder,
  parseWorkbookArrayBuffer,
  resolveFieldMappingValue
} from "../src/index.ts";

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

test("detects a second hardware section and blocks a populated line without quantity", async () => {
  const parsed = await parseWorkbookArrayBuffer(
    workbookBuffer({
      "Order Form": [
        ["Description", "Media Type", "Final Size Width", "Final Size Length", "Print QTY"],
        ["Poster", "GPA", 30, 46, 2],
        [],
        ["Hardware", "PS SKU", "SIGN TYPE", "Item SKU", "Description", "PS Part Number", "Qty. Needed", "Notes"],
        [null, "AOM397", "Hardware", "FRAME-20X12", "20x12 / Clip Frames", "PART-397", null, null],
        [null, "AOM398", "Hardware", "FRAME-24X18", "24x18 / Clip Frames", "PART-398", 3, null]
      ]
    })
  );

  const [sheet] = parsed.source_sheets;
  assert.equal(sheet.sections.length, 2);
  assert.equal(sheet.sections[0].line_kind, "print");
  assert.equal(sheet.sections[1].line_kind, "hardware");
  assert.equal(sheet.sections[1].quantity_column, "Qty. Needed");
  assert.equal(sheet.sections[1].order_row_count, 1);
  assert.equal(sheet.sections[1].incomplete_row_count, 1);
  assert.equal(parsed.parsed_order_rows.length, 2);
  assert.equal(parsed.incomplete_rows.length, 1);
  assert.equal(parsed.incomplete_rows[0].values.Description, "20x12 / Clip Frames");
});

test("includes only AMZ Locker rows with a whole quantity of one or greater", async () => {
  const parsed = await parseWorkbookArrayBuffer(
    workbookBuffer({
      "AMZ Lockers": [
        ["Description", "Creative", "Qty"],
        ["Locker A", "Creative A", null],
        ["Locker B", "Creative B", 0],
        ["Locker C", "Creative C", "0"],
        ["Locker D", "Creative D", 0.5],
        ["Locker E", "Creative E", 1],
        ["Locker F", "Creative F", "2"]
      ]
    }),
    {
      referenceRowsMode: "rows_without_quantity",
      sheetConfigs: {
        "AMZ Lockers": {
          role: "order_lines",
          enabled: true,
          sections: [
            {
              sectionId: "amz-lockers",
              label: "Amazon lockers",
              lineKind: "print",
              headerRow: 1,
              headerRowCount: 1,
              headerSignature: ["Description", "Creative", "Qty"],
              quantityColumn: "Qty",
              missingQuantityBehavior: "reference",
              required: true
            }
          ]
        }
      }
    }
  );

  const [sheet] = parsed.source_sheets;
  assert.equal(sheet.order_row_count, 2);
  assert.equal(sheet.reference_row_count, 4);
  assert.deepEqual(
    parsed.parsed_order_rows.map((row) => row.values.Description),
    ["Locker E", "Locker F"]
  );
});

test("relocates configured sections by their saved columns when row counts change", async () => {
  const printHeader = ["Description", "Creative", "Print QTY"];
  const hardwareHeader = ["Hardware", "PS SKU", "Item SKU", "Description", "Qty. Needed"];

  for (const hardwareHeaderRow of [5, 13, 35, 40]) {
    const rows: unknown[][] = [
      printHeader,
      ["Poster 1", "Creative 1", 1]
    ];
    while (rows.length < hardwareHeaderRow - 1) {
      const ordinal = rows.length;
      rows.push([`Poster ${ordinal}`, `Creative ${ordinal}`, 1]);
    }
    rows.push(hardwareHeader);
    rows.push(["GNA Tops", "AOM403", "8417-002", "1924-Printed Top", 2]);

    const parsed = await parseWorkbookArrayBuffer(
      workbookBuffer({ "Order Form": rows }),
      {
        sheetConfigs: {
          "Order Form": {
            role: "order_lines",
            enabled: true,
            sections: [
              {
                sectionId: "print-products",
                label: "Print products",
                lineKind: "print",
                headerRow: 1,
                headerRowCount: 1,
                headerSignature: printHeader,
                quantityColumn: "Print QTY",
                missingQuantityBehavior: "reference",
                required: true
              },
              {
                sectionId: "hardware-products",
                label: "Hardware",
                lineKind: "hardware",
                headerRow: 13,
                headerRowCount: 1,
                headerSignature: hardwareHeader,
                quantityColumn: "Qty. Needed",
                missingQuantityBehavior: "block",
                required: false
              }
            ]
          }
        }
      }
    );

    const orderForm = parsed.source_sheets[0];
    assert.deepEqual(
      orderForm.sections.map((section) => [section.section_id, section.header_row]),
      [
        ["print-products", 1],
        ["hardware-products", hardwareHeaderRow]
      ]
    );
    assert.equal(
      orderForm.sections.find((section) => section.section_id === "hardware-products")?.order_row_count,
      1
    );
    assert.equal(
      parsed.parsed_order_rows.at(-1)?.scope_id,
      "Order Form::hardware-products"
    );
  }
});

test("fails closed when configured section columns match more than one row", async () => {
  const hardwareHeader = ["Hardware", "PS SKU", "Item SKU", "Description", "Qty. Needed"];

  await assert.rejects(
    () =>
      parseWorkbookArrayBuffer(
        workbookBuffer({
          "Order Form": [
            ["Description", "Creative", "Print QTY"],
            ["Poster", "Creative", 1],
            hardwareHeader,
            ["GNA Tops", "AOM403", "8417-002", "1924-Printed Top", 2],
            hardwareHeader,
            ["Frames", "AOM397", "FRAME-20X12", "20x12 / Clip Frames", 3]
          ]
        }),
        {
          sheetConfigs: {
            "Order Form": {
              role: "order_lines",
              enabled: true,
              sections: [
                {
                  sectionId: "hardware-products",
                  label: "Hardware",
                  lineKind: "hardware",
                  headerRow: 3,
                  headerRowCount: 1,
                  headerSignature: hardwareHeader,
                  quantityColumn: "Qty. Needed",
                  missingQuantityBehavior: "block",
                  required: true
                }
              ]
            }
          }
        }
      ),
    /matched multiple header rows: 3, 5/
  );
});

test("fails closed when required configured section columns are missing", async () => {
  await assert.rejects(
    () =>
      parseWorkbookArrayBuffer(
        workbookBuffer({
          "Order Form": [
            ["Description", "Creative", "Print QTY"],
            ["Poster", "Creative", 1]
          ]
        }),
        {
          sheetConfigs: {
            "Order Form": {
              role: "order_lines",
              enabled: true,
              sections: [
                {
                  sectionId: "hardware-products",
                  label: "Required hardware",
                  lineKind: "hardware",
                  headerRow: 13,
                  headerRowCount: 1,
                  headerSignature: ["Hardware", "PS SKU", "Item SKU", "Description", "Qty. Needed"],
                  quantityColumn: "Qty. Needed",
                  missingQuantityBehavior: "block",
                  required: true
                }
              ]
            }
          }
        }
      ),
    /missing the required "Required hardware" header columns/
  );
});

test("allows an optional configured hardware section to be absent", async () => {
  const parsed = await parseWorkbookArrayBuffer(
    workbookBuffer({
      "Order Form": [
        ["Description", "Creative", "Print QTY"],
        ["Poster", "Creative", 1]
      ]
    }),
    {
      sheetConfigs: {
        "Order Form": {
          role: "order_lines",
          enabled: true,
          sections: [
            {
              sectionId: "print-products",
              label: "Print products",
              lineKind: "print",
              headerRow: 1,
              headerRowCount: 1,
              headerSignature: ["Description", "Creative", "Print QTY"],
              quantityColumn: "Print QTY",
              missingQuantityBehavior: "reference",
              required: true
            },
            {
              sectionId: "hardware-products",
              label: "Hardware",
              lineKind: "hardware",
              headerRow: 13,
              headerRowCount: 1,
              headerSignature: ["Hardware", "PS SKU", "Item SKU", "Description", "Qty. Needed"],
              quantityColumn: "Qty. Needed",
              missingQuantityBehavior: "block",
              required: false
            }
          ]
        }
      }
    }
  );

  assert.deepEqual(parsed.source_sheets[0].sections.map((section) => section.section_id), ["print-products"]);
  assert.equal(parsed.parsed_order_rows.length, 1);
});

test("applies configured roles and sections independently across workbook sheets", async () => {
  const parsed = await parseWorkbookArrayBuffer(
    workbookBuffer({
      "Order Form": [
        ["Description", "Print QTY"],
        ["Poster", 2]
      ],
      "AMZ LOCKERS": [
        ["Item SKU", "Description", "Qty. Needed"],
        ["LOCKER-1", "Locker placard", 4]
      ],
      "Ship List": [
        ["Address", "City", "Quantity"],
        ["1 Main St", "Boston", 2]
      ],
      Notes: [["Reference only"], ["Do not import"]]
    }),
    {
      sheetConfigs: {
        "Order Form": {
          role: "order_lines",
          enabled: true,
          sections: []
        },
        "AMZ LOCKERS": {
          role: "order_lines",
          enabled: true,
          sections: [
            {
              sectionId: "locker-hardware",
              label: "Locker hardware",
              lineKind: "hardware",
              headerRow: 1,
              headerRowCount: 1,
              quantityColumn: "Qty. Needed",
              missingQuantityBehavior: "block",
              required: false
            }
          ]
        },
        "Ship List": {
          role: "shipping_attachment",
          enabled: true,
          sections: []
        },
        Notes: {
          role: "ignore",
          enabled: false,
          sections: []
        }
      }
    }
  );

  assert.equal(parsed.parsed_order_rows.length, 2);
  assert.deepEqual(
    parsed.parsed_order_rows.map((row) => [row.sheet_name, row.line_kind, row.section_id]),
    [
      ["Order Form", "print", "order-form-print-1"],
      ["AMZ LOCKERS", "hardware", "locker-hardware"]
    ]
  );
  assert.equal(parsed.source_sheets.find((sheet) => sheet.sheet_name === "Ship List")?.role, "shipping_attachment");
  assert.equal(parsed.source_sheets.find((sheet) => sheet.sheet_name === "Ship List")?.parsed_rows.length, 0);
  assert.equal(parsed.source_sheets.find((sheet) => sheet.sheet_name === "Notes")?.role, "ignore");
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

test("applies section-scoped canonical mappings without cross-sheet column collisions", () => {
  const order = mapSourceRowsToCanonicalOrder(
    [
      {
        __pathfinder_scope_id: "Order Form::print",
        Description: "Printed poster",
        "Print QTY": 2,
        Width: 30,
        Height: 46
      },
      {
        __pathfinder_scope_id: "Order Form::hardware",
        Description: "Clip frame",
        "Qty. Needed": 3,
        "Item SKU": "FRAME-20X12"
      }
    ],
    [
      {
        sourceColumn: "Description",
        targetField: "lines[].product_name",
        scopeId: "Order Form::print"
      },
      {
        sourceColumn: "Print QTY",
        targetField: "lines[].quantity",
        scopeId: "Order Form::print"
      },
      {
        sourceColumn: "Width",
        targetField: "lines[].dimensions.final_width",
        scopeId: "Order Form::print"
      },
      {
        sourceColumn: "Height",
        targetField: "lines[].dimensions.final_height",
        scopeId: "Order Form::print"
      },
      {
        sourceColumn: "Description",
        targetField: "lines[].product_name",
        scopeId: "Order Form::hardware"
      },
      {
        sourceColumn: "Qty. Needed",
        targetField: "lines[].quantity",
        scopeId: "Order Form::hardware"
      },
      {
        sourceColumn: "Item SKU",
        targetField: "lines[].customer_sku",
        scopeId: "Order Form::hardware"
      }
    ],
    {
      customerId: "lift:284619",
      customerName: "Momentara",
      sourceSystem: "Wrike",
      sourceCustomer: "Momentara",
      targetSystem: "Lift"
    }
  );

  assert.equal(order.lines[0].product_name, "Printed poster");
  assert.equal(order.lines[0].quantity, 2);
  assert.equal(order.lines[1].product_name, "Clip frame");
  assert.equal(order.lines[1].customer_sku, "FRAME-20X12");
  assert.equal(order.lines[1].quantity, 3);
});

test("builds different composite line descriptions for print and hardware sections", () => {
  const order = mapSourceRowsToCanonicalOrder(
    [
      {
        __pathfinder_scope_id: "Order Form::print",
        DESCRIPTION: "Pump topper",
        Creative: "Chevron",
        "Print QTY": 2,
        Width: 30,
        Height: 46,
        "SIGN TYPE": "Pump Topper"
      },
      {
        __pathfinder_scope_id: "Order Form::hardware",
        Hardware: "GNA Tops",
        Description: "1924-Printed Top",
        "Item SKU": "8417-002",
        "PS SKU": "AOM403",
        "Qty. Needed": 585
      },
      {
        __pathfinder_scope_id: "Order Form::hardware",
        Hardware: "20x12 / Clip Frames",
        Description: null,
        "Item SKU": null,
        "PS SKU": "AOM397",
        "Qty. Needed": 24
      }
    ],
    [
      {
        sourceColumn: "",
        targetField: "lines[].description",
        scopeId: "Order Form::print",
        valueExpression: {
          kind: "composite",
          sourceColumns: ["DESCRIPTION", "Creative"],
          separator: " — ",
          prefix: "",
          suffix: "",
          skipEmpty: true,
          fallback: null,
          maxLength: 250
        }
      },
      {
        sourceColumn: "SIGN TYPE",
        targetField: "lines[].unit_number",
        scopeId: "Order Form::print"
      },
      {
        sourceColumn: "Print QTY",
        targetField: "lines[].quantity",
        scopeId: "Order Form::print"
      },
      {
        sourceColumn: "Width",
        targetField: "lines[].dimensions.final_width",
        scopeId: "Order Form::print"
      },
      {
        sourceColumn: "Height",
        targetField: "lines[].dimensions.final_height",
        scopeId: "Order Form::print"
      },
      {
        sourceColumn: "",
        targetField: "lines[].description",
        scopeId: "Order Form::hardware",
        valueExpression: {
          kind: "composite",
          sourceColumns: ["Hardware", "Description", "Item SKU"],
          separator: " — ",
          prefix: "",
          suffix: "",
          skipEmpty: true,
          fallback: null,
          maxLength: 250
        }
      },
      {
        sourceColumn: "PS SKU",
        targetField: "lines[].unit_number",
        scopeId: "Order Form::hardware"
      },
      {
        sourceColumn: "Qty. Needed",
        targetField: "lines[].quantity",
        scopeId: "Order Form::hardware"
      }
    ],
    {
      customerId: "lift:284619",
      customerName: "Momentara",
      sourceSystem: "Wrike",
      sourceCustomer: "Momentara",
      targetSystem: "Lift"
    }
  );

  assert.equal(order.lines[0].description, "Pump topper — Chevron");
  assert.equal(order.lines[1].description, "GNA Tops — 1924-Printed Top — 8417-002");
  assert.equal(order.lines[2].description, "20x12 / Clip Frames");
});

test("fails a bounded composite closed when its resolved value exceeds the configured maximum", () => {
  const result = resolveFieldMappingValue(
    { Description: "12345", Creative: "67890" },
    {
      sourceColumn: "",
      targetField: "lines[].description",
      valueExpression: {
        kind: "composite",
        sourceColumns: ["Description", "Creative"],
        separator: " ",
        prefix: "",
        suffix: "",
        skipEmpty: true,
        fallback: null,
        maxLength: 8
      }
    }
  );

  assert.equal(result.status, "max_length_exceeded");
  assert.equal(result.value, null);
});

test("an explicit ignored mapping never resolves its source value", () => {
  const result = resolveFieldMappingValue(
    { DESCRIPTION: "Pump topper" },
    {
      sourceColumn: "DESCRIPTION",
      targetField: "lines[].description",
      scopeId: "Order Form::print",
      ignored: true
    }
  );

  assert.equal(result.status, "empty");
  assert.equal(result.value, null);
});

test("does not invent print dimensions for an explicitly mapped hardware product", () => {
  const baseLine = sampleCanonicalOrder.lines[0];
  const hardwareOrder = {
    ...sampleCanonicalOrder,
    lines: [
      {
        ...baseLine,
        line_kind: "hardware" as const,
        dimensions: {
          ...baseLine.dimensions,
          final_width: 0,
          final_height: 0
        }
      }
    ]
  };
  const printOrder = {
    ...hardwareOrder,
    lines: hardwareOrder.lines.map((line) => ({ ...line, line_kind: "print" as const }))
  };

  const hardwareCodes = validateCanonicalOrder(hardwareOrder).map((message) => message.code);
  const printCodes = validateCanonicalOrder(printOrder).map((message) => message.code);

  assert.equal(hardwareCodes.includes("VAL-DIM-W"), false);
  assert.equal(hardwareCodes.includes("VAL-DIM-H"), false);
  assert.equal(printCodes.includes("VAL-DIM-W"), true);
  assert.equal(printCodes.includes("VAL-DIM-H"), true);
});

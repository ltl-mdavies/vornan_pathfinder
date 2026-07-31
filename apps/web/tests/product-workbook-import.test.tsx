import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedSourceRow, ParsedWorkbookSheet } from "@pathfinder/templates";
import {
  PRODUCT_WORKBOOK_KEY_COLUMN,
  PRODUCT_WORKBOOK_NAME_COLUMN,
  PRODUCT_WORKBOOK_SHEET_COLUMN,
  inferProductWorkbookProfile,
  productWorkbookProfileGrid
} from "../src/product-workbook-import";

function sheet(name: string, columns: string[], values: Array<Record<string, string>>): ParsedWorkbookSheet {
  const rows = values.map((row, index) => ({
    sheet_name: name,
    row_number: index + 2,
    row_type: "reference",
    scope_id: `${name}-scope`,
    section_id: `${name}-section`,
    section_label: name,
    line_kind: "print",
    values: row
  } satisfies ParsedSourceRow));
  return {
    sheet_name: name,
    role: "order_lines",
    columns,
    order_row_count: 0,
    reference_row_count: rows.length,
    incomplete_row_count: 0,
    parsed_rows: rows,
    sections: [],
    header_row: 1,
    header_row_count: 1,
    ignored_header_rows: []
  };
}

test("combines standard product tabs and a PS SKU hardware tab into one canonical preview", () => {
  const profiles = [
    inferProductWorkbookProfile(sheet("NEW Pricing", ["DESCRIPTION", "Final Size Width", "Final Size Length"], [
      { DESCRIPTION: "Pump topper", "Final Size Width": "20", "Final Size Length": "12" }
    ])),
    inferProductWorkbookProfile(sheet("AMZ Lockers", ["DESCRIPTION", "SIGN TYPE"], [
      { DESCRIPTION: "Gen2 Locker", "SIGN TYPE": "Amazon Lockers" }
    ])),
    inferProductWorkbookProfile(sheet("Hardware", ["Hardware", "PS SKU", "Item SKU", "Description"], [
      { Hardware: "Clip Frames", "PS SKU": "AOM397", "Item SKU": "20 x 12", Description: "Magnetic frame" }
    ]))
  ];

  const grid = productWorkbookProfileGrid(profiles);
  assert.equal(grid.rows.length, 3);
  assert.equal(grid.rows[0]?.[PRODUCT_WORKBOOK_KEY_COLUMN], "Pump topper");
  assert.equal(grid.rows[1]?.[PRODUCT_WORKBOOK_SHEET_COLUMN], "AMZ Lockers");
  assert.equal(grid.rows[2]?.[PRODUCT_WORKBOOK_KEY_COLUMN], "AOM397");
  assert.equal(
    grid.rows[2]?.[PRODUCT_WORKBOOK_NAME_COLUMN],
    "Clip Frames · AOM397 · 20 x 12 · Magnetic frame"
  );
  assert.equal(profiles[2]?.kind, "hardware");
  assert.equal(profiles[2]?.key_column, "PS SKU");
});

test("ignores unknown sheets and excludes explicitly disabled tabs", () => {
  const unknown = inferProductWorkbookProfile(sheet("Notes", ["Comment"], [{ Comment: "Reference only" }]));
  const standard = inferProductWorkbookProfile(sheet("Ice Boxes", ["DESCRIPTION"], [{ DESCRIPTION: "Ice Box Door" }]));
  standard.included = false;
  const grid = productWorkbookProfileGrid([unknown, standard]);

  assert.equal(unknown.kind, "ignore");
  assert.equal(unknown.included, false);
  assert.equal(grid.rows.length, 0);
});

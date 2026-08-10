import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ImportMethodWorkbookSetup } from "../src/ImportMethodWorkbookSetup";

test("renders configurable sheet roles and independent print and hardware sections", () => {
  const markup = renderToStaticMarkup(
    <ImportMethodWorkbookSetup
      sheets={[
        {
          sheet_name: "Order Form",
          role: "order_lines",
          columns: ["Description", "Print QTY", "Item SKU", "Qty. Needed"],
          order_row_count: 38,
          reference_row_count: 0,
          incomplete_row_count: 1,
          sections: [
            {
              section_id: "order-form-print-1",
              label: "Printed products",
              line_kind: "print",
              columns: ["Description", "Print QTY"],
              header_row: 1,
              header_row_count: 1,
              quantity_column: "Print QTY",
              missing_quantity_behavior: "reference",
              order_row_count: 37,
              reference_row_count: 0,
              incomplete_row_count: 0
            },
            {
              section_id: "order-form-hardware-39",
              label: "Hardware",
              line_kind: "hardware",
              columns: ["Item SKU", "Description", "Qty. Needed"],
              header_row: 39,
              header_row_count: 1,
              quantity_column: "Qty. Needed",
              quantity_value_rules: [{ source_value: "TBD", output_quantity: 0.5 }],
              missing_quantity_behavior: "block",
              order_row_count: 1,
              reference_row_count: 0,
              incomplete_row_count: 1
            }
          ]
        },
        {
          sheet_name: "Ship List",
          role: "shipping_attachment",
          columns: [],
          order_row_count: 0,
          reference_row_count: 0,
          sections: []
        }
      ]}
      structure={{
        "Order Form": {
          role: "order_lines",
          enabled: true,
          sections: [
            {
              section_id: "order-form-print-1",
              label: "Printed products",
              line_kind: "print",
              header_row: 1,
              header_row_count: 1,
              header_signature: ["Description", "Print QTY"],
              quantity_column: "Print QTY",
              missing_quantity_behavior: "reference",
              required: true
            },
            {
              section_id: "order-form-hardware-39",
              label: "Hardware",
              line_kind: "hardware",
              header_row: 39,
              header_row_count: 1,
              header_signature: ["Item SKU", "Description", "Qty. Needed"],
              quantity_column: "Qty. Needed",
              quantity_value_rules: [{ source_value: "TBD", output_quantity: 0.5 }],
              missing_quantity_behavior: "block",
              required: false
            }
          ]
        },
        "Ship List": {
          role: "shipping_attachment",
          enabled: true,
          sections: []
        }
      }}
      selectedSheetName="Order Form"
      onSelectSheet={() => undefined}
      onChangeSheet={() => undefined}
    />
  );

  assert.match(markup, /Workbook Structure/);
  assert.match(markup, /Assign every sheet a role/);
  assert.match(markup, /Order Form/);
  assert.match(markup, /Ship List/);
  assert.match(markup, /Printed products/);
  assert.match(markup, /Hardware/);
  assert.match(markup, /Qty\. Needed/);
  assert.match(markup, /1 quantity issue/);
  assert.match(markup, /Unrecognized Quantity Text/);
  assert.match(markup, /Text Quantity Rules/);
  assert.match(markup, /TBD/);
  assert.match(markup, /0.5/);
  assert.match(markup, /Exclude from order; keep as reference/);
  assert.match(markup, /Block preview until corrected/);
  assert.match(markup, /Add another section/);
  assert.match(markup, /Remove section/);
  assert.match(markup, /Pathfinder finds each section by its saved column headers/);
  assert.match(markup, /Detected Row \(starting hint\)/);
  assert.match(markup, /Shipping attachment \(separate intake\)/);
});

test("explains that shipping attachment intake remains separate and inactive", () => {
  const markup = renderToStaticMarkup(
    <ImportMethodWorkbookSetup
      sheets={[
        {
          sheet_name: "Ship List",
          role: "shipping_attachment",
          columns: [],
          order_row_count: 0,
          reference_row_count: 0,
          sections: []
        }
      ]}
      structure={{
        "Ship List": {
          role: "shipping_attachment",
          enabled: true,
          sections: []
        }
      }}
      selectedSheetName="Ship List"
      onSelectSheet={() => undefined}
      onChangeSheet={() => undefined}
    />
  );

  assert.match(markup, /Shipping stays a separate, default-inactive Wrike intake/);
  assert.match(markup, /will not parse this sheet into order lines/);
  assert.match(markup, /remain disabled until the shipping contract is defined/);
});

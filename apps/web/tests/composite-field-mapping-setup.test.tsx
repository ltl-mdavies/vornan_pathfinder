import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { canonicalFieldRegistry } from "@pathfinder/canonical";
import type { FieldMapping } from "@pathfinder/templates";

import { CompositeFieldMappingSetup } from "../src/CompositeFieldMappingSetup";

const mappings: FieldMapping[] = [
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
  }
];

test("renders an ordered section-scoped composite with a live hardware preview", () => {
  const markup = renderToStaticMarkup(
    <CompositeFieldMappingSetup
      columns={["Hardware", "PS SKU", "Item SKU", "Description", "Qty. Needed"]}
      fields={canonicalFieldRegistry}
      mappings={mappings}
      sampleRow={{
        Hardware: "GNA Tops",
        "PS SKU": "AOM403",
        "Item SKU": "8417-002",
        Description: "1924-Printed Top",
        "Qty. Needed": 585
      }}
      scopeId="Order Form::hardware"
      scopeLabel="Order Form · Hardware"
      onChange={() => undefined}
    />
  );

  assert.match(markup, /Derived Field Composites/);
  assert.match(markup, /Order Form · Hardware/);
  assert.match(markup, /Line Description · lines\[\]\.description/);
  assert.match(markup, /Hardware/);
  assert.match(markup, /Description/);
  assert.match(markup, /Item SKU/);
  assert.match(markup, /Skip empty values/);
  assert.match(markup, /GNA Tops — 1924-Printed Top — 8417-002/);
});

test("does not display a composite belonging to a different workbook section", () => {
  const markup = renderToStaticMarkup(
    <CompositeFieldMappingSetup
      columns={["DESCRIPTION", "Creative", "Print QTY"]}
      fields={canonicalFieldRegistry}
      mappings={mappings}
      sampleRow={{ DESCRIPTION: "Poster", Creative: "Chevron", "Print QTY": 2 }}
      scopeId="Order Form::print"
      scopeLabel="Order Form · Printed products"
      onChange={() => undefined}
    />
  );

  assert.match(markup, /No composite is configured for this section/);
  assert.doesNotMatch(markup, /GNA Tops/);
});

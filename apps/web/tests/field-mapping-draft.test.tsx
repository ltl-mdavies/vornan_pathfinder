import assert from "node:assert/strict";
import test from "node:test";
import type { FieldMapping } from "@pathfinder/templates";

import {
  selectedDirectMappingTarget,
  updateDirectMapping
} from "../src/field-mapping-draft";

const printScope = "Order Form::order-form-print-1";

const mappings: FieldMapping[] = [
  {
    sourceColumn: "DESCRIPTION",
    targetField: "lines[].description"
  },
  {
    sourceColumn: "Creative",
    targetField: "lines[].artwork.file_url"
  },
  {
    sourceColumn: "",
    targetField: "lines[].description",
    scopeId: printScope,
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
  }
];

test("a scoped Ignore selection suppresses a global direct mapping without removing the composite", () => {
  const afterDescriptionIgnore = updateDirectMapping(mappings, "DESCRIPTION", "", printScope);
  const afterCreativeIgnore = updateDirectMapping(afterDescriptionIgnore, "Creative", "", printScope);

  assert.equal(selectedDirectMappingTarget(afterCreativeIgnore, "DESCRIPTION", printScope), "");
  assert.equal(selectedDirectMappingTarget(afterCreativeIgnore, "Creative", printScope), "");
  assert.equal(selectedDirectMappingTarget(afterCreativeIgnore, "DESCRIPTION", "AMZ LOCKERS::print"), "lines[].description");
  assert.equal(selectedDirectMappingTarget(afterCreativeIgnore, "Creative", "AMZ LOCKERS::print"), "lines[].artwork.file_url");
  assert.equal(
    afterCreativeIgnore.some(
      (mapping) =>
        mapping.scopeId === printScope &&
        mapping.targetField === "lines[].description" &&
        mapping.valueExpression?.kind === "composite"
    ),
    true
  );
  assert.equal(
    afterCreativeIgnore.some(
      (mapping) =>
        mapping.scopeId === printScope &&
        mapping.sourceColumn === "DESCRIPTION" &&
        mapping.targetField === "lines[].description" &&
        mapping.ignored === true
    ),
    true
  );
});

test("choosing a canonical target replaces an explicit Ignore marker", () => {
  const ignored = updateDirectMapping(mappings, "DESCRIPTION", "", printScope);
  const restored = updateDirectMapping(ignored, "DESCRIPTION", "lines[].line_note", printScope);

  assert.equal(selectedDirectMappingTarget(restored, "DESCRIPTION", printScope), "lines[].line_note");
  assert.equal(
    restored.some(
      (mapping) =>
        mapping.scopeId === printScope &&
        mapping.sourceColumn === "DESCRIPTION" &&
        mapping.ignored === true
    ),
    false
  );
});

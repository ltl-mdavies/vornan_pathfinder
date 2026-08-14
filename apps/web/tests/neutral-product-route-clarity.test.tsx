import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

function functionSource(name: string, nextName: string) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start + 1);
  assert.ok(start >= 0, `${name} should exist`);
  assert.ok(end > start, `${nextName} should follow ${name}`);
  return source.slice(start, end);
}

test("offers an exact neutral product-resolution choice", () => {
  assert.match(source, /<option value="">Choose during preload<\/option>/);
  assert.match(source, /sourceColumn\s*\?\s*\{[\s\S]*source_column: sourceColumn[\s\S]*:\s*\{ \.\.\.neutralProductResolutionConfig \}/);
  assert.match(source, /disabled=\{!activeProductConfig\.source_column\}/);
  assert.match(source, /No customer-specific source field is saved/);
});

test("keeps workbook product-field selection local until an explicit mapping save", () => {
  const importSource = functionSource("importPreloadCatalogFile", "updatePreloadWorkbookProfile");
  const profileSource = functionSource("updatePreloadWorkbookProfile", "resetPreloadWorkbook");

  assert.doesNotMatch(importSource, /updateActiveProductResolutionConfig|updateActiveMethodDraft|\bfetch\s*\(/);
  assert.doesNotMatch(profileSource, /updateActiveProductResolutionConfig|updateActiveMethodDraft|\bfetch\s*\(/);
  assert.match(importSource, /Nothing has been saved/);
  assert.match(profileSource, /Nothing has been saved/);
});

test("labels the reusable target separately from the selected customer route", () => {
  assert.match(source, />Reusable target</);
  assert.match(source, /title="Target Environments" detail="Reusable connections"/);
  assert.match(source, /title="Output Routes" detail=\{`For \$\{selectedCustomer\.customer_name\}`\}/);
  assert.match(source, /These settings apply only to \{selectedCustomer\.customer_name\}\. The target is shared\./);
  assert.match(source, /Route edits save for \{selectedCustomer\.customer_name\}/);
});

test("display-only route scope remains the selected workspace projection", () => {
  assert.match(source, /const selectedTargetRoutes = selectedTarget\s*\? outputRoutes\.filter/);
  assert.doesNotMatch(source, /selectedTarget\.output_routes/);
});

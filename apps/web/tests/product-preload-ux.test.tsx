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

test("product-list parsing remains browser-local until an explicit save", () => {
  const parseSource = functionSource("parsePreloadProductList", "importPreloadCatalogFile");
  const importSource = functionSource("importPreloadCatalogFile", "updatePreloadWorkbookProfile");

  assert.doesNotMatch(parseSource, /\bfetch\s*\(/);
  assert.doesNotMatch(importSource, /\bfetch\s*\(/);
  assert.match(parseSource, /Nothing has been saved/);
  assert.match(importSource, /Nothing has been saved/);
});

test("preload setup distinguishes source readiness from Lift destination mapping", () => {
  assert.match(source, />Source structure</);
  assert.match(source, />Canonical products</);
  assert.match(source, />Lift destination</);
  assert.match(source, /need Lift mapping/);
  assert.match(source, /Custom \/ choose columns/);
  assert.match(source, /Confirm setup/);
  assert.match(source, /Original uploaded columns remain available/);
});

test("foreign customer recipes block mapping writes with local accessible recovery copy", () => {
  const saveSource = functionSource("savePreloadedProductMappings", "reviewProductMappingReplacement");

  assert.match(source, /preloadForeignRecipeBlocked/);
  assert.match(source, /product-key recipe assigned to another customer/);
  assert.match(source, /role=\{preloadParseState === "error" \? "alert" : "status"\}/);
  assert.match(saveSource, /if \(preloadForeignRecipeBlocked\)/);
  assert.match(saveSource, /return;/);
});

test("full-list replacement stays explicit and customer-neutral", () => {
  assert.match(source, /Review Full-List Replacement/);
  assert.match(source, /every customer product expected for this route/);
  assert.doesNotMatch(source, /every Momentara product expected for this route/);
  assert.match(source, /onClick=\{resetPreloadWorkbook\}/);
});

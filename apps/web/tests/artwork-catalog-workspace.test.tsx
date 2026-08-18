import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ArtworkCatalogWorkspace,
  applyProductSpecificationDraft,
  currentArtworkVersion,
  effectiveCatalogLifecycle,
  filterCatalogProducts,
  nextUploadStage,
  productSpecificationDraft
} from "../src/artwork-catalog/ArtworkCatalogWorkspace";
import {
  artworkCatalogFixture,
  artworkCatalogFixtureActions,
  type CatalogProduct
} from "../src/artwork-catalog/fixtures";

test("renders an unmounted operator workspace with distinct specification, inspection, approval, and order evidence", () => {
  const markup = renderToStaticMarkup(
    <ArtworkCatalogWorkspace
      customerLabel="LTL Demo · 1249"
      products={artworkCatalogFixture}
      actions={artworkCatalogFixtureActions}
      initialProductId="product_1249_pump_topper_chevron"
    />
  );

  assert.match(markup, /Artwork catalog/);
  assert.match(markup, /Pump Topper Chevron/);
  assert.match(markup, /Product specification/);
  assert.match(markup, /Technical inspection/);
  assert.match(markup, /Optional machine-generated evidence/);
  assert.match(markup, /Proof approval/);
  assert.match(markup, /Approval by the prepress team and customer for print production/);
  assert.match(markup, /Approved by the prepress team and customer for print production/);
  assert.match(markup, / Edit<\/button>/);
  assert.match(markup, /Order history/);
  assert.match(markup, /Upload new version/);
  assert.match(markup, /Version history \(3\)/);
  assert.match(markup, /Open details/);
  assert.match(markup, /Filters/);
  assert.match(markup, /aria-label="List view" aria-pressed="true"/);
  assert.match(markup, /aria-label="Card view" aria-pressed="false"/);
  assert.match(markup, /Change catalog item status\. Current status Active/);
  assert.match(markup, /Forest green and lime chevron transit artwork reading Move with purpose/);
});

test("filters by lifecycle, technical inspection, proof approval, and product search without mutating fixtures", () => {
  const originalLifecycle = artworkCatalogFixture[0].lifecycle;
  const results = filterCatalogProducts(artworkCatalogFixture, "pump", {
    lifecycles: ["Active"],
    inspections: ["Passed"],
    approvals: ["Approved"]
  });

  assert.deepEqual(results.map((product) => product.id), ["product_1249_pump_topper_chevron"]);
  assert.equal(artworkCatalogFixture[0].lifecycle, originalLifecycle);
});

test("local lifecycle overrides can hide an inactive item without altering its retained fixture identity", () => {
  const product = artworkCatalogFixture[0];
  const overrides = { [product.id]: "Inactive" as const };

  assert.equal(effectiveCatalogLifecycle(product, overrides), "Inactive");
  assert.equal(product.lifecycle, "Active");
  assert.equal(filterCatalogProducts([product], "", {
    lifecycles: ["Inactive"],
    inspections: [],
    approvals: []
  }, overrides).length, 1);
  assert.equal(filterCatalogProducts([product], "", {
    lifecycles: ["Active"],
    inspections: [],
    approvals: []
  }, overrides).length, 0);
});

test("creates and applies a local product specification draft without mutating fixture data", () => {
  const product = artworkCatalogFixture[0];
  const originalSize = product.specification[0].value;
  const draft = productSpecificationDraft(product);
  const updated = applyProductSpecificationDraft(product, { ...draft, width: "150", height: "32", targetDpi: "200" });

  assert.deepEqual(draft, { width: "144", height: "30", units: "in", targetDpi: "150", color: "CMYK" });
  assert.equal(updated.find((item) => item.label === "Finished size")?.value, "150 × 32 in");
  assert.equal(updated.find((item) => item.label === "Target resolution")?.value, "200 DPI");
  assert.equal(product.specification[0].value, originalSize);
});

test("keeps one immutable current artwork identity per fixture product", () => {
  const productIds = new Set<string>();
  const versionIds = new Set<string>();

  for (const product of artworkCatalogFixture) {
    assert.ok(!productIds.has(product.id));
    productIds.add(product.id);
    assert.equal(product.versions.filter((version) => version.isCurrent).length, 1);
    for (const version of product.versions) {
      assert.ok(!versionIds.has(version.id));
      versionIds.add(version.id);
    }
  }

  assert.equal(currentArtworkVersion(artworkCatalogFixture[0]).version, 7);
});

test("fails closed when a catalog product does not have exactly one current version", () => {
  const valid = artworkCatalogFixture[0];
  const invalid: CatalogProduct = {
    ...valid,
    id: "invalid_product",
    versions: valid.versions.map((version) => ({ ...version, isCurrent: false }))
  };

  assert.throws(() => currentArtworkVersion(invalid), /exactly one current artwork version/);
});

test("upload progression is explicit and never implies activation, inspection, or approval", () => {
  assert.equal(nextUploadStage("select"), "review");
  assert.equal(nextUploadStage("review"), "confirm");
  assert.equal(nextUploadStage("confirm"), "processing");
  assert.equal(nextUploadStage("processing"), "success");
  assert.equal(nextUploadStage("success"), "success");
});

test("slice remains unmounted, injected, provider neutral, and free of runtime clients", async () => {
  const source = await readFile(new URL("../src/artwork-catalog/ArtworkCatalogWorkspace.tsx", import.meta.url), "utf8");
  const fixtureSource = await readFile(new URL("../src/artwork-catalog/fixtures.ts", import.meta.url), "utf8");
  const styleSource = await readFile(new URL("../src/artwork-catalog/artwork-catalog.css", import.meta.url), "utf8");
  const combined = `${source}\n${fixtureSource}\n${styleSource}`;

  assert.doesNotMatch(combined, /\bfetch\s*\(/);
  assert.doesNotMatch(combined, /localStorage|sessionStorage|FormData|XMLHttpRequest|WebSocket/);
  assert.doesNotMatch(combined, /PixelGuard|Durst|Lift|Wrike|Vornan Proof/);
  assert.doesNotMatch(source, /\.\.\/App|api-client|@aws-sdk|process\.env|import\.meta\.env/);
  assert.doesNotMatch(source, /bulk|selected products|mass update/i);
  assert.doesNotMatch(source, /add to cart|shopping cart|unit price|quantity input/i);
  assert.match(source, /actions: ArtworkCatalogActions/);
  assert.match(source, /This changes the local prototype only/);
  assert.match(source, /No catalog data was saved/);
  assert.match(source, /aria-controls="artwork-catalog-filter-panel"/);
  assert.match(source, /Clear all/);
  assert.match(source, /Product configuration/);
  assert.match(source, /Manufacturing configuration is read-only in this prototype/);
  assert.match(source, /Catalog products in card view/);
  assert.match(styleSource, /grid-template-columns: repeat\(auto-fit/);
  assert.match(source, /No catalog data was saved/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /lastModalTriggerRef\.current\?\.focus/);
});

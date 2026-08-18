import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ArtworkCatalogWorkspace,
  currentArtworkVersion,
  nextUploadStage
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
  assert.match(markup, /Human approval/);
  assert.match(markup, /Recorded independently from technical checks/);
  assert.match(markup, /Order history/);
  assert.match(markup, /Upload new version/);
  assert.match(markup, /Version history \(3\)/);
  assert.match(markup, /Forest green and lime chevron transit artwork reading Move with purpose/);
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
  const combined = `${source}\n${fixtureSource}`;

  assert.doesNotMatch(combined, /\bfetch\s*\(/);
  assert.doesNotMatch(combined, /localStorage|sessionStorage|FormData|XMLHttpRequest|WebSocket/);
  assert.doesNotMatch(combined, /PixelGuard|Durst|Lift|Wrike|Vornan Proof/);
  assert.doesNotMatch(source, /\.\.\/App|api-client|@aws-sdk|process\.env|import\.meta\.env/);
  assert.match(source, /actions: ArtworkCatalogActions/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /lastModalTriggerRef\.current\?\.focus/);
});

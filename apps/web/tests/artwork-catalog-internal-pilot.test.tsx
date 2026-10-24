import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ArtworkCatalogInternalPilot,
  compactCatalogPilotProducts,
  isArtworkCatalogInternalPilotAvailable,
  localInspectionSpecForProduct,
  resolveArtworkInspectionResult,
  shouldUseArtworkCatalogFocusedShell
} from "../src/artwork-catalog/ArtworkCatalogInternalPilot";
import { artworkCatalogFixture } from "../src/artwork-catalog/fixtures";
import { applyProductSpecificationDraft } from "../src/artwork-catalog/ArtworkCatalogWorkspace";
import { analyzeArtworkUpload } from "../src/artwork-catalog/artwork-upload-analysis";

test("compact pilot starts with an honest unobstructed sample list and leaves default composition intact", () => {
  const markup = renderToStaticMarkup(<ArtworkCatalogInternalPilot customerId="1249" customerLabel="LTL Demo · 1249" compact />);
  assert.match(markup, /pf-catalog-candidate/);
  assert.match(markup, /Sample records · no catalog data is saved/);
  assert.match(markup, /New product · unavailable/);
  assert.doesNotMatch(markup, /artwork-catalog-drawer|ready for routine use|Catalog summary/);
  assert.match(markup, /5<!-- --> of <!-- -->5|5 of 5/);
  assert.equal(renderToStaticMarkup(<ArtworkCatalogInternalPilot customerId="284619" customerLabel="Other" compact />), "");
});

test("compact sample inspection agrees with its linked report without changing approval or original fixture", () => {
  const product = compactCatalogPilotProducts[0];
  const current = product.versions.find((version) => version.isCurrent)!;
  const report = resolveArtworkInspectionResult({customerId: "1249", productId: product.id, versionId: current.id})!;
  assert.equal(report.verdict, "needs-work");
  assert.equal(current.inspection.state, "Needs work");
  assert.equal(current.inspection.checkedAt, report.completedAt);
  assert.deepEqual(current.inspection.metrics, report.metrics);
  assert.equal(current.approval.state, "Approved");
  assert.equal(artworkCatalogFixture[0].versions[0].inspection.state, "Passed");
});

test("embedded inspection sizing is isolated from the standalone workspace", async () => {
  const source = await readFile(new URL("../src/artwork-catalog/ArtworkCatalogInternalPilot.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../src/pathfinder-shell.css", import.meta.url), "utf8");
  assert.match(source, /className=\{compact \? "pf-catalog-inspection" : undefined\}/);
  assert.match(styles, /\.pf-shell \.pf-catalog-inspection \.artwork-inspection-results\{height:calc\(100dvh - 180px\)/);
  assert.match(styles, /@media\(max-width:1100px\)\{\.pf-shell \.pf-catalog-inspection \.artwork-inspection-results\{height:auto/);
});

test("keeps the internal pilot default-dark and restricted to exact customer 1249", async () => {
  assert.equal(isArtworkCatalogInternalPilotAvailable(false, "1249"), false);
  assert.equal(isArtworkCatalogInternalPilotAvailable(true, "1249"), true);
  assert.equal(isArtworkCatalogInternalPilotAvailable(true, "01249"), false);
  assert.equal(isArtworkCatalogInternalPilotAvailable(true, "284619"), false);

  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(
    appSource,
    /import\.meta\.env\.VITE_ARTWORK_CATALOG_INTERNAL_PILOT_ENABLED === "true"/
  );
  assert.match(appSource, /Boolean\(authSession\) && isArtworkCatalogInternalPilotAvailable/);
  assert.match(appSource, /artworkCatalogInternalPilotEnabled,\s*selectedCustomerId/);
  assert.match(appSource, /item\.label !== "Artwork Catalog" \|\| artworkCatalogInternalPilotAvailable/);
  assert.match(appSource, /activeCustomerView === "Artwork Catalog" && artworkCatalogInternalPilotAvailable/);
});

test("uses the focused workspace shell only for the available Artwork Catalog experience", async () => {
  assert.equal(shouldUseArtworkCatalogFocusedShell({
    activeGlobalView: "Customers",
    activeCustomerView: "Artwork Catalog",
    pilotAvailable: true
  }), true);
  assert.equal(shouldUseArtworkCatalogFocusedShell({
    activeGlobalView: "Customers",
    activeCustomerView: "Artwork Catalog",
    pilotAvailable: false
  }), false);
  assert.equal(shouldUseArtworkCatalogFocusedShell({
    activeGlobalView: "Customers",
    activeCustomerView: "Overview",
    pilotAvailable: true
  }), false);
  assert.equal(shouldUseArtworkCatalogFocusedShell({
    activeGlobalView: "Dashboard",
    activeCustomerView: "Artwork Catalog",
    pilotAvailable: true
  }), false);

  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const stylesSource = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(appSource, /artworkCatalogFocusedShell \? "workspace workspace-feature-focus" : "workspace"/);
  assert.match(appSource, /!artworkCatalogFocusedShell && !operationsCustomerProof/);
  assert.match(appSource, /PathfinderShell/);
  assert.match(appSource, /const operationsCustomerProof = operationsWorkspaceEnabled && activeGlobalView === "Customers" && activeCustomerView === "Proof"/);
  assert.match(stylesSource, /\.workspace\.workspace-feature-focus\s*\{[\s\S]*?padding:\s*0;/);
});

test("renders the approved fixture-only catalog composition for LTL Demo", () => {
  const markup = renderToStaticMarkup(
    <ArtworkCatalogInternalPilot customerId="1249" customerLabel="LTL Demo · 1249" />
  );

  assert.match(markup, /Artwork catalog/);
  assert.match(markup, /LTL Demo · 1249/);
  assert.match(markup, /Pump Topper Chevron/);
  assert.match(markup, /Check new artwork/);
  assert.doesNotMatch(markup, /Upload new version/);
  assert.match(markup, /Product specification/);
  assert.match(markup, /Technical inspection/);
  assert.match(markup, /View results/);
  assert.match(markup, /Proof approval/);
  assert.match(markup, /Approval by the prepress team and customer for print production/);
  assert.match(markup, /Order history/);
  assert.doesNotMatch(markup, /Run inspection|Approve for production|annotation|markup/i);
});

test("renders nothing outside the exact pilot customer boundary", () => {
  const markup = renderToStaticMarkup(
    <ArtworkCatalogInternalPilot customerId="284619" customerLabel="Momentara · 284619" />
  );

  assert.equal(markup, "");
});

test("binds local analysis to the selected product specification without changing the current version", () => {
  const product = artworkCatalogFixture[0];
  const inspectionSpec = localInspectionSpecForProduct("1249", product);
  assert.deepEqual(inspectionSpec, {
    customerId: "1249",
    productId: "product_1249_pump_topper_chevron",
    productName: "Pump Topper Chevron",
    proposedVersion: 8,
    finishedWidthInches: 144,
    finishedHeightInches: 30,
    targetDpi: 150,
    expectedColorSpace: "CMYK"
  });
  assert.equal(product.versions.find((version) => version.isCurrent)?.version, 7);
});

test("applied specifications drive actual local report evidence without mutating fixture artwork", async () => {
  const product = artworkCatalogFixture[0];
  const original = structuredClone(product);
  const specification = applyProductSpecificationDraft(product, {
    width: "304.8", height: "203.2", units: "mm", targetDpi: "300", color: "RGB"
  });
  const effective = localInspectionSpecForProduct("1249", { ...product, specification });
  assert.ok(Math.abs(effective.finishedWidthInches - 12) < 0.00001);
  assert.ok(Math.abs(effective.finishedHeightInches - 8) < 0.00001);
  assert.equal(effective.targetDpi, 300);
  assert.equal(effective.expectedColorSpace, "RGB");
  const file = new File([await readFile(new URL("../public/icons/pathfinder-icon-192.png", import.meta.url))], "test.png", { type: "image/png" });
  const batch = await analyzeArtworkUpload(file, effective, { createObjectUrl: () => "blob:test" });
  assert.equal(batch.items[0].result?.specification, "12 × 8 in");
  assert.equal(batch.items[0].result?.targetDpi, "300");
  assert.equal(batch.items[0].result?.versionLabel, "Proposed Version 8");
  assert.deepEqual(product, original);
});

test("Catalog remains mounted while inspection is open and hidden listeners respect active scope", async () => {
  const pilot = await readFile(new URL("../src/artwork-catalog/ArtworkCatalogInternalPilot.tsx", import.meta.url), "utf8");
  const workspace = await readFile(new URL("../src/artwork-catalog/ArtworkCatalogWorkspace.tsx", import.meta.url), "utf8");
  assert.match(pilot, /hidden=\{view.kind !== "catalog"\} inert=/);
  assert.match(pilot, /active=\{view.kind === "catalog"\}/);
  assert.doesNotMatch(pilot, /if \(view.kind === "inspection"\)\s*\{/);
  assert.match(workspace, /specification: specificationOverrides\[selectedProduct.id\] \?\? selectedProduct.specification/);
  assert.match(workspace, /if \(!active \|\| !compactPilot \|\| !drawerOpen\) return/);
  assert.match(workspace, /inspectionOriginRef.current = lastModalTriggerRef.current/);
  assert.match(workspace, /if \(!mountedRef.current\)/);
  assert.match(workspace, /<input ref=\{uploadInputRef\} hidden disabled=\{viewer.stage === "processing"\}/);
  assert.match(workspace, /if \(!first \|\| !last\)[\s\S]*?modalRef.current.focus\(\)/);
});

test("resolves only the exact immutable product, version, and inspection identity", () => {
  const exact = resolveArtworkInspectionResult({
    customerId: "1249",
    productId: "product_1249_pump_topper_chevron",
    versionId: "artwork_version_7"
  });

  assert.equal(exact?.inspectionId, "inspection_1249_chevron_v7_001");
  assert.equal(exact?.productName, "Pump Topper Chevron");
  assert.equal(exact?.versionLabel, "Version 7");
  assert.equal(resolveArtworkInspectionResult({
    customerId: "1249",
    productId: "product_1249_pump_topper_chevron",
    versionId: "artwork_version_6"
  }), null);
  assert.equal(resolveArtworkInspectionResult({
    customerId: "1249",
    productId: "product_1249_platform_banner",
    versionId: "artwork_version_7"
  }), null);
  assert.equal(resolveArtworkInspectionResult({
    customerId: "284619",
    productId: "product_1249_pump_topper_chevron",
    versionId: "artwork_version_7"
  }), null);
});

test("keeps the pilot local, provider-neutral, and free of runtime or annotation clients", async () => {
  const pilotSource = await readFile(
    new URL("../src/artwork-catalog/ArtworkCatalogInternalPilot.tsx", import.meta.url),
    "utf8"
  );
  const workspaceSource = await readFile(
    new URL("../src/artwork-catalog/ArtworkCatalogWorkspace.tsx", import.meta.url),
    "utf8"
  );
  const combined = `${pilotSource}\n${workspaceSource}`;

  assert.doesNotMatch(combined, /\bfetch\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|FormData/);
  assert.doesNotMatch(combined, /api-client|@aws-sdk|process\.env|import\.meta\.env/);
  assert.doesNotMatch(combined, /PixelGuard|Durst|Vornan Proof|Lift|Wrike/);
  assert.doesNotMatch(combined, /annotation|markup/i);
  assert.match(pilotSource, /setView\(\{ kind: "catalog", selectedProductId: view\.productId \}\)/);
  assert.match(pilotSource, /analyzeArtworkUpload/);
  assert.match(pilotSource, /localInspectionSpecForProduct/);
  assert.match(pilotSource, /item\.customerId !== INTERNAL_PILOT_CUSTOMER_ID/);
  assert.match(pilotSource, /artworkCatalogFixture\.find\(\(candidate\) => candidate\.id === item\.productId\)/);
  assert.match(pilotSource, /Browser-local|localAnalysis/);
  assert.match(pilotSource, /if \(!result\) return/);
  assert.match(workspaceSource, /onOpenTechnicalInspection && current\.inspection\.checkedAt/);
});

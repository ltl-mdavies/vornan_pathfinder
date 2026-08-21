import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ArtworkCatalogInternalPilot,
  isArtworkCatalogInternalPilotAvailable,
  resolveArtworkInspectionResult,
  shouldUseArtworkCatalogFocusedShell
} from "../src/artwork-catalog/ArtworkCatalogInternalPilot";

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
  assert.match(appSource, /!artworkCatalogFocusedShell \? <header className="topbar">/);
  assert.match(stylesSource, /\.workspace\.workspace-feature-focus\s*\{[\s\S]*?padding:\s*0;/);
});

test("renders the approved fixture-only catalog composition for LTL Demo", () => {
  const markup = renderToStaticMarkup(
    <ArtworkCatalogInternalPilot customerId="1249" customerLabel="LTL Demo · 1249" />
  );

  assert.match(markup, /Artwork catalog/);
  assert.match(markup, /LTL Demo · 1249/);
  assert.match(markup, /Pump Topper Chevron/);
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
  assert.match(pilotSource, /onBack: \(\) => setView\(\{ kind: "catalog", selectedProductId: view\.productId \}\)/);
  assert.match(pilotSource, /if \(!result\) return/);
  assert.match(workspaceSource, /onOpenTechnicalInspection && current\.inspection\.checkedAt/);
});

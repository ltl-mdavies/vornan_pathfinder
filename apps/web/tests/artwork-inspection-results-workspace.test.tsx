import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ArtworkInspectionResultsWorkspace,
  adjacentFindingId,
  clampInspectionZoom,
  inspectionHasPageRail
} from "../src/artwork-catalog/ArtworkInspectionResultsWorkspace";
import {
  artworkInspectionFixtureActions,
  artworkInspectionMultiPageFixture,
  artworkInspectionResultFixture
} from "../src/artwork-catalog/inspection-results-fixtures";

test("renders the approved single-page heatmap results workspace with separate technical and approval language", () => {
  const markup = renderToStaticMarkup(
    <ArtworkInspectionResultsWorkspace result={artworkInspectionResultFixture} actions={artworkInspectionFixtureActions} />
  );

  assert.match(markup, /Technical inspection results/);
  assert.match(markup, /Pump Topper Chevron/);
  assert.match(markup, /Version 7/);
  assert.match(markup, /aria-label="Artwork analysis view"/);
  assert.match(markup, /aria-pressed="true">Heatmap/);
  assert.match(markup, /Findings <span>4/);
  assert.match(markup, /Overall verdict/);
  assert.match(markup, /Needs work/);
  assert.match(markup, /Effective PPI/);
  assert.match(markup, /Problem area/);
  assert.match(markup, /Finding 1 of 4/);
  assert.match(markup, /Effective resolution 118 DPI/);
  assert.match(markup, /Download report/);
  assert.match(markup, /Open analyzed artwork/);
  assert.match(markup, /Technical findings do not change Proof approval/);
  assert.doesNotMatch(markup, /Pages \(/);
});

test("shows the page rail only for multi-page inspection evidence", () => {
  const singlePageMarkup = renderToStaticMarkup(
    <ArtworkInspectionResultsWorkspace result={artworkInspectionResultFixture} actions={artworkInspectionFixtureActions} />
  );
  const multiPageMarkup = renderToStaticMarkup(
    <ArtworkInspectionResultsWorkspace result={artworkInspectionMultiPageFixture} actions={artworkInspectionFixtureActions} />
  );

  assert.equal(inspectionHasPageRail(artworkInspectionResultFixture.pages), false);
  assert.equal(inspectionHasPageRail(artworkInspectionMultiPageFixture.pages), true);
  assert.doesNotMatch(singlePageMarkup, /aria-label="Pages \(1\)"/);
  assert.match(multiPageMarkup, /aria-label="Pages \(3\)"/);
  assert.match(multiPageMarkup, /Pages \(1 of 3\)/);
});

test("keeps zoom bounded and finding navigation deterministic", () => {
  assert.equal(clampInspectionZoom(20), 50);
  assert.equal(clampInspectionZoom(130), 130);
  assert.equal(clampInspectionZoom(240), 200);

  const findings = artworkInspectionResultFixture.findings;
  assert.equal(adjacentFindingId(findings, findings[0].id, 1), findings[1].id);
  assert.equal(adjacentFindingId(findings, findings[0].id, -1), findings.at(-1)?.id);
  assert.equal(adjacentFindingId([], "missing", 1), "");
});

test("fails closed when a finding references a page that was not supplied", () => {
  const invalid = {
    ...artworkInspectionResultFixture,
    findings: [{ ...artworkInspectionResultFixture.findings[0], pageNumber: 99 }]
  };

  assert.throws(
    () => renderToStaticMarkup(<ArtworkInspectionResultsWorkspace result={invalid} actions={artworkInspectionFixtureActions} />),
    /must reference a supplied page/
  );
});

test("keeps the slice unmounted, injected, provider-neutral, and free of runtime clients", async () => {
  const source = await readFile(new URL("../src/artwork-catalog/ArtworkInspectionResultsWorkspace.tsx", import.meta.url), "utf8");
  const fixtureSource = await readFile(new URL("../src/artwork-catalog/inspection-results-fixtures.ts", import.meta.url), "utf8");
  const styleSource = await readFile(new URL("../src/artwork-catalog/artwork-inspection-results.css", import.meta.url), "utf8");

  assert.doesNotMatch(source, /PixelGuard|Durst|Vornan Proof|Lift|Wrike/);
  assert.match(fixtureSource, /providerDisplayName: "PixelGuard"/);
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|FormData/);
  assert.doesNotMatch(source, /api-client|@aws-sdk|process\.env|import\.meta\.env|\.\.\/App/);
  assert.doesNotMatch(source, /signed.?url|object.?key|provider.?payload|credential|secret/i);
  assert.doesNotMatch(styleSource, /PixelGuard|Durst|Vornan Proof/);
  assert.match(source, /actions: ArtworkInspectionResultsActions/);
  assert.match(source, /onDownloadReport: \(inspectionId: string\)/);
  assert.match(source, /onOpenAnalyzedArtwork: \(inspectionId: string\)/);
  assert.match(source, /aria-pressed/);
  assert.match(styleSource, /prefers-reduced-motion/);
});

test("does not mount the results workspace into the Pathfinder application", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const mainSource = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
  const combined = `${appSource}\n${mainSource}`;

  assert.doesNotMatch(combined, /ArtworkInspectionResultsWorkspace|inspection-results-fixtures/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ArtworkInspectionResultsWorkspace,
  adjacentFindingId,
  clampInspectionZoom,
  fitInspectionPreview,
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
  assert.match(markup, /data-source-width="1200"/);
  assert.match(markup, /data-source-height="675"/);
  assert.match(markup, /data-fit-zoom="100"/);
  assert.match(markup, /Findings <span>4/);
  assert.match(markup, /Overall verdict/);
  assert.match(markup, /Needs work/);
  assert.match(markup, /Effective PPI/);
  assert.match(markup, /Problem area/);
  assert.match(markup, /Finding 1 of 4/);
  assert.match(markup, /Effective resolution 118 DPI/);
  assert.match(markup, /Theater view/);
  assert.doesNotMatch(markup, /Learn about effective resolution/);
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

test("fits wide and tall artwork with one uniform scale and no ratio change", () => {
  const wide = fitInspectionPreview({ width: 1000, height: 400 }, { width: 1200, height: 675 });
  assert.equal(wide.height, 400);
  assert.equal(wide.width / wide.height, 1200 / 675);
  assert.equal(wide.width, 1200 * wide.scale);
  assert.equal(wide.height, 675 * wide.scale);

  const tall = fitInspectionPreview({ width: 400, height: 500 }, { width: 675, height: 1200 });
  assert.equal(tall.height, 500);
  assert.equal(tall.width / tall.height, 675 / 1200);
  assert.equal(tall.width, 675 * tall.scale);
  assert.equal(tall.height, 1200 * tall.scale);

  assert.throws(
    () => fitInspectionPreview({ width: 0, height: 500 }, { width: 1200, height: 675 }),
    /positive finite numbers/
  );
});

test("keeps original, heatmap, and callouts in the same source coordinate system", async () => {
  const original = await readFile(new URL("../src/artwork-catalog/assets/pump-topper-chevron-current.png", import.meta.url));
  const heatmap = await readFile(new URL("../src/artwork-catalog/assets/pump-topper-chevron-heatmap.png", import.meta.url));
  const pngDimensions = (contents: Buffer) => ({ width: contents.readUInt32BE(16), height: contents.readUInt32BE(20) });
  const fixturePage = artworkInspectionResultFixture.pages[0];

  assert.deepEqual(pngDimensions(original), { width: fixturePage.pixelWidth, height: fixturePage.pixelHeight });
  assert.deepEqual(pngDimensions(heatmap), { width: fixturePage.pixelWidth, height: fixturePage.pixelHeight });
  for (const finding of artworkInspectionResultFixture.findings) {
    assert.ok(finding.marker.xPercent >= 0 && finding.marker.xPercent <= 100);
    assert.ok(finding.marker.yPercent >= 0 && finding.marker.yPercent <= 100);
  }
});

test("keeps theater view local, accessible, and free of unsupported education actions", async () => {
  const source = await readFile(new URL("../src/artwork-catalog/ArtworkInspectionResultsWorkspace.tsx", import.meta.url), "utf8");
  const fixtureSource = await readFile(new URL("../src/artwork-catalog/inspection-results-fixtures.ts", import.meta.url), "utf8");
  const styleSource = await readFile(new URL("../src/artwork-catalog/artwork-inspection-results.css", import.meta.url), "utf8");

  assert.doesNotMatch(source, /learnMoreLabel|onLearnMore/);
  assert.doesNotMatch(fixtureSource, /Learn about effective resolution|onLearnMore/);
  assert.doesNotMatch(styleSource, /inspection-learn-more/);
  assert.match(source, /aria-pressed=\{theaterMode\}/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /Secondary inspection details are hidden/);
  assert.match(source, /hidden=\{theaterMode\}/);
  assert.match(styleSource, /artwork-inspection-results-theater \.inspection-preview/);
  assert.match(styleSource, /inspection-overall-verdict[^}]*justify-content:\s*center/);
  assert.match(styleSource, /inspection-key-metrics > div:not\(\.inspection-metrics-label\)[^}]*justify-content:\s*center/);
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
  assert.doesNotMatch(styleSource, /object-fit:\s*(?:fill|cover)/);
  assert.doesNotMatch(styleSource, /aspect-ratio:\s*3\.2\s*\/\s*1/);
  assert.match(styleSource, /object-fit:\s*contain/);
  assert.match(source, /ResizeObserver/);
  assert.match(source, /fitInspectionPreview/);
  assert.match(source, /left: `\$\{finding\.marker\.xPercent\}%`/);
  assert.match(source, /top: `\$\{finding\.marker\.yPercent\}%`/);
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

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { analyzeArtworkUpload, LOCAL_ARTWORK_ANALYSIS_MAX_BYTES } from "../src/artwork-catalog/artwork-upload-analysis";
import { ArtworkInspectionResultsWorkspace } from "../src/artwork-catalog/ArtworkInspectionResultsWorkspace";

const spec = {
  customerId: "1249",
  productId: "product_1249_pump_topper_chevron",
  productName: "Pump Topper Chevron",
  proposedVersion: 8,
  finishedWidthInches: 144,
  finishedHeightInches: 30,
  targetDpi: 150,
  expectedColorSpace: "CMYK"
} as const;

function pngFile(width: number, height: number): File {
  const bytes = new Uint8Array(45);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([0, 0, 0, 13, 73, 72, 68, 82], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[24] = 8;
  bytes[25] = 2;
  bytes.set([0, 0, 0, 0, 0, 0, 0, 0, 73, 69, 78, 68, 0, 0, 0, 0], 29);
  return new File([bytes], "sample.png", { type: "image/png" });
}

function jpegFile(width: number, height: number): File {
  const bytes = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03,
    0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9
  ]);
  return new File([bytes], "sample.jpg", { type: "image/jpeg" });
}

function pdfFile(): File {
  const source = `%PDF-1.7
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >> endobj
3 0 obj << /Type /Page /MediaBox [0 0 10368 2160] /TrimBox [0 0 10368 2160] /BleedBox [-9 -9 10377 2169] /ColorSpace /DeviceCMYK >> endobj
4 0 obj << /Type /Page /MediaBox [0 0 10368 2160] >> endobj
%%EOF`;
  return new File([source], "sample.pdf", { type: "application/pdf" });
}

const deterministicOptions = {
  now: () => new Date("2026-08-21T14:00:00.000Z"),
  createId: (() => {
    let value = 0;
    return () => String(++value).padStart(4, "0");
  })(),
  createObjectUrl: () => "blob:local-artwork"
};

test("models a real PNG as a one-item batch and reports byte-derived evidence", async () => {
  const progress: string[] = [];
  const batch = await analyzeArtworkUpload(pngFile(1440, 300), spec, {
    ...deterministicOptions,
    onProgress: (entry) => progress.push(entry.status)
  });
  const item = batch.items[0];
  assert.equal(batch.customerId, "1249");
  assert.equal(batch.status, "completed");
  assert.equal(batch.items.length, 1);
  assert.equal(item.mediaType, "png");
  assert.equal(item.status, "completed");
  assert.equal(item.sha256.length, 64);
  assert.equal(item.result?.pages[0].pixelWidth, 1440);
  assert.equal(item.result?.pages[0].pixelHeight, 300);
  assert.equal(item.result?.localAnalysis?.persistence, "Browser-local only — not uploaded or retained");
  assert.deepEqual(item.result?.availableModes, ["original", "findings"]);
  assert.match(item.result?.findings.map((finding) => finding.id).join(",") ?? "", /effective-dpi/);
  assert.ok(item.result?.findings.every((finding) => finding.marker === undefined), "local metadata findings must not fabricate spatial callouts");
  assert.deepEqual(progress, ["selected", "hashing", "inspecting", "completed"]);
});

test("reads JPEG dimensions from the file signature rather than the MIME label", async () => {
  const mislabeled = jpegFile(4800, 1000);
  const file = new File([await mislabeled.arrayBuffer()], "mislabeled.bin", { type: "application/octet-stream" });
  const batch = await analyzeArtworkUpload(file, spec, { ...deterministicOptions, createId: () => "jpeg" });
  assert.equal(batch.items[0].mediaType, "jpeg");
  assert.equal(batch.items[0].result?.pages[0].dimensions, "4800 × 1000 px");
  assert.match(batch.items[0].result?.metrics.find((metric) => metric.label === "Color")?.value ?? "", /RGB/);
});

test("extracts PDF page boxes, page count, color evidence, and bleed without inventing effective DPI", async () => {
  const batch = await analyzeArtworkUpload(pdfFile(), spec, { ...deterministicOptions, createId: () => "pdf" });
  const result = batch.items[0].result;
  assert.equal(batch.items[0].mediaType, "pdf");
  assert.equal(result?.pages[0].mediaType, "pdf");
  assert.equal(result?.metrics.find((metric) => metric.label === "Pages")?.value, "2");
  assert.equal(result?.metrics.find((metric) => metric.label === "Trim")?.value, "144 × 30 in");
  assert.equal(result?.metrics.find((metric) => metric.label === "Bleed")?.value, "At least 0.125 in");
  assert.equal(result?.metrics.find((metric) => metric.label === "Effective DPI")?.value, "Indeterminate");
  assert.match(result?.findings.map((finding) => finding.id).join(",") ?? "", /dpi-indeterminate/);
});

test("fails closed for unsupported or oversized input", async () => {
  const unsupported = new File([new Uint8Array([1, 2, 3, 4])], "sample.ai", { type: "application/postscript" });
  const batch = await analyzeArtworkUpload(unsupported, spec, { ...deterministicOptions, createId: () => "unsupported" });
  assert.equal(batch.items[0].mediaType, "unsupported");
  assert.equal(batch.items[0].result?.verdict, "needs-work");
  assert.equal(batch.items[0].result?.findings[0].category, "File integrity");

  const oversized = new File([], "large.pdf", { type: "application/pdf" });
  Object.defineProperty(oversized, "size", { value: LOCAL_ARTWORK_ANALYSIS_MAX_BYTES + 1 });
  await assert.rejects(() => analyzeArtworkUpload(oversized, spec), /files up to 250 MB/);
});

test("renders local evidence without presenting a fabricated heatmap or persistence claim", async () => {
  const batch = await analyzeArtworkUpload(pdfFile(), spec, { ...deterministicOptions, createId: () => "render" });
  const result = batch.items[0].result;
  assert.ok(result);
  const markup = renderToStaticMarkup(
    <ArtworkInspectionResultsWorkspace
      result={result}
      actions={{ onBack: () => undefined, onDownloadReport: () => undefined, onOpenAnalyzedArtwork: () => undefined }}
    />
  );
  assert.match(markup, /Local analysis only/);
  assert.match(markup, /not uploaded or retained/);
  assert.match(markup, /SHA-256/);
  assert.match(markup, /PDF preview unavailable/);
  assert.match(markup, /Close inspection/);
  assert.doesNotMatch(markup, /<(object|embed|iframe)\b/);
  assert.match(markup, /Heatmap requires a connected inspection provider/);
  assert.match(markup, /disabled=""[^>]*>Heatmap/);
  assert.doesNotMatch(markup, /inspection-preview-marker/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { previewImageFallback, ProofPreview } from "../src/proof-preview.tsx";
import type { ProofVersion } from "../src/types.ts";

function imageVersion(overrides: Partial<ProofVersion> = {}): ProofVersion {
  return {
    version_id: "version-image-link",
    created_at: null,
    filename: "north-wall-final.jpg",
    content_type: "image/jpeg",
    preview_kind: "image",
    preview_url: "https://files.example/north-wall-preview.jpg",
    download_url: "https://files.example/north-wall-full.jpg",
    approval_status: "PENDING",
    approved_at: null,
    comments: [],
    technical_checks: [],
    current: true,
    ...overrides
  };
}

test("loads the full-resolution image progressively with zoom controls", () => {
  const markup = renderToStaticMarkup(createElement(ProofPreview, { version: imageVersion() }));

  assert.match(markup, /src="https:\/\/files\.example\/north-wall-full\.jpg"/);
  assert.match(markup, /src="https:\/\/files\.example\/north-wall-preview\.jpg"/);
  assert.match(markup, /Loading full-resolution proof/);
  assert.match(markup, /aria-label="Proof zoom controls"/);
  assert.match(markup, /aria-label="Fit proof to viewer"/);
  assert.match(markup, /aria-label="Proof image viewer\. Pinch or double tap to zoom\."/);
  assert.doesNotMatch(markup, /proof-image-link/);
});

test("uses only the low-resolution asset for the mobile proof feed", () => {
  const markup = renderToStaticMarkup(createElement(ProofPreview, { version: imageVersion(), quality: "preview" }));

  assert.match(markup, /src="https:\/\/files\.example\/north-wall-preview\.jpg"/);
  assert.doesNotMatch(markup, /north-wall-full\.jpg/);
  assert.doesNotMatch(markup, /Proof zoom controls/);
  assert.match(markup, /aria-label="Proof image viewer\. Pinch or double tap to zoom\."/);
});

test("keeps the safe low-resolution image available after the distinct high-resolution source fails", () => {
  assert.equal(previewImageFallback({
    quality: "high",
    active_source: "https://files.example/north-wall-full.jpg",
    preview_source: "https://files.example/north-wall-preview.jpg",
    preview_kind: "image"
  }), "https://files.example/north-wall-preview.jpg");

  assert.equal(previewImageFallback({
    quality: "high",
    active_source: "https://files.example/north-wall-preview.jpg",
    preview_source: "https://files.example/north-wall-preview.jpg",
    preview_kind: "image"
  }), null);

  assert.equal(previewImageFallback({
    quality: "high",
    active_source: "https://files.example/north-wall-full.pdf",
    preview_source: "https://files.example/north-wall-preview.jpg",
    preview_kind: "image"
  }), "https://files.example/north-wall-preview.jpg");
});

test("a newly selected proof render never contains the prior proof URL", () => {
  const priorMarkup = renderToStaticMarkup(createElement(ProofPreview, { version: imageVersion() }));
  const nextMarkup = renderToStaticMarkup(createElement(ProofPreview, {
    version: imageVersion({
      version_id: "version-next",
      filename: "south-wall-final.jpg",
      preview_url: "https://files.example/south-wall-preview.jpg",
      download_url: "https://files.example/south-wall-full.jpg"
    })
  }));

  assert.match(priorMarkup, /north-wall-full\.jpg/);
  assert.match(nextMarkup, /south-wall-full\.jpg/);
  assert.doesNotMatch(nextMarkup, /north-wall-(?:full|preview)\.jpg/);
});

test("keeps the safe image preview available beside a high-resolution PDF", () => {
  const markup = renderToStaticMarkup(createElement(ProofPreview, {
    version: imageVersion({
      filename: "north-wall-final.pdf",
      content_type: "application/pdf",
      preview_kind: "image",
      preview_url: "https://files.example/north-wall-preview.jpg",
      download_url: "https://files.example/north-wall-full.pdf"
    })
  }));

  assert.match(markup, /src="https:\/\/files\.example\/north-wall-full\.pdf"/);
  assert.match(markup, /class="proof-document-help"/);
  assert.match(markup, />Use preview image<\/button>/);
});

test("does not make an image preview interactive when no safe open target is available", () => {
  const markup = renderToStaticMarkup(createElement(ProofPreview, {
    version: imageVersion({ download_url: "javascript:alert(1)", preview_url: "javascript:alert(1)" })
  }));

  assert.doesNotMatch(markup, /proof-image-link/);
  assert.match(markup, /Preview unavailable/);
});

test("shows a clear loading state while current artwork URLs are refreshing", () => {
  const markup = renderToStaticMarkup(createElement(ProofPreview, {
    version: imageVersion({ preview_url: null, download_url: null }),
    refreshing: true
  }));

  assert.match(markup, /Loading current artwork/);
  assert.match(markup, /It will appear here automatically/);
  assert.doesNotMatch(markup, /Preview unavailable/);
});

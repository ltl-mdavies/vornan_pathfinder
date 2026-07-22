import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProofPreview } from "../src/proof-preview.tsx";
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

test("opens an image preview through the same full-resolution target as the file action", () => {
  const markup = renderToStaticMarkup(createElement(ProofPreview, { version: imageVersion() }));

  assert.match(markup, /class="proof-image-link"/);
  assert.match(markup, /href="https:\/\/files\.example\/north-wall-full\.jpg"/);
  assert.match(markup, /target="_blank"/);
  assert.match(markup, /rel="noreferrer"/);
  assert.match(markup, /aria-label="Open north-wall-final\.jpg full size in a new tab"/);
  assert.match(markup, /src="https:\/\/files\.example\/north-wall-preview\.jpg"/);
});

test("does not make an image preview interactive when no safe open target is available", () => {
  const markup = renderToStaticMarkup(createElement(ProofPreview, {
    version: imageVersion({ download_url: "javascript:alert(1)", preview_url: "javascript:alert(1)" })
  }));

  assert.doesNotMatch(markup, /proof-image-link/);
  assert.match(markup, /Preview unavailable/);
});

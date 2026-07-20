import assert from "node:assert/strict";
import test from "node:test";
import { proofAsset, safeProofAssetUrl } from "../src/asset-state.ts";
import type { ProofVersion } from "../src/types.ts";

function version(overrides: Partial<ProofVersion>): ProofVersion {
  return {
    version_id: "version-asset-qa",
    created_at: null,
    filename: "proof.pdf",
    content_type: "application/pdf",
    preview_kind: "pdf",
    preview_url: null,
    download_url: null,
    approval_status: null,
    approved_at: null,
    comments: [],
    technical_checks: [],
    current: true,
    ...overrides
  };
}

test("allows same-origin relative assets and credential-free HTTPS assets only", () => {
  assert.equal(safeProofAssetUrl("/brand/proof.pdf", "http://127.0.0.1:5174"), "/brand/proof.pdf");
  assert.equal(safeProofAssetUrl("https://files.example/proof.pdf?token=signed", "https://proof.vornan.co"), "https://files.example/proof.pdf?token=signed");
  assert.equal(safeProofAssetUrl("http://files.example/proof.pdf", "https://proof.vornan.co"), null);
  assert.equal(safeProofAssetUrl("javascript:alert(1)", "https://proof.vornan.co"), null);
  assert.equal(safeProofAssetUrl("https://user:password@files.example/proof.pdf", "https://proof.vornan.co"), null);
  assert.equal(safeProofAssetUrl("//files.example/proof.pdf", "https://proof.vornan.co"), null);
});

test("uses server-owned preview kinds instead of guessing from the browser URL", () => {
  const pdf = proofAsset(version({ preview_url: "/proof.pdf", download_url: "/proof-high.pdf" }), "https://proof.vornan.co");
  assert.deepEqual(pdf, { preview: "/proof.pdf", download: "/proof-high.pdf", open: "/proof-high.pdf", kind: "pdf" });

  const prepress = proofAsset(version({ preview_kind: "download", filename: "artwork.psd", content_type: "image/vnd.adobe.photoshop", preview_url: null, download_url: "/artwork.psd" }), "https://proof.vornan.co");
  assert.deepEqual(prepress, { preview: null, download: "/artwork.psd", open: "/artwork.psd", kind: "download" });
});

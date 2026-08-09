import assert from "node:assert/strict";
import test from "node:test";
import type { ProofRevisionAsset } from "../src/api.ts";
import {
  REVISION_UPLOAD_MAXIMUM_BYTES,
  revisionAssetProgress,
  revisionContentType,
  validateRevisionFile
} from "../src/revision-upload-state.ts";

function asset(overrides: Partial<ProofRevisionAsset> = {}): ProofRevisionAsset {
  return {
    asset_id: `passet_${"a".repeat(64)}`,
    revision_id: `prevision_${"b".repeat(64)}`,
    order_number: "A0226753",
    task_id: "ptask_revision_qa",
    attachment_id: "27085010",
    original_filename: "replacement.pdf",
    content_type: "application/pdf",
    content_length: 8192,
    sha256: "c".repeat(64),
    state: "uploaded",
    record_version: 2,
    initialized_at: "2026-08-09T12:00:00.000Z",
    upload_completed_at: "2026-08-09T12:01:00.000Z",
    verification_status: "pending",
    publication_status: "not_started",
    ...overrides
  };
}

test("accepts only bounded creative file types with safe extension fallback", () => {
  assert.equal(revisionContentType({ name: "replacement.PDF", type: "" }), "application/pdf");
  assert.equal(revisionContentType({ name: "artwork.ai", type: "application/octet-stream" }), "application/postscript");
  assert.equal(revisionContentType({ name: "notes.txt", type: "text/plain" }), null);
  assert.equal(validateRevisionFile({ name: "replacement.pdf", size: 8192, type: "application/pdf" }), null);
  assert.match(validateRevisionFile({ name: "empty.pdf", size: 0, type: "application/pdf" }) ?? "", /non-empty/i);
  assert.match(validateRevisionFile({ name: "too-large.pdf", size: REVISION_UPLOAD_MAXIMUM_BYTES + 1, type: "application/pdf" }) ?? "", /larger than 1 GB/i);
});

test("presents retained, verifying, cleared, ready, and quarantine states in concise customer language", () => {
  const retained = revisionAssetProgress(asset());
  assert.equal(retained.title, "Upload received");
  assert.match(retained.detail, /waiting for its file checks/i);

  const verifying = revisionAssetProgress(asset({ state: "verifying" }));
  assert.equal(verifying.title, "Checking your file");
  assert.match(verifying.detail, /reviewing the revised artwork/i);

  const cleared = revisionAssetProgress(asset({ state: "scan_pending", verification_status: "cleared" }));
  assert.equal(cleared.tone, "stored");
  assert.equal(cleared.title, "File check complete");
  assert.match(cleared.detail, /passed the required checks/i);

  const ready = revisionAssetProgress(asset({ state: "ready_for_lift", verification_status: "cleared", publication_status: "delivery_verified" }));
  assert.equal(ready.tone, "ready");
  assert.match(ready.detail, /ready for the next step/i);

  const quarantined = revisionAssetProgress(asset({ state: "verifying", verification_status: "quarantined" }));
  assert.equal(quarantined.tone, "error");
  assert.match(quarantined.detail, /Contact Vornan/i);
});

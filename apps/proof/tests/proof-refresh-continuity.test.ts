import assert from "node:assert/strict";
import test from "node:test";
import { preserveDisplayedHistoryAssets, preserveDisplayedProofAssets, proofOrderContentIdentity } from "../src/proof-refresh-continuity.ts";
import type { ProofOrder, ProofVersion } from "../src/types.ts";

function version(overrides: Partial<ProofVersion> = {}): ProofVersion {
  return {
    version_id: "version-1",
    created_at: "2026-09-10T12:00:00.000Z",
    filename: "proof.pdf",
    content_type: "application/pdf",
    preview_kind: "pdf",
    preview_url: "https://go.vornan.co/a/preview/proof.pdf?X-Amz-Signature=old",
    download_url: "https://go.vornan.co/a/download/proof.pdf?X-Amz-Signature=old",
    approval_status: null,
    approved_at: null,
    comments: [{
      text: "Check the crop marks.",
      created_at: "2026-09-10T12:01:00.000Z",
      attachments: [{ filename: "note.png", content_type: "image/png", url: "https://go.vornan.co/a/note.png" }]
    }],
    technical_checks: [],
    current: true,
    ...overrides
  };
}

function order(health: ProofOrder["health"] = "active", currentVersion = version()): ProofOrder {
  return {
    order_number: "A0230524",
    order_title: "Campaign proof",
    order_status: "Pending Art Approval",
    health,
    tasks: [{
      task_id: "task-1",
      attachment_id: "attachment-1",
      version: 2,
      line_number: "1",
      product_name: "Placard",
      quantity: 10,
      state: "pending",
      sibling_index: 1,
      sibling_count: 1,
      feedback_required: true,
      feedback_acknowledged: false,
      current_version: currentVersion,
      versions: [currentVersion]
    }],
    counts: { pending: 1, regenerating: 0, waiting: 0, reviewed: 0, total: 1 },
    last_synced_at: "2026-09-10T12:02:00.000Z",
    access: { scope: "review", decisions_enabled: true, review_experience: "simple" }
  };
}

test("retains already displayed asset URLs while a stale packet is revalidated", () => {
  const previous = order();
  const redacted = order("stale", version({
    preview_url: null,
    download_url: null,
    comments: [{
      text: "Check the crop marks.",
      created_at: "2026-09-10T12:01:00.000Z",
      attachments: [{ filename: "note.png", content_type: "image/png", url: null }]
    }]
  }));
  const merged = preserveDisplayedProofAssets(previous, redacted);
  assert.equal(merged.health, "stale");
  assert.equal(merged.tasks[0]?.current_version?.preview_url, previous.tasks[0]?.current_version?.preview_url);
  assert.equal(merged.tasks[0]?.current_version?.download_url, previous.tasks[0]?.current_version?.download_url);
  assert.equal(merged.tasks[0]?.current_version?.comments[0]?.attachments[0]?.url, "https://go.vornan.co/a/note.png");
});

test("does not carry an old asset onto a different proof version or a fresh packet", () => {
  const previous = order();
  const replacement = version({ version_id: "version-2", preview_url: null, download_url: null });
  assert.equal(preserveDisplayedProofAssets(previous, order("stale", replacement)).tasks[0]?.current_version?.preview_url, null);
  assert.equal(preserveDisplayedProofAssets(previous, order("active", version({ preview_url: null }))).tasks[0]?.current_version?.preview_url, null);
});

test("retains matching history assets without restoring removed history entries", () => {
  const previous = [version(), version({ version_id: "version-old", current: false })];
  const incoming = [version({ preview_url: null, download_url: null })];
  const merged = preserveDisplayedHistoryAssets(previous, incoming);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.preview_url, previous[0]?.preview_url);
});

test("content identity ignores freshness timestamps and rotating asset signatures", () => {
  const first = order();
  const second = {
    ...order("stale", version({
      preview_url: "https://go.vornan.co/a/preview/proof.pdf?X-Amz-Signature=new",
      download_url: "https://go.vornan.co/a/download/proof.pdf?X-Amz-Signature=new"
    })),
    last_synced_at: "2026-09-10T12:12:00.000Z"
  };
  assert.equal(proofOrderContentIdentity(first), proofOrderContentIdentity(second));
  assert.notEqual(proofOrderContentIdentity(first), proofOrderContentIdentity(order("active", version({ approval_status: "APPROVED" }))));
});

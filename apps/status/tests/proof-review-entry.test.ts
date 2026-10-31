import assert from "node:assert/strict";
import test from "node:test";
import { proofReviewEntry, safeProofReviewUrl } from "../src/proof-review-entry.ts";
import type { OrderRollupProofSummary } from "@pathfinder/order-rollup";

const summary: OrderRollupProofSummary = { source: "proof_cache", health: "active", pending: 3, reviewed: 1, total: 4,
  waiting: 0, regenerating: 0, review_required: true, last_synced_at: "2026-10-31T12:00:00Z",
  decisions_enabled: false, access_mode: "review_link", review_url: "https://proof.vornan.co/#/access/synthetic-only" };

test("pending-only entry uses selected order summary and explicit review policy", () => {
  assert.equal(proofReviewEntry(summary, "review_link", false, false)?.reviewUrl, summary.review_url);
  assert.equal(proofReviewEntry(summary, "status_only", false, false)?.reviewUrl, null);
  assert.equal(proofReviewEntry({...summary, access_mode: "status_only"}, "review_link", false, false)?.reviewUrl, null);
  for (const pending of [0, -1, NaN]) assert.equal(proofReviewEntry({...summary, pending}, "review_link", false, false), null);
  assert.equal(proofReviewEntry(summary, "off", false, false), null);
  assert.equal(proofReviewEntry(summary, "review_link", true, false), null);
  assert.equal(proofReviewEntry(undefined, "review_link", false, false), null);
});
test("uncertain availability never exposes approval entry or invents a destination", () => {
  assert.equal(proofReviewEntry(summary, "review_link", false, true)?.reviewUrl, null);
  for (const health of ["stale", "error", "missing", "cancelled", "complete"] as const)
    assert.equal(proofReviewEntry({...summary, health}, "review_link", false, false)?.reviewUrl, null);
  assert.equal(proofReviewEntry({...summary, review_url: null}, "review_link", false, false)?.reviewUrl, null);
});
test("review destination must be an explicit first-party Proof access/session URL", () => {
  for (const url of ["javascript:alert(1)", "https://evil.test/#/proof", "http://proof.vornan.co/#/proof", "https://proof.vornan.co@evil.test/#/proof", "https://u:p@proof.vornan.co/#/proof", "https://proof.vornan.co/?redirect=evil#/proof", "https://proof.vornan.co/other#/proof"])
    assert.equal(safeProofReviewUrl(url), null);
  assert.equal(safeProofReviewUrl("https://proof.vornan.co/#/proof"), "https://proof.vornan.co/#/proof");
  assert.equal(safeProofReviewUrl("https://proof.vornan.co/#/status/A0233367"), "https://proof.vornan.co/#/status/A0233367");
  assert.equal(safeProofReviewUrl("https://proof.vornan.co/#/status/A0233367?scope=review"), null);
});

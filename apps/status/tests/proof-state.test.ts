import assert from "node:assert/strict";
import test from "node:test";
import type { OrderRollupProofSummary } from "@pathfinder/order-rollup";
import { proofReviewProgress } from "../src/proof-state.ts";

const context = {
  proof_files: 0,
  proof_phase: true,
  production_phase: false,
  shipping_phase: false,
  completed: false,
  has_error: false
};

function summary(patch: Partial<OrderRollupProofSummary> = {}): OrderRollupProofSummary {
  return {
    source: "proof_cache",
    health: "active",
    pending: 0,
    regenerating: 0,
    waiting: 0,
    reviewed: 0,
    total: 0,
    review_required: false,
    last_synced_at: "2026-07-20T12:00:00.000Z",
    decisions_enabled: false,
    ...patch
  };
}

test("uses normalized cached Proof state before raw proof-file counts", () => {
  assert.deepEqual(proofReviewProgress(summary({ pending: 2, total: 2, review_required: true }), context), {
    label: "Proof review",
    detail: "Review required in Vornan Proof",
    state: "current"
  });
  assert.deepEqual(proofReviewProgress(summary({ regenerating: 1, total: 1 }), context), {
    label: "Proof review",
    detail: "Revised proof in progress",
    state: "current"
  });
  assert.deepEqual(proofReviewProgress(summary({ reviewed: 3, total: 3, health: "complete" }), context), {
    label: "Proof review",
    detail: "3 of 3 reviewed",
    state: "complete"
  });
});

test("keeps Status read-only and falls back when no normalized Proof cache exists", () => {
  assert.equal(summary({ pending: 1, total: 1, review_required: true }).decisions_enabled, false);
  assert.deepEqual(proofReviewProgress(null, { ...context, proof_files: 1 }), {
    label: "Proof review",
    detail: "1 proof file",
    state: "complete"
  });
});

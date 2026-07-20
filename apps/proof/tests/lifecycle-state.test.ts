import assert from "node:assert/strict";
import test from "node:test";
import { isOpenProofState, isReviewedProofState, proofOrderCompletion, proofOrderHealthMessage, proofStatePresentation, proofTaskCounts } from "../src/lifecycle-state.ts";
import type { ProofOrder, ProofTask } from "../src/types.ts";

function task(task_id: string, state: ProofTask["state"]): ProofTask {
  return {
    task_id,
    state,
    line_number: null,
    product_name: null,
    quantity: null,
    sibling_index: 1,
    sibling_count: 1,
    feedback_required: false,
    feedback_acknowledged: false,
    current_version: null,
    versions: []
  };
}

function order(health: ProofOrder["health"], tasks: ProofTask[]): ProofOrder {
  return {
    order_number: "A0221132",
    order_title: null,
    order_status: null,
    health,
    tasks,
    counts: proofTaskCounts(tasks),
    last_synced_at: "2026-07-20T16:42:00.000Z",
    access: { scope: "view", decisions_enabled: false }
  };
}

test("separates pending, regenerating, and waiting while grouping approved references as reviewed", () => {
  assert.deepEqual(proofTaskCounts([
    task("pending", "pending"),
    task("revised", "revised"),
    task("waiting", "waiting"),
    task("approved", "approved"),
    task("reference", "reference"),
    task("error", "error")
  ]), {
    pending: 1,
    regenerating: 1,
    waiting: 1,
    reviewed: 2,
    total: 6
  });
});

test("presents revised proofs as regenerating and keeps them in the open queue", () => {
  assert.equal(isOpenProofState("revised"), true);
  assert.equal(isReviewedProofState("revised"), false);
  assert.deepEqual(proofStatePresentation("revised"), {
    label: "Regenerating",
    detail: "A revised proof is being prepared. This version remains available for reference."
  });
});

test("provides customer-safe cached packet explanations for degraded order health", () => {
  assert.match(proofOrderHealthMessage("stale") ?? "", /last synchronized proof packet/i);
  assert.match(proofOrderHealthMessage("missing") ?? "", /previously synchronized proof files remain visible/i);
  assert.match(proofOrderHealthMessage("error") ?? "", /available files remain visible/i);
  assert.equal(proofOrderHealthMessage("active"), null);
  assert.equal(proofOrderHealthMessage("complete"), null);
});

test("presents a success state only when every available proof is reviewed", () => {
  assert.deepEqual(proofOrderCompletion(order("active", [task("approved", "approved")])), {
    title: "All proofs reviewed",
    detail: "There are no proofs awaiting review. Approved files remain available in Reviewed."
  });
  assert.deepEqual(proofOrderCompletion(order("complete", [task("approved", "approved"), task("reference", "reference")])), {
    title: "Proof packet complete",
    detail: "This order’s proof review is complete. Approved and reference files remain available in Reviewed."
  });
  assert.equal(proofOrderCompletion(order("active", [task("approved", "approved"), task("pending", "pending")])), null);
  assert.equal(proofOrderCompletion(order("active", [task("approved", "approved"), task("error", "error")])), null);
  assert.equal(proofOrderCompletion(order("stale", [task("approved", "approved")])), null);
  assert.equal(proofOrderCompletion(order("complete", [])), null);
});

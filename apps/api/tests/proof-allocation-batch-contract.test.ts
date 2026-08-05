import assert from "node:assert/strict";
import test from "node:test";
import type { ProofOrder } from "@pathfinder/proof-domain";
import {
  buildProofAllocationDraft,
  buildProofApprovalBatch,
  observeCurrentProofApproval,
  ProofAllocationBatchContractError,
  reconcileProofApprovalBatch,
  startNextProofApproval
} from "../src/proof/allocation-batch-contract.ts";

function order(): ProofOrder {
  const task = (index: number) => ({
    task_id: `ptask_${index}`,
    order_line_id: "line-1",
    line_number: "1",
    attachment_id: `attachment-${index}`,
    product_name: "Panel",
    quantity: 20,
    state: "pending" as const,
    actionable: true,
    sibling_index: index,
    sibling_count: 4,
    version: 3,
    current_version: {
      version_id: `version-${index}`,
      attachment_id: `attachment-${index}`,
      created_at: "2026-08-05T12:00:00.000Z",
      filename: `creative-${index}.pdf`,
      preview_url: null,
      download_url: null,
      approval_status: "PENDING",
      approved_by: null,
      approved_at: null,
      comments: [],
      detailed_report: null,
      feedback_fingerprint: `feedback-${index}`,
      current: true,
      archived_at: null
    },
    versions: [],
    created_at: "2026-08-05T12:00:00.000Z",
    updated_at: "2026-08-05T12:00:00.000Z",
    archived_at: null
  });
  return {
    order_number: "A0226753",
    customer_id: "1249",
    order_title: "Synthetic Proof QA",
    customer_name: "LTL Demo",
    order_status: "Pending Art Approval",
    health: "active",
    version: 8,
    lines: [{ order_line_id: "line-1", line_number: "1", step_number: 7.02, product_name: "Panel", quantity: 20, status: null, cancelled: false }],
    tasks: [task(1), task(2), task(3), task(4)],
    archived_tasks: [],
    warnings: [],
    created_at: "2026-08-05T12:00:00.000Z",
    updated_at: "2026-08-05T12:00:00.000Z",
    last_synced_at: "2026-08-05T12:00:00.000Z"
  };
}

const now = new Date("2026-08-05T13:00:00.000Z");

test("builds a deterministic exact-line allocation draft without raw message content", () => {
  const input = {
    order: order(),
    task_quantities: [
      { task_id: "ptask_1", quantity: 8 },
      { task_id: "ptask_2", quantity: 4 },
      { task_id: "ptask_3", quantity: 4 },
      { task_id: "ptask_4", quantity: 4 }
    ],
    grant_id: "pgrant_synthetic",
    participant_id: "pparticipant_synthetic",
    now
  };
  const first = buildProofAllocationDraft(input);
  const replay = buildProofAllocationDraft(input);
  assert.equal(first.draft_id, replay.draft_id);
  assert.equal(first.canonical_body_hash, replay.canonical_body_hash);
  assert.equal(first.line_quantity, 20);
  assert.deepEqual(first.entries.map((entry) => entry.quantity), [8, 4, 4, 4]);
  assert.equal(JSON.stringify(first).includes("comment"), false);
});

test("fails closed for an incomplete proof set, invalid quantity, or stale proof", () => {
  assert.throws(() => buildProofAllocationDraft({
    order: order(),
    task_quantities: [{ task_id: "ptask_1", quantity: 20 }, { task_id: "ptask_2", quantity: 1 }],
    grant_id: "pgrant_synthetic",
    participant_id: "pparticipant_synthetic",
    now
  }), ProofAllocationBatchContractError);

  assert.throws(() => buildProofAllocationDraft({
    order: order(),
    task_quantities: [
      { task_id: "ptask_1", quantity: 8 },
      { task_id: "ptask_2", quantity: 4 },
      { task_id: "ptask_3", quantity: 4 },
      { task_id: "ptask_4", quantity: 3.5 }
    ],
    grant_id: "pgrant_synthetic",
    participant_id: "pparticipant_synthetic",
    now
  }), ProofAllocationBatchContractError);
});

test("sequences one uncertain child at a time with no automatic retry", () => {
  const draft = buildProofAllocationDraft({
    order: order(),
    task_quantities: [
      { task_id: "ptask_1", quantity: 8 },
      { task_id: "ptask_2", quantity: 4 },
      { task_id: "ptask_3", quantity: 4 },
      { task_id: "ptask_4", quantity: 4 }
    ],
    grant_id: "pgrant_synthetic",
    participant_id: "pparticipant_synthetic",
    now
  });
  let batch = buildProofApprovalBatch(draft, "final_only_qa", now);
  assert.equal(batch.automatic_retry, false);
  for (let index = 0; index < 4; index += 1) {
    batch = startNextProofApproval(batch, new Date(now.getTime() + index * 2_000));
    assert.equal(batch.children.filter((child) => child.state === "submission_uncertain").length, 1);
    batch = observeCurrentProofApproval({
      batch,
      classification: "success_observed_unconfirmed",
      accepted: true,
      now: new Date(now.getTime() + index * 2_000 + 1_000)
    });
  }
  assert.equal(batch.state, "reconciling");
  assert.deepEqual(batch.children.map((child) => child.state), ["observed", "observed", "observed", "observed"]);
});

test("stops the batch on an ambiguous child and reconciles a partial result", () => {
  const before = order();
  const draft = buildProofAllocationDraft({
    order: before,
    task_quantities: [
      { task_id: "ptask_1", quantity: 8 },
      { task_id: "ptask_2", quantity: 4 },
      { task_id: "ptask_3", quantity: 4 },
      { task_id: "ptask_4", quantity: 4 }
    ],
    grant_id: "pgrant_synthetic",
    participant_id: "pparticipant_synthetic",
    now
  });
  let batch = startNextProofApproval(buildProofApprovalBatch(draft, "reconcile_each_action", now), now);
  batch = observeCurrentProofApproval({ batch, classification: "ambiguous", accepted: false, now });
  assert.equal(batch.state, "needs_attention");
  assert.throws(() => startNextProofApproval(batch, now), ProofAllocationBatchContractError);

  const after = order();
  after.tasks[0] = { ...after.tasks[0]!, state: "approved", actionable: false, line_number: "5", quantity: 8 };
  const reconciled = reconcileProofApprovalBatch({ batch, order: after, now });
  assert.equal(reconciled.batch.state, "needs_attention");
  assert.equal(reconciled.summary.lines[0]!.result, "approved");
  assert.equal(reconciled.summary.lines[0]!.resulting_line_number, "5");
  assert.equal(reconciled.summary.lines[1]!.result, "unresolved");
});

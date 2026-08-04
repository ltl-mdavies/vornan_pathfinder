import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildProofActionDraft } from "../src/ProofOpsPanel";

const order = {
  order_number: "A00000001",
  customer_id: "1249",
  customer_name: "LTL Demo",
  order_title: "Synthetic LTL Demo order",
  order_status: "Proofing",
  health: "active",
  tasks: [{
    task_id: "ptask_synthetic_001",
    order_line_id: "line-synthetic-001",
    line_number: "1",
    attachment_id: "proofing-synthetic-001",
    product_name: "Synthetic panel",
    quantity: 4,
    state: "pending",
    actionable: true,
    current_version: {
      version_id: "version-synthetic-001",
      filename: "synthetic-proof.pdf",
      attachment_id: "proofing-synthetic-001"
    }
  }],
  last_synced_at: "2026-07-26T16:00:00.000Z"
};

test("prepares a locked approval draft without transport or automatic retry", () => {
  const draft = buildProofActionDraft({
    order,
    taskId: "ptask_synthetic_001",
    action: "APPROVE",
    approvalMode: "simple",
    allocationPlan: [],
    comment: "Approved for synthetic QA",
    revisionAssetId: ""
  });

  assert.deepEqual(draft, {
    order_number: "A00000001",
    task_id: "ptask_synthetic_001",
    order_line_id: "line-synthetic-001",
    proofing_id: "proofing-synthetic-001",
    proof_filename: "synthetic-proof.pdf",
    action: "APPROVE",
    approval_mode: "simple",
    approve_quantity: null,
    allocation_plan: null,
    expected_line_quantity: 4,
    comment: "Approved for synthetic QA",
    revision_asset_id: null,
    execution: "locked",
    automatic_retry: false,
    confirmation: "authoritative_read_after_write_required"
  });
});

test("requires a complete multi-proof allocation and binds only the selected quantity", () => {
  const secondTask = {
    ...order.tasks[0],
    task_id: "ptask_synthetic_002",
    attachment_id: "proofing-synthetic-002",
    current_version: {
      ...order.tasks[0].current_version,
      version_id: "version-synthetic-002",
      filename: "synthetic-proof-b.pdf",
      attachment_id: "proofing-synthetic-002"
    }
  };
  const multiProofOrder = { ...order, tasks: [...order.tasks, secondTask] };
  const allocationPlan = [
    {
      task_id: "ptask_synthetic_001",
      attachment_id: "proofing-synthetic-001",
      approve_quantity: 3
    },
    {
      task_id: "ptask_synthetic_002",
      attachment_id: "proofing-synthetic-002",
      approve_quantity: 1
    }
  ];
  const draft = buildProofActionDraft({
    order: multiProofOrder,
    taskId: "ptask_synthetic_001",
    action: "APPROVE",
    approvalMode: "quantity_allocation",
    allocationPlan,
    comment: "Allocate current creatives",
    revisionAssetId: ""
  });
  assert.equal(draft.approve_quantity, 3);
  assert.equal(draft.expected_line_quantity, 4);
  assert.deepEqual(draft.allocation_plan, allocationPlan);

  assert.throws(
    () => buildProofActionDraft({
      order: multiProofOrder,
      taskId: "ptask_synthetic_001",
      action: "APPROVE",
      approvalMode: "quantity_allocation",
      allocationPlan: allocationPlan.map((entry) => ({ ...entry, approve_quantity: 1 })),
      comment: "",
      revisionAssetId: ""
    }),
    /Allocate all 4 items/
  );
});

test("requires a verified Pathfinder asset only for revised-art actions", () => {
  assert.throws(
    () => buildProofActionDraft({
      order,
      taskId: "ptask_synthetic_001",
      action: "REVISED_ART_WILL_BE_SENT",
      approvalMode: "simple",
      allocationPlan: [],
      comment: "",
      revisionAssetId: ""
    }),
    /verified Pathfinder Proof upload/
  );

  const revisionAssetId = `passet_${"a".repeat(64)}`;
  const draft = buildProofActionDraft({
    order,
    taskId: "ptask_synthetic_001",
    action: "REVISED_ART_WILL_BE_SENT",
    approvalMode: "simple",
    allocationPlan: [],
    comment: "Replacement supplied",
    revisionAssetId
  });
  assert.equal(draft.revision_asset_id, revisionAssetId);
  assert.equal(draft.approve_quantity, null);
});

test("fails closed for stale, non-actionable, or cross-bound proof tasks", () => {
  assert.throws(
    () => buildProofActionDraft({
      order: { ...order, customer_id: "284619" },
      taskId: "ptask_synthetic_001",
      action: "APPROVE",
      approvalMode: "simple",
      allocationPlan: [],
      comment: "",
      revisionAssetId: ""
    }),
    /restricted to the LTL Demo customer/
  );

  assert.throws(
    () => buildProofActionDraft({
      order: {
        ...order,
        tasks: [{
          ...order.tasks[0],
          actionable: false
        }]
      },
      taskId: "ptask_synthetic_001",
      action: "REJECT",
      approvalMode: "simple",
      allocationPlan: [],
      comment: "",
      revisionAssetId: ""
    }),
    /current actionable proof/
  );

  assert.throws(
    () => buildProofActionDraft({
      order: {
        ...order,
        tasks: [{
          ...order.tasks[0],
          current_version: {
            ...order.tasks[0].current_version,
            attachment_id: "proofing-synthetic-other"
          }
        }]
      },
      taskId: "ptask_synthetic_001",
      action: "REJECT",
      approvalMode: "simple",
      allocationPlan: [],
      comment: "",
      revisionAssetId: ""
    }),
    /does not match/
  );
});

test("treats every unavailable post-submit response as uncertain and never invites retry", async () => {
  const source = await readFile(
    new URL("../src/ProofOpsPanel.tsx", import.meta.url),
    "utf8"
  );
  assert.match(
    source,
    /The Proof execution response is unavailable\. Do not retry\./
  );
  assert.match(
    source,
    /authoritative Lift reconciliation is incomplete\. Do not retry\./
  );
  assert.match(
    source,
    /refreshed snapshot is unavailable\. Do not retry\./
  );
  assert.match(source, /setActionRequiresFreshSync\(true\)/);
  assert.match(source, /actionRequiresFreshSync \|\|/);
  assert.match(
    source,
    /A fresh authoritative Lift sync is required before another Proof action can be prepared\./
  );
  assert.equal(source.includes("Proof action execution failed."), false);
});

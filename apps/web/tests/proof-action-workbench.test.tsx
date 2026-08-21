import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  availableProofActions,
  buildProofActionDraft,
  canBindDeliveredRevisionAsset,
  canCreateProofReviewGrant,
  canPublishClearedRevisedArt,
  isProofAssetId,
  type ProofAssetUploadSummary
} from "../src/ProofOpsPanel";

const clearedRevisionAsset: ProofAssetUploadSummary = {
  asset_id: `passet_${"a".repeat(64)}`,
  revision_id: `prevision_${"b".repeat(64)}`,
  order_number: "A00000001",
  task_id: "ptask_synthetic_001",
  attachment_id: "proofing-synthetic-001",
  original_filename: "revised.pdf",
  content_type: "application/pdf",
  content_length: 12,
  sha256: "c".repeat(64),
  state: "scan_pending",
  record_version: 4,
  initialized_at: "2026-08-18T00:00:00.000Z",
  upload_completed_at: "2026-08-18T00:00:01.000Z",
  verification_status: "cleared",
  publication_status: "not_started"
};

test("shows a review link for revision-only access only within an associated review capability", () => {
  const revisionOnly = {
    grantCreationEnabled: true,
    approvalEnabled: false,
    revisionUploadEnabled: true,
    hasOrder: true,
    associationStatus: "associated" as const,
    accessMode: "review" as const
  };
  assert.equal(canCreateProofReviewGrant(revisionOnly), true);
  assert.equal(canCreateProofReviewGrant({ ...revisionOnly, revisionUploadEnabled: false }), false);
  assert.equal(canCreateProofReviewGrant({ ...revisionOnly, grantCreationEnabled: false }), false);
  assert.equal(canCreateProofReviewGrant({ ...revisionOnly, hasOrder: false }), false);
  assert.equal(canCreateProofReviewGrant({ ...revisionOnly, associationStatus: "unassociated" }), false);
  assert.equal(canCreateProofReviewGrant({ ...revisionOnly, accessMode: "view_only" }), false);
});

test("keeps approval-capable review links distinct from approval wording", async () => {
  assert.equal(canCreateProofReviewGrant({
    grantCreationEnabled: true,
    approvalEnabled: true,
    revisionUploadEnabled: false,
    hasOrder: true,
    associationStatus: "associated",
    accessMode: "review"
  }), true);

  const source = await readFile(new URL("../src/ProofOpsPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /Create review link/);
  assert.doesNotMatch(source, /Create approval link/);
  assert.match(source, /Revision \{health\.revised_art_upload\.enabled \? "on" : "off"\}/);
});

test("opens an LTL Demo review session from the authenticated workspace without exposing a copied access link", async () => {
  const source = await readFile(new URL("../src/ProofOpsPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /Open LTL Demo customer QA/);
  assert.match(source, /order\.customer_id !== "1249"/);
  assert.match(source, /window\.open\("", "_blank"\)/);
  assert.match(source, /proofWindow\.location\.replace\(payload\.access_url\)/);
  assert.match(source, /label: "LTL Demo customer QA"/);
});

test("shows the publication control only for a cleared unpubished asset within an enabled window", () => {
  assert.equal(canPublishClearedRevisedArt(clearedRevisionAsset, true), true);
  assert.equal(canPublishClearedRevisedArt(clearedRevisionAsset, false), false);
  assert.equal(
    canPublishClearedRevisedArt({ ...clearedRevisionAsset, publication_status: "delivery_verified" }, true),
    false
  );
  assert.equal(
    canPublishClearedRevisedArt({ ...clearedRevisionAsset, verification_status: "pending" }, true),
    false
  );
});

test("accepts only exact immutable revised-art asset identifiers for recovery", () => {
  assert.equal(isProofAssetId(clearedRevisionAsset.asset_id), true);
  assert.equal(isProofAssetId(` ${clearedRevisionAsset.asset_id} `), true);
  assert.equal(isProofAssetId("passet_short"), false);
  assert.equal(isProofAssetId(`prevision_${"a".repeat(64)}`), false);
});

test("keeps recovered publication separate from the revised-art Lift action", async () => {
  const source = await readFile(new URL("../src/ProofOpsPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /Publish one cleared revised-art asset\./);
  assert.match(source, /Publish exact cleared asset/);
  assert.match(source, /Publication rechecks the exact order and scan clearance server-side; it does not upload a file or send any Lift decision\./);
  assert.match(source, /const assetId = revisionUploadAsset\?\.asset_id \?\? revisionRecoveryAssetId\.trim\(\)/);
});

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
      approvalMode: "simple",
      allocationPlan: [],
      comment: "",
      revisionAssetId: ""
    }),
    /multiple current proofs requires a complete quantity allocation/
  );

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

test("binds the revised-art action only to the exact delivery-ready current proof", () => {
  const task = order.tasks[0];
  const delivered = {
    ...clearedRevisionAsset,
    order_number: order.order_number,
    task_id: task.task_id,
    attachment_id: task.attachment_id!,
    state: "ready_for_lift" as const,
    publication_status: "delivery_verified" as const
  };
  const input = {
    operatorActionEnabled: true,
    orderNumber: order.order_number,
    customerId: order.customer_id,
    task,
    asset: delivered
  };

  assert.equal(canBindDeliveredRevisionAsset(input), true);
  assert.deepEqual(
    availableProofActions(task, canBindDeliveredRevisionAsset(input)),
    ["APPROVE", "REJECT", "REVISED_ART_WILL_BE_SENT"]
  );
  assert.deepEqual(availableProofActions(task, false), ["APPROVE", "REJECT"]);

  for (const asset of [
    { ...delivered, order_number: "A00000002" },
    { ...delivered, task_id: "ptask_other" },
    { ...delivered, attachment_id: "proofing-other" },
    { ...delivered, state: "scan_pending" as const },
    { ...delivered, verification_status: "pending" as const },
    { ...delivered, publication_status: "published" as const }
  ]) {
    assert.equal(canBindDeliveredRevisionAsset({ ...input, asset }), false);
  }
  assert.equal(canBindDeliveredRevisionAsset({ ...input, operatorActionEnabled: false }), false);
  assert.equal(canBindDeliveredRevisionAsset({ ...input, customerId: "284619" }), false);
  assert.equal(canBindDeliveredRevisionAsset({ ...input, task: { ...task, actionable: false } }), false);
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

test("uses contextual approval, guided rejection, and accurate production-message language", async () => {
  const source = await readFile(
    new URL("../src/ProofOpsPanel.tsx", import.meta.url),
    "utf8"
  );
  assert.match(source, /selectedLineProofs\.length > 1 \? "quantity_allocation" : "simple"/);
  assert.match(source, /Artwork will not be used/);
  assert.match(source, /Revised artwork will be provided/);
  assert.match(source, /Bind delivery-ready asset/);
  assert.match(source, /This read-only lookup binds only a cleared, delivery-verified asset/);
  assert.match(source, /!selectedTaskActions\.includes\(proofAction\)/);
  assert.match(source, /Message to production team/);
  assert.match(source, /Lift order history and references the order line/);
  assert.equal(source.includes("aria-label=\"Approval mode\""), false);
});

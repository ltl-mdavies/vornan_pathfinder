import assert from "node:assert/strict";
import test from "node:test";
import { ProofApiError } from "../src/api.ts";
import {
  isLiftProofUpdatedError,
  PROOF_UPDATED_MESSAGE,
  replacementProofTaskId
} from "../src/proof-update-state.ts";
import type { ProofOrder, ProofTask } from "../src/types.ts";

function task(overrides: Partial<ProofTask> = {}): ProofTask {
  return {
    task_id: "old-task",
    attachment_id: "old-attachment",
    version: 1,
    line_number: "1",
    shared_line_numbers: [],
    product_name: "One Sheet",
    quantity: 1,
    state: "pending",
    decision_state: null,
    sibling_index: 1,
    sibling_count: 1,
    feedback_required: false,
    feedback_acknowledged: false,
    current_version: {
      version_id: "old-version",
      created_at: null,
      filename: "old.pdf",
      content_type: "application/pdf",
      preview_kind: "pdf",
      preview_url: null,
      download_url: null,
      approval_status: "PENDING",
      approved_at: null,
      comments: [],
      technical_checks: [],
      current: true
    },
    versions: [],
    ...overrides
  };
}

function order(tasks: ProofTask[]): ProofOrder {
  return {
    order_number: "A0229276",
    order_title: "Proof QA",
    order_status: "Pending Art Approval",
    health: "active",
    tasks,
    counts: { pending: 1, regenerating: 0, waiting: 0, reviewed: 0, total: tasks.length },
    last_synced_at: "2026-08-24T21:00:00.000Z",
    access: { scope: "review", decisions_enabled: true, review_experience: "simple", revision_upload_enabled: true }
  };
}

test("recognizes only the safe pre-action Lift replacement conflicts", () => {
  assert.equal(isLiftProofUpdatedError(new ProofApiError("The selected proof is no longer current and actionable.", 409)), true);
  assert.equal(isLiftProofUpdatedError(new ProofApiError("The selected Proof is not the current actionable LTL Demo attachment.", 409)), true);
  assert.equal(isLiftProofUpdatedError(new ProofApiError("This decision already entered the no-retry boundary.", 409)), false);
  assert.equal(isLiftProofUpdatedError(new ProofApiError("The selected proof is no longer current and actionable.", 500)), false);
  assert.match(PROOF_UPDATED_MESSAGE, /updated in Lift/i);
});

test("keeps the customer on the same line after Lift swaps the attachment", () => {
  const previous = task();
  const replacement = task({
    task_id: "replacement-task",
    attachment_id: "replacement-attachment",
    version: 1,
    current_version: { ...previous.current_version!, version_id: "replacement-version", filename: "replacement.pdf" }
  });
  assert.equal(replacementProofTaskId(order([task({ task_id: "other-line", line_number: "2" }), replacement]), previous), "replacement-task");
  assert.equal(replacementProofTaskId(order([task({ task_id: "waiting", current_version: null, state: "waiting" }), replacement]), previous), "replacement-task");
});

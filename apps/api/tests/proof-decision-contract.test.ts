import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  classifyProofDecisionIdempotency,
  type ProofFeedbackAcknowledgement,
  type ProofOrder,
  type ProofParticipant
} from "@pathfinder/proof-domain";
import {
  prepareProofApprovalDecision,
  ProofDecisionIntegrityError,
  type PrepareProofApprovalDecisionInput,
  type ProofDecisionIntegrityFailureCode
} from "../src/proof/decision-contract.ts";

const participant: ProofParticipant = {
  participant_id: "pparticipant_contract",
  grant_id: "pgrant_contract",
  order_number: "A0221132",
  display_name: "Contract Reviewer",
  email: "contract-reviewer@example.invalid",
  first_seen_at: "2026-07-22T12:00:00.000Z",
  last_seen_at: "2026-07-22T12:00:00.000Z"
};

const acknowledgement: ProofFeedbackAcknowledgement = {
  acknowledgement_id: "pack_contract",
  grant_id: participant.grant_id,
  participant_id: participant.participant_id,
  order_number: participant.order_number,
  task_id: "ptask_contract",
  feedback_fingerprint: "feedback-contract-v1",
  acknowledged_at: "2026-07-22T12:01:00.000Z"
};

function proofOrder(): ProofOrder {
  const currentVersion = {
    version_id: "pversion_contract_v1",
    attachment_id: "25435041",
    created_at: "2026-07-22T11:00:00.000Z",
    filename: "contract-proof.pdf",
    content_type: "application/pdf",
    preview_url: "https://proof-assets.example.invalid/contract-proof.pdf",
    download_url: "https://proof-assets.example.invalid/contract-proof.pdf",
    approval_status: "PENDING",
    approved_by: null,
    approved_at: null,
    comments: [{
      text: "Confirm the current proof feedback.",
      created_at: "2026-07-22T11:30:00.000Z",
      attachment: null
    }],
    detailed_report: null,
    feedback_fingerprint: acknowledgement.feedback_fingerprint,
    current: true,
    archived_at: null
  };
  return {
    order_number: participant.order_number,
    order_title: "Decision integrity contract",
    customer_name: null,
    order_status: "Pending Art Approval",
    health: "active",
    version: 1,
    lines: [{
      order_line_id: "9301338",
      line_number: "1",
      step_number: 7.02,
      product_name: "Contract panel",
      quantity: 1,
      status: null,
      cancelled: false
    }],
    tasks: [{
      task_id: acknowledgement.task_id,
      order_line_id: "9301338",
      line_number: "1",
      attachment_id: currentVersion.attachment_id,
      product_name: "Contract panel",
      quantity: 1,
      state: "pending",
      actionable: true,
      sibling_index: 1,
      sibling_count: 1,
      version: 7,
      current_version: currentVersion,
      versions: [currentVersion],
      created_at: "2026-07-22T11:00:00.000Z",
      updated_at: "2026-07-22T11:00:00.000Z",
      archived_at: null
    }],
    archived_tasks: [],
    warnings: [],
    created_at: "2026-07-22T11:00:00.000Z",
    updated_at: "2026-07-22T11:00:00.000Z",
    last_synced_at: "2026-07-22T11:00:00.000Z"
  };
}

function validInput(): PrepareProofApprovalDecisionInput {
  const order = proofOrder();
  const task = order.tasks[0]!;
  return {
    order,
    binding: {
      order_number: order.order_number,
      task_id: task.task_id,
      attachment_id: task.attachment_id!,
      expected_task_version: task.version,
      expected_version_id: task.current_version!.version_id
    },
    participant: { ...participant },
    participant_id: participant.participant_id,
    grant_id: participant.grant_id,
    feedback_acknowledgement: { ...acknowledgement },
    idempotency_key: "approval-contract-0001",
    note: "  Ready for production  "
  };
}

function expectFailure(input: PrepareProofApprovalDecisionInput, code: ProofDecisionIntegrityFailureCode) {
  assert.throws(
    () => prepareProofApprovalDecision(input),
    (error) => error instanceof ProofDecisionIntegrityError && error.code === code
  );
}

test("prepares a canonical approval intent without executing or persisting it", () => {
  const prepared = prepareProofApprovalDecision(validInput());
  assert.deepEqual(prepared.intent, {
    decision: "approve",
    order_number: "A0221132",
    task_id: "ptask_contract",
    attachment_id: "25435041",
    participant_id: "pparticipant_contract",
    grant_id: "pgrant_contract",
    expected_task_version: 7,
    expected_version_id: "pversion_contract_v1",
    feedback_fingerprint: "feedback-contract-v1",
    note: "Ready for production"
  });
  assert.equal(prepared.outcome, "prepared");
  assert.match(prepared.canonical_body_hash, /^[a-f0-9]{64}$/);
});

test("hashes the canonical intent deterministically and excludes the idempotency key", () => {
  const baseline = prepareProofApprovalDecision(validInput());
  assert.equal(
    baseline.canonical_body_hash,
    "041bc19e0f31ddc2e29c7c8cb6b2dfa66d37cedc101cf76005cca7dfe3b481e9"
  );
  const whitespaceEquivalent = validInput();
  whitespaceEquivalent.note = "Ready for production";
  whitespaceEquivalent.idempotency_key = "approval-contract-0002";
  assert.equal(prepareProofApprovalDecision(whitespaceEquivalent).canonical_body_hash, baseline.canonical_body_hash);

  for (const note of [null, "Ready for production.", "Ready\nfor production"] as const) {
    const changed = validInput();
    changed.note = note;
    assert.notEqual(prepareProofApprovalDecision(changed).canonical_body_hash, baseline.canonical_body_hash);
  }

  const reissuedGrant = validInput();
  reissuedGrant.grant_id = "pgrant_contract_reissued";
  reissuedGrant.participant = { ...reissuedGrant.participant!, grant_id: reissuedGrant.grant_id };
  reissuedGrant.feedback_acknowledgement = {
    ...reissuedGrant.feedback_acknowledgement!,
    grant_id: reissuedGrant.grant_id
  };
  assert.notEqual(prepareProofApprovalDecision(reissuedGrant).canonical_body_hash, baseline.canonical_body_hash);
});

test("classifies exact retries separately from changed-body idempotency conflicts", () => {
  const prepared = prepareProofApprovalDecision(validInput());
  assert.deepEqual(classifyProofDecisionIdempotency(null, prepared), { status: "new" });
  assert.deepEqual(classifyProofDecisionIdempotency({
    idempotency_key: prepared.idempotency_key,
    canonical_body_hash: prepared.canonical_body_hash,
    outcome: "submission_uncertain"
  }, prepared), { status: "replay", outcome: "submission_uncertain" });
  assert.deepEqual(classifyProofDecisionIdempotency({
    idempotency_key: prepared.idempotency_key,
    canonical_body_hash: "0".repeat(64),
    outcome: "prepared"
  }, prepared), { status: "conflict" });
});

test("rejects cross-order, cross-task, stale attachment, and stale task or proof versions", () => {
  const cases: Array<[ProofDecisionIntegrityFailureCode, (input: PrepareProofApprovalDecisionInput) => void]> = [
    ["order_mismatch", (input) => { input.binding.order_number = "A0221133"; }],
    ["order_not_actionable", (input) => { input.order.health = "complete"; }],
    ["task_not_found", (input) => { input.binding.task_id = "ptask_other_order"; }],
    ["attachment_mismatch", (input) => { input.binding.attachment_id = "25435042"; }],
    ["attachment_mismatch", (input) => { input.order.tasks[0]!.current_version!.attachment_id = "25435042"; }],
    ["task_version_mismatch", (input) => { input.binding.expected_task_version -= 1; }],
    ["proof_version_mismatch", (input) => { input.binding.expected_version_id = "pversion_stale"; }]
  ];
  for (const [code, mutate] of cases) {
    const input = validInput();
    mutate(input);
    expectFailure(input, code);
  }
});

test("rejects missing or mismatched participant identity and feedback acknowledgement", () => {
  const cases: Array<[ProofDecisionIntegrityFailureCode, (input: PrepareProofApprovalDecisionInput) => void]> = [
    ["participant_required", (input) => { input.participant = null; }],
    ["participant_required", (input) => { input.participant_id = null; }],
    ["participant_mismatch", (input) => { input.participant_id = "pparticipant_other"; }],
    ["participant_mismatch", (input) => { input.participant = { ...participant, order_number: "A0221133" }; }],
    ["participant_mismatch", (input) => { input.grant_id = "pgrant_other"; }],
    ["participant_mismatch", (input) => { input.participant = { ...participant, display_name: "" }; }],
    ["feedback_acknowledgement_required", (input) => { input.feedback_acknowledgement = null; }],
    ["feedback_acknowledgement_stale", (input) => { input.feedback_acknowledgement = { ...acknowledgement, feedback_fingerprint: "feedback-stale" }; }],
    ["feedback_acknowledgement_stale", (input) => { input.order.tasks[0]!.current_version!.feedback_fingerprint = "feedback-new"; }]
  ];
  for (const [code, mutate] of cases) {
    const input = validInput();
    mutate(input);
    expectFailure(input, code);
  }
});

test("rejects non-actionable tasks and invalid idempotency or note inputs", () => {
  const nonActionable = validInput();
  nonActionable.order.tasks[0]!.actionable = false;
  expectFailure(nonActionable, "task_not_actionable");

  const invalidKey = validInput();
  invalidKey.idempotency_key = "short";
  expectFailure(invalidKey, "idempotency_key_invalid");

  const invalidNote = validInput();
  invalidNote.note = "bad\u0000note";
  expectFailure(invalidNote, "note_invalid");
});

test("remains unroutable, unpersisted, untransported, and impossible to enable", async () => {
  process.env.PATHFINDER_PROOF_ENABLE_APPROVE = "true";
  process.env.PATHFINDER_PROOF_ENABLE_REVISION = "true";
  process.env.PATHFINDER_PROOF_ENABLE_UNDO = "true";
  const { getProofRuntimeConfig } = await import("../src/proof/runtime-config.ts");
  const config = getProofRuntimeConfig();
  assert.equal(config.feature_flags.approve, false);
  assert.equal(config.feature_flags.revision, false);
  assert.equal(config.feature_flags.undo, false);
  assert.equal(config.qa_lifecycle.lift_writes_enabled, false);

  const [contractSource, publicRouterSource, operatorRouterSource, storeSource, adapterSource] = await Promise.all([
    readFile(new URL("../src/proof/decision-contract.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/proof/public-router.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/proof/router.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/proof/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../packages/lift-proof-adapter/src/index.ts", import.meta.url), "utf8")
  ]);
  assert.doesNotMatch(publicRouterSource, /decision-contract/);
  assert.doesNotMatch(operatorRouterSource, /decision-contract/);
  assert.doesNotMatch(storeSource, /decision-contract|ProofDecisionIntegrityContract/);
  assert.doesNotMatch(adapterSource, /decision-contract|ProofDecisionIntegrityContract/);
  assert.doesNotMatch(contractSource, /express|Router|process\.env|runtime-config|\.\/store|lift-proof-adapter|\bfetch\s*\(|\bPUT\b|JWT/i);
});

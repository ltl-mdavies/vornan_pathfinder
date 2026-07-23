import { createHash } from "node:crypto";
import {
  normalizeLiftOrderNumber,
  type ProofDecisionCanonicalIntent,
  type ProofDecisionIntegrityContract,
  type ProofFeedbackAcknowledgement,
  type ProofOrder,
  type ProofParticipant
} from "@pathfinder/proof-domain";

export type ProofDecisionIntegrityFailureCode =
  | "order_mismatch"
  | "order_not_actionable"
  | "task_not_found"
  | "task_not_actionable"
  | "attachment_mismatch"
  | "task_version_mismatch"
  | "proof_version_mismatch"
  | "participant_required"
  | "participant_mismatch"
  | "feedback_acknowledgement_required"
  | "feedback_acknowledgement_stale"
  | "idempotency_key_invalid"
  | "note_invalid";

export class ProofDecisionIntegrityError extends Error {
  constructor(public readonly code: ProofDecisionIntegrityFailureCode, message: string) {
    super(message);
    this.name = "ProofDecisionIntegrityError";
  }
}

export interface PrepareProofApprovalDecisionInput {
  order: ProofOrder;
  binding: {
    order_number: string;
    task_id: string;
    attachment_id: string;
    expected_task_version: number;
    expected_version_id: string;
  };
  participant: ProofParticipant | null;
  participant_id: string | null;
  grant_id: string;
  feedback_acknowledgement: ProofFeedbackAcknowledgement | null;
  idempotency_key: string;
  note?: string | null;
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;

function fail(code: ProofDecisionIntegrityFailureCode, message: string): never {
  throw new ProofDecisionIntegrityError(code, message);
}

function normalizedNote(value: string | null | undefined) {
  if (value === null || value === undefined) return null;
  const note = value.trim();
  if (note.length > 2_000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(note)) {
    fail("note_invalid", "Proof decision note is invalid.");
  }
  return note || null;
}

function canonicalBodyHash(intent: ProofDecisionCanonicalIntent) {
  return createHash("sha256").update(JSON.stringify(intent)).digest("hex");
}

export function prepareProofApprovalDecision(
  input: PrepareProofApprovalDecisionInput
): ProofDecisionIntegrityContract {
  let requestedOrderNumber: string;
  try {
    requestedOrderNumber = normalizeLiftOrderNumber(input.binding.order_number);
  } catch {
    fail("order_mismatch", "Proof decision order does not match the loaded aggregate.");
  }
  if (requestedOrderNumber !== input.order.order_number) {
    fail("order_mismatch", "Proof decision order does not match the loaded aggregate.");
  }
  if (input.order.health !== "active") {
    fail("order_not_actionable", "Proof decision order is not currently actionable.");
  }

  const task = input.order.tasks.find((candidate) => candidate.task_id === input.binding.task_id);
  if (!task) {
    fail("task_not_found", "Proof decision task is not part of the loaded aggregate.");
  }
  if (!task.actionable || task.state !== "pending" || task.archived_at) {
    fail("task_not_actionable", "Proof decision task is not currently actionable.");
  }
  const version = task.current_version;
  if (
    !task.attachment_id ||
    !version?.attachment_id ||
    task.attachment_id !== version.attachment_id ||
    input.binding.attachment_id !== task.attachment_id
  ) {
    fail("attachment_mismatch", "Proof decision attachment is no longer current.");
  }
  if (!Number.isInteger(input.binding.expected_task_version) || input.binding.expected_task_version !== task.version) {
    fail("task_version_mismatch", "Proof decision task version is stale.");
  }
  if (!version.current || input.binding.expected_version_id !== version.version_id) {
    fail("proof_version_mismatch", "Proof decision proof version is stale.");
  }

  if (!input.participant || !input.participant_id) {
    fail("participant_required", "Identify the reviewer before preparing a proof decision.");
  }
  if (
    input.participant.participant_id !== input.participant_id ||
    input.participant.order_number !== input.order.order_number ||
    input.participant.grant_id !== input.grant_id ||
    !input.participant.display_name.trim() ||
    !input.participant.email.trim()
  ) {
    fail("participant_mismatch", "Proof decision participant is outside the current review context.");
  }

  const feedbackRequired = version.comments.length > 0;
  const acknowledgement = input.feedback_acknowledgement;
  if (feedbackRequired && !acknowledgement) {
    fail("feedback_acknowledgement_required", "Review the current proof feedback before preparing a decision.");
  }
  if (feedbackRequired && (
    acknowledgement!.grant_id !== input.grant_id ||
    acknowledgement!.participant_id !== input.participant.participant_id ||
    acknowledgement!.order_number !== input.order.order_number ||
    acknowledgement!.task_id !== task.task_id ||
    acknowledgement!.feedback_fingerprint !== version.feedback_fingerprint
  )) {
    fail("feedback_acknowledgement_stale", "Proof feedback acknowledgement is no longer current.");
  }

  if (!IDEMPOTENCY_KEY.test(input.idempotency_key)) {
    fail("idempotency_key_invalid", "Proof decision idempotency key is invalid.");
  }

  const intent: ProofDecisionCanonicalIntent = {
    decision: "approve",
    order_number: input.order.order_number,
    task_id: task.task_id,
    attachment_id: task.attachment_id,
    participant_id: input.participant.participant_id,
    grant_id: input.grant_id,
    expected_task_version: task.version,
    expected_version_id: version.version_id,
    feedback_fingerprint: version.feedback_fingerprint,
    note: normalizedNote(input.note)
  };

  return {
    idempotency_key: input.idempotency_key,
    canonical_body_hash: canonicalBodyHash(intent),
    intent,
    outcome: "prepared"
  };
}

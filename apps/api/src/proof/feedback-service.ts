import { randomUUID } from "node:crypto";
import type { ProofAccessSession, ProofFeedbackAcknowledgement, ProofOrder } from "@pathfinder/proof-domain";
import { ProofAccessValidationError } from "./access-service.js";
import { recordProofAuditEvent } from "./audit-service.js";
import {
  getProofFeedbackAcknowledgement,
  getProofParticipant,
  persistProofFeedbackAcknowledgement
} from "./store.js";

export async function proofFeedbackStates(order: ProofOrder, session: ProofAccessSession) {
  return Promise.all(order.tasks.map(async (task) => {
    const required = Boolean(task.current_version?.comments.length);
    const acknowledgement = session.participant_id
      ? await getProofFeedbackAcknowledgement(session.grant_id, session.participant_id, task.task_id)
      : null;
    return {
      task_id: task.task_id,
      feedback_required: required,
      feedback_acknowledged: Boolean(
        required &&
        acknowledgement &&
        task.current_version &&
        acknowledgement.feedback_fingerprint === task.current_version.feedback_fingerprint
      )
    };
  }));
}

export async function acknowledgeProofFeedback(input: {
  order: ProofOrder;
  session: ProofAccessSession;
  task_id: string;
  now?: Date;
  correlation_id?: string;
}) {
  if (!input.session.participant_id) {
    throw new ProofAccessValidationError("Identify the reviewer before acknowledging feedback.");
  }
  const participant = await getProofParticipant(input.session.grant_id, input.session.participant_id);
  if (!participant) {
    throw new ProofAccessValidationError("Identify the reviewer before acknowledging feedback.");
  }
  const task = input.order.tasks.find((candidate) => candidate.task_id === input.task_id);
  if (!task) {
    throw new ProofAccessValidationError("The selected proof is not available in this review session.");
  }
  if (!task.current_version?.comments.length) {
    throw new ProofAccessValidationError("This proof has no current feedback to acknowledge.");
  }
  const existing = await getProofFeedbackAcknowledgement(
    input.session.grant_id,
    participant.participant_id,
    task.task_id
  );
  if (existing?.feedback_fingerprint === task.current_version.feedback_fingerprint) {
    return { acknowledgement: existing, created: false };
  }
  const acknowledgedAt = (input.now ?? new Date()).toISOString();
  const acknowledgement: ProofFeedbackAcknowledgement = {
    acknowledgement_id: existing?.acknowledgement_id ?? `pack_${randomUUID()}`,
    grant_id: input.session.grant_id,
    participant_id: participant.participant_id,
    order_number: input.order.order_number,
    task_id: task.task_id,
    feedback_fingerprint: task.current_version.feedback_fingerprint,
    acknowledged_at: acknowledgedAt
  };
  await persistProofFeedbackAcknowledgement(acknowledgement);
  await recordProofAuditEvent({
    action: "proof.feedback_acknowledged",
    order_number: input.order.order_number,
    task_id: task.task_id,
    order_line_id: task.order_line_id,
    attachment_id: task.attachment_id,
    grant_id: input.session.grant_id,
    participant_id: participant.participant_id,
    metadata: { grant_scope: input.session.scope },
    context: {
      actor_type: "customer_session",
      actor_id: input.session.session_id,
      correlation_id: input.correlation_id,
      source: "public_api"
    },
    occurred_at: acknowledgedAt
  });
  return { acknowledgement, created: !existing };
}

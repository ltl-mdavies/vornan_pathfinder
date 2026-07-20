import { randomUUID } from "node:crypto";
import type {
  ProofAccessSession,
  ProofParticipant,
  PublicProofActivity,
  PublicProofParticipant
} from "@pathfinder/proof-domain";
import { ProofAccessValidationError } from "./access-service.js";
import { recordProofAuditEvent } from "./audit-service.js";
import {
  getProofParticipant,
  persistProofParticipant,
  persistProofSession
} from "./store.js";

const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function publicProofParticipant(participant: ProofParticipant): PublicProofParticipant {
  return {
    participant_id: participant.participant_id,
    display_name: participant.display_name,
    email: participant.email
  };
}

export function publicProofActivity(participants: ProofParticipant[]): PublicProofActivity {
  const timestamps = participants
    .map((participant) => participant.last_seen_at)
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort((left, right) => right.localeCompare(left));
  return {
    identified_reviewers: participants.length,
    last_activity_at: timestamps[0] ?? null,
    reviewer_names_visible: false
  };
}

function validatedDisplayName(value: unknown) {
  const displayName = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (displayName.length < 2 || displayName.length > 80 || CONTROL_CHARACTERS.test(displayName)) {
    throw new ProofAccessValidationError("Reviewer name must contain 2 to 80 characters.");
  }
  return displayName;
}

function validatedEmail(value: unknown) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (email.length > 254 || !EMAIL_ADDRESS.test(email)) {
    throw new ProofAccessValidationError("Enter a valid reviewer email address.");
  }
  return email;
}

export async function identifyProofParticipant(input: {
  session: ProofAccessSession;
  display_name: unknown;
  email: unknown;
  now?: Date;
  correlation_id?: string;
}) {
  const now = input.now ?? new Date();
  const occurredAt = now.toISOString();
  const displayName = validatedDisplayName(input.display_name);
  const email = validatedEmail(input.email);
  const existing = input.session.participant_id
    ? await getProofParticipant(input.session.grant_id, input.session.participant_id)
    : null;
  const participant: ProofParticipant = existing
    ? {
        ...existing,
        display_name: displayName,
        email,
        last_seen_at: occurredAt
      }
    : {
        participant_id: `pparticipant_${randomUUID()}`,
        grant_id: input.session.grant_id,
        order_number: input.session.order_number,
        display_name: displayName,
        email,
        first_seen_at: occurredAt,
        last_seen_at: occurredAt
      };
  const session: ProofAccessSession = {
    ...input.session,
    participant_id: participant.participant_id,
    last_seen_at: occurredAt
  };

  await persistProofParticipant(participant);
  await persistProofSession(session);
  await recordProofAuditEvent({
    action: existing ? "proof.participant_updated" : "proof.participant_identified",
    order_number: participant.order_number,
    grant_id: participant.grant_id,
    participant_id: participant.participant_id,
    metadata: { grant_scope: session.scope },
    context: {
      actor_type: "customer_session",
      actor_id: session.session_id,
      correlation_id: input.correlation_id,
      source: "public_api"
    },
    occurred_at: occurredAt
  });
  return { participant, session };
}

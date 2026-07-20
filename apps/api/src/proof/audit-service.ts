import { randomUUID } from "node:crypto";
import {
  normalizeLiftOrderNumber,
  type ProofAuditAction,
  type ProofAuditActorType,
  type ProofAuditEvent,
  type ProofAuditMetadata,
  type ProofAuditOutcome
} from "@pathfinder/proof-domain";
import { appendProofAuditEvent } from "./store.js";

export interface ProofAuditContext {
  actor_type: ProofAuditActorType;
  actor_id: string;
  correlation_id?: string;
  source: ProofAuditMetadata["source"];
}

const systemAuditContext: ProofAuditContext = {
  actor_type: "system",
  actor_id: "vornan-proof",
  source: "system"
};

function safeIdentifier(value: string | null | undefined, fallback: string) {
  const normalized = value?.trim() ?? "";
  return /^[A-Za-z0-9_.-]{1,160}$/.test(normalized) ? normalized : fallback;
}

function safeFailureClass(value: string | undefined) {
  if (!value) return undefined;
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(value) ? value : "OtherError";
}

export async function recordProofAuditEvent(input: {
  action: ProofAuditAction;
  outcome?: ProofAuditOutcome;
  order_number: string;
  task_id?: string | null;
  order_line_id?: string | null;
  attachment_id?: string | null;
  grant_id?: string | null;
  participant_id?: string | null;
  metadata: Omit<ProofAuditMetadata, "source">;
  context?: ProofAuditContext;
  occurred_at?: string;
}) {
  const context = input.context ?? systemAuditContext;
  const occurredAt = input.occurred_at ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(occurredAt))) {
    throw new Error("Proof audit timestamp is invalid.");
  }
  const event: ProofAuditEvent = {
    event_id: `paudit_${randomUUID()}`,
    occurred_at: occurredAt,
    action: input.action,
    outcome: input.outcome ?? "succeeded",
    order_number: normalizeLiftOrderNumber(input.order_number),
    task_id: input.task_id ?? null,
    order_line_id: input.order_line_id ?? null,
    attachment_id: input.attachment_id ?? null,
    grant_id: input.grant_id ?? null,
    participant_id: input.participant_id ?? null,
    actor_type: context.actor_type,
    actor_id: safeIdentifier(context.actor_id, "unknown"),
    correlation_id: safeIdentifier(context.correlation_id, randomUUID()),
    metadata: {
      ...input.metadata,
      ...(input.metadata.failure_class ? { failure_class: safeFailureClass(input.metadata.failure_class) } : {}),
      source: context.source
    }
  };
  return appendProofAuditEvent(event);
}

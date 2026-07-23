import { createHash } from "node:crypto";
import type {
  ProofAuditEvent,
  ProofDecisionIntegrityContract,
  ProofDecisionLedgerRecord
} from "@pathfinder/proof-domain";

export interface ProofDecisionPreparedAuditContext {
  actor_id: string;
  order_line_id: string | null;
}

const SAFE_IDENTIFIER = /^[A-Za-z0-9_.-]{1,160}$/;
const SAFE_LINE_IDENTIFIER = /^[A-Za-z0-9_.:-]{1,180}$/;
const AUDIT_EVENT_ID = /^paudit_decision-[a-f0-9]{64}$/;
const AUDIT_KEYS = [
  "action",
  "actor_id",
  "actor_type",
  "attachment_id",
  "correlation_id",
  "event_id",
  "grant_id",
  "metadata",
  "occurred_at",
  "order_line_id",
  "order_number",
  "outcome",
  "participant_id",
  "task_id"
] as const;
const AUDIT_METADATA_KEYS = ["decision_kind", "decision_outcome", "source"] as const;

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function decisionDigest(input: {
  order_number: string;
  idempotency_key: string;
  canonical_body_hash: string;
}) {
  return createHash("sha256")
    .update("vornan-proof-decision-prepared\u0000")
    .update(input.order_number)
    .update("\u0000")
    .update(input.idempotency_key)
    .update("\u0000")
    .update(input.canonical_body_hash)
    .digest("hex");
}

export function proofDecisionPreparedAuditEventId(input: {
  order_number: string;
  idempotency_key: string;
  canonical_body_hash: string;
  actor_id: string;
  order_line_id: string | null;
}) {
  return `paudit_decision-${createHash("sha256")
    .update("vornan-proof-decision-prepared-audit\u0000")
    .update(decisionDigest(input))
    .update("\u0000")
    .update(input.actor_id)
    .update("\u0000")
    .update(input.order_line_id ?? "<null>")
    .digest("hex")}`;
}

export function proofDecisionTransactionClientToken(input: {
  order_number: string;
  idempotency_key: string;
  canonical_body_hash: string;
  created_at: string;
}) {
  return `pdec-${createHash("sha256")
    .update("vornan-proof-decision-transaction\u0000")
    .update(decisionDigest(input))
    .update("\u0000")
    .update(input.created_at)
    .digest("hex")
    .slice(0, 31)}`;
}

export function proofDecisionCorrelationId(input: {
  order_number: string;
  idempotency_key: string;
  canonical_body_hash: string;
}) {
  return `pcorrelation_decision_${decisionDigest(input)}`;
}

function validAuditContext(context: ProofDecisionPreparedAuditContext) {
  return SAFE_IDENTIFIER.test(context.actor_id) &&
    (context.order_line_id === null || SAFE_LINE_IDENTIFIER.test(context.order_line_id));
}

export function buildProofDecisionPreparedAuditEvent(
  contract: ProofDecisionIntegrityContract,
  context: ProofDecisionPreparedAuditContext,
  occurredAt: string
): ProofAuditEvent {
  if (!validAuditContext(context) || !Number.isFinite(Date.parse(occurredAt))) {
    throw new Error("Proof decision prepared audit context is invalid.");
  }
  return {
    event_id: proofDecisionPreparedAuditEventId({
      order_number: contract.intent.order_number,
      idempotency_key: contract.idempotency_key,
      canonical_body_hash: contract.canonical_body_hash,
      actor_id: context.actor_id,
      order_line_id: context.order_line_id
    }),
    occurred_at: occurredAt,
    action: "proof.decision_prepared",
    outcome: "succeeded",
    order_number: contract.intent.order_number,
    task_id: contract.intent.task_id,
    order_line_id: context.order_line_id,
    attachment_id: contract.intent.attachment_id,
    grant_id: contract.intent.grant_id,
    participant_id: contract.intent.participant_id,
    actor_type: "customer_session",
    actor_id: context.actor_id,
    correlation_id: proofDecisionCorrelationId({
      order_number: contract.intent.order_number,
      idempotency_key: contract.idempotency_key,
      canonical_body_hash: contract.canonical_body_hash
    }),
    metadata: {
      source: "public_api",
      decision_kind: contract.intent.decision,
      decision_outcome: "prepared"
    }
  };
}

export function proofDecisionPreparedAuditMatches(
  record: ProofDecisionLedgerRecord,
  value: unknown
): value is ProofAuditEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  if (!exactKeys(event, AUDIT_KEYS) ||
      typeof event.metadata !== "object" ||
      event.metadata === null ||
      Array.isArray(event.metadata) ||
      !exactKeys(event.metadata as Record<string, unknown>, AUDIT_METADATA_KEYS)) {
    return false;
  }
  const metadata = event.metadata as Record<string, unknown>;
  return typeof event.event_id === "string" &&
    AUDIT_EVENT_ID.test(event.event_id) &&
    event.event_id === record.prepared_audit_event_id &&
    event.occurred_at === record.created_at &&
    event.action === "proof.decision_prepared" &&
    event.outcome === "succeeded" &&
    event.order_number === record.intent.order_number &&
    event.task_id === record.intent.task_id &&
    (event.order_line_id === null || (
      typeof event.order_line_id === "string" &&
      SAFE_LINE_IDENTIFIER.test(event.order_line_id)
    )) &&
    event.attachment_id === record.intent.attachment_id &&
    event.grant_id === record.intent.grant_id &&
    event.participant_id === record.intent.participant_id &&
    event.actor_type === "customer_session" &&
    typeof event.actor_id === "string" &&
    SAFE_IDENTIFIER.test(event.actor_id) &&
    event.event_id === proofDecisionPreparedAuditEventId({
      order_number: record.intent.order_number,
      idempotency_key: record.idempotency_key,
      canonical_body_hash: record.canonical_body_hash,
      actor_id: event.actor_id,
      order_line_id: event.order_line_id as string | null
    }) &&
    typeof event.correlation_id === "string" &&
    event.correlation_id === proofDecisionCorrelationId({
      order_number: record.intent.order_number,
      idempotency_key: record.idempotency_key,
      canonical_body_hash: record.canonical_body_hash
    }) &&
    metadata.source === "public_api" &&
    metadata.decision_kind === record.intent.decision &&
    metadata.decision_outcome === "prepared";
}

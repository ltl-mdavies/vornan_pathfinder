import { createHash } from "node:crypto";
import type { ProofDecisionLedgerRecord } from "@pathfinder/proof-domain";
import type { LiftProofingApprovalAuthenticationEnvelope } from "./proofing-approval-auth-envelope.js";
import {
  buildLiftProofingApprovalExecutionPlan,
  type LiftProofingApprovalExecutionPlan
} from "./proofing-approval-plan.js";
import {
  classifyLiftProofingDecisionResponse,
  type LiftProofingDecisionResponseClassification,
  type LiftProofingDecisionResponseObservation
} from "./proofing-decision-contract.js";

export interface LiftProofingApprovalAttemptContract {
  kind: "lift_proofing_approval_attempt";
  attempt_id: string;
  record_fingerprint: string;
  request_fingerprint: string;
  authentication_fingerprint: string;
  ledger_directive: {
    expected_outcome: "prepared";
    expected_record_version: number;
    canonical_body_hash: string;
    required_next_outcome: "submission_uncertain";
  };
  execution_boundary: {
    persist_before_transport: true;
    persistence: "not_implemented";
    transport: "not_implemented";
    automatic_retry: false;
    confirmation: "not_implemented";
  };
}

export interface LiftProofingApprovalReconciliationDirective {
  kind: "lift_proofing_approval_reconciliation_directive";
  attempt_id: string;
  observation: LiftProofingDecisionResponseClassification;
  ledger_directive:
    | {
        expected_outcome: "submission_uncertain";
        next_outcome: "reconciling";
        action: "authoritative_read_after_write_required";
      }
    | {
        expected_outcome: "submission_uncertain";
        next_outcome: null;
        action: "manual_review_required";
      };
  execution_boundary: {
    confirmed: false;
    automatic_retry: false;
    persistence: "not_implemented";
    authoritative_read: "not_implemented";
  };
}

export type LiftProofingApprovalAttemptFailureCode =
  | "ledger_record_invalid"
  | "ledger_record_stale"
  | "approval_plan_mismatch"
  | "authentication_envelope_mismatch"
  | "attempt_contract_invalid";

export class LiftProofingApprovalAttemptError extends Error {
  constructor(
    public readonly code: LiftProofingApprovalAttemptFailureCode,
    message: string
  ) {
    super(message);
    this.name = "LiftProofingApprovalAttemptError";
  }
}

const HASH = /^[a-f0-9]{64}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/;
const CLIENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const ATTEMPT_ID = /^pattempt_[a-f0-9]{64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;
const RECORD_KEYS = [
  "canonical_body_hash",
  "created_at",
  "expires_at_epoch",
  "idempotency_key",
  "intent",
  "outcome",
  "prepared_audit_event_id",
  "record_version",
  "updated_at"
] as const;
const INTENT_KEYS = [
  "attachment_id",
  "decision",
  "expected_task_version",
  "expected_version_id",
  "feedback_fingerprint",
  "grant_id",
  "note",
  "order_number",
  "participant_id",
  "task_id"
] as const;
const ATTEMPT_KEYS = [
  "attempt_id",
  "authentication_fingerprint",
  "execution_boundary",
  "kind",
  "ledger_directive",
  "record_fingerprint",
  "request_fingerprint"
] as const;
const ATTEMPT_LEDGER_KEYS = [
  "canonical_body_hash",
  "expected_outcome",
  "expected_record_version",
  "required_next_outcome"
] as const;
const ATTEMPT_BOUNDARY_KEYS = [
  "automatic_retry",
  "confirmation",
  "persist_before_transport",
  "persistence",
  "transport"
] as const;

function fail(code: LiftProofingApprovalAttemptFailureCode, message: string): never {
  throw new LiftProofingApprovalAttemptError(code, message);
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function sha256(...parts: string[]) {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part);
    hash.update("\u0000");
  }
  return hash.digest("hex");
}

function validTimestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validIntent(value: unknown) {
  if (!plainObject(value) || !exactKeys(value, INTENT_KEYS)) return false;
  return value.decision === "approve" &&
    typeof value.order_number === "string" &&
    /^A\d{7,8}$/.test(value.order_number) &&
    typeof value.task_id === "string" &&
    IDENTIFIER.test(value.task_id) &&
    typeof value.attachment_id === "string" &&
    IDENTIFIER.test(value.attachment_id) &&
    typeof value.participant_id === "string" &&
    IDENTIFIER.test(value.participant_id) &&
    typeof value.grant_id === "string" &&
    IDENTIFIER.test(value.grant_id) &&
    Number.isInteger(value.expected_task_version) &&
    Number(value.expected_task_version) > 0 &&
    typeof value.expected_version_id === "string" &&
    IDENTIFIER.test(value.expected_version_id) &&
    typeof value.feedback_fingerprint === "string" &&
    value.feedback_fingerprint.length > 0 &&
    value.feedback_fingerprint.length <= 256 &&
    (
      value.note === null ||
      (
        typeof value.note === "string" &&
        value.note.length <= 2_000 &&
        value.note === value.note.trim() &&
        !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value.note)
      )
    );
}

function validatePreparedRecord(record: ProofDecisionLedgerRecord, now: Date) {
  if (
    !plainObject(record) ||
    !exactKeys(record, RECORD_KEYS) ||
    typeof record.idempotency_key !== "string" ||
    !IDEMPOTENCY_KEY.test(record.idempotency_key) ||
    typeof record.canonical_body_hash !== "string" ||
    !HASH.test(record.canonical_body_hash) ||
    typeof record.prepared_audit_event_id !== "string" ||
    !/^paudit_decision-[a-f0-9]{64}$/.test(record.prepared_audit_event_id) ||
    record.outcome !== "prepared" ||
    !Number.isInteger(record.record_version) ||
    record.record_version < 1 ||
    !validTimestamp(record.created_at) ||
    !validTimestamp(record.updated_at) ||
    !Number.isInteger(record.expires_at_epoch) ||
    !validIntent(record.intent)
  ) {
    fail("ledger_record_invalid", "Proof decision ledger record is invalid.");
  }
  const createdAt = Date.parse(record.created_at);
  const updatedAt = Date.parse(record.updated_at);
  const nowMs = now.getTime();
  if (
    record.canonical_body_hash !==
      createHash("sha256").update(JSON.stringify(record.intent)).digest("hex") ||
    updatedAt < createdAt ||
    createdAt > nowMs ||
    updatedAt > nowMs ||
    Math.floor(updatedAt / 1_000) >= record.expires_at_epoch ||
    record.expires_at_epoch !==
      Math.floor(createdAt / 1_000) + THIRTY_DAYS_SECONDS
  ) {
    fail("ledger_record_invalid", "Proof decision ledger record integrity check failed.");
  }
  if (
    !Number.isFinite(now.getTime()) ||
    record.expires_at_epoch <= Math.floor(now.getTime() / 1_000)
  ) {
    fail("ledger_record_stale", "Proof decision ledger record is stale.");
  }
}

function expectedPlanForRecord(
  record: ProofDecisionLedgerRecord,
  plan: LiftProofingApprovalExecutionPlan
) {
  try {
    return buildLiftProofingApprovalExecutionPlan({
      company_id: plan.target.company_id,
      prepared: {
        idempotency_key: record.idempotency_key,
        canonical_body_hash: record.canonical_body_hash,
        intent: record.intent,
        outcome: "prepared"
      }
    });
  } catch {
    fail("approval_plan_mismatch", "Lift Proofing approval plan is invalid.");
  }
}

function validatePlanBinding(
  record: ProofDecisionLedgerRecord,
  plan: LiftProofingApprovalExecutionPlan
) {
  if (
    !plainObject(plan) ||
    !plainObject(plan.target) ||
    !plainObject(plan.request) ||
    plan.kind !== "lift_proofing_approval"
  ) {
    fail("approval_plan_mismatch", "Lift Proofing approval plan is invalid.");
  }
  const expected = expectedPlanForRecord(record, plan);
  if (JSON.stringify(plan) !== JSON.stringify(expected)) {
    fail("approval_plan_mismatch", "Lift Proofing approval plan does not match the ledger.");
  }
  return expected;
}

function decodeBase64Url(value: string) {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    fail(
      "authentication_envelope_mismatch",
      "Lift Proofing authentication envelope is invalid."
    );
  }
}

function validateAuthenticationBinding(
  plan: LiftProofingApprovalExecutionPlan,
  envelope: LiftProofingApprovalAuthenticationEnvelope,
  now: Date,
  recordExpiresAtEpoch: number
) {
  if (
    !plainObject(envelope) ||
    !plainObject(envelope.request) ||
    !plainObject(envelope.request.headers) ||
    !plainObject(envelope.request.headers.content_type) ||
    !plainObject(envelope.request.headers.authorization) ||
    !plainObject(envelope.request.headers.client_id) ||
    !plainObject(envelope.jwt) ||
    !plainObject(envelope.execution_boundary) ||
    envelope.kind !== "lift_proofing_approval_authentication_envelope" ||
    envelope.request.method !== plan.request.method ||
    envelope.request.path !== plan.request.path ||
    envelope.request.canonical_body_json !== plan.request.canonical_body_json ||
    envelope.request.canonical_body_sha256 !== plan.request.canonical_body_sha256 ||
    JSON.stringify(envelope.request.body) !== JSON.stringify(plan.request.body) ||
    envelope.request.headers.content_type.name !== "Content-Type" ||
    envelope.request.headers.content_type.value !== "application/json" ||
    envelope.request.headers.authorization.name !== "Authorization" ||
    envelope.request.headers.authorization.scheme !== "Bearer" ||
    envelope.request.headers.client_id.name !== "Lift-ERP-Client-Id" ||
    typeof envelope.request.headers.client_id.value !== "string" ||
    !CLIENT_ID.test(envelope.request.headers.client_id.value) ||
    envelope.jwt.lifetime_policy !== "caller_supplied_unconfirmed" ||
    envelope.execution_boundary.credential_source !== "injected" ||
    envelope.execution_boundary.credential_retention !== "none" ||
    envelope.execution_boundary.transport !== "not_implemented" ||
    envelope.execution_boundary.persistence !== "not_implemented" ||
    envelope.execution_boundary.response_execution !== "not_implemented"
  ) {
    fail(
      "authentication_envelope_mismatch",
      "Lift Proofing authentication envelope does not match the approval plan."
    );
  }
  const compact = envelope.jwt.compact;
  if (
    typeof compact !== "string" ||
    envelope.request.headers.authorization.value !== `Bearer ${compact}` ||
    createHash("sha256").update(compact).digest("hex") !==
      envelope.jwt.compact_sha256
  ) {
    fail(
      "authentication_envelope_mismatch",
      "Lift Proofing authentication envelope digest is invalid."
    );
  }
  const segments = compact.split(".");
  if (
    segments.length !== 3 ||
    segments.some((segment) => !BASE64URL.test(segment)) ||
    segments[2]?.length !== 43 ||
    decodeBase64Url(segments[0] as string) !== envelope.jwt.header_json ||
    decodeBase64Url(segments[1] as string) !== envelope.jwt.claims_json
  ) {
    fail(
      "authentication_envelope_mismatch",
      "Lift Proofing authentication envelope serialization is invalid."
    );
  }
  let header: unknown;
  let claims: unknown;
  try {
    header = JSON.parse(envelope.jwt.header_json);
    claims = JSON.parse(envelope.jwt.claims_json);
  } catch {
    fail(
      "authentication_envelope_mismatch",
      "Lift Proofing authentication envelope claims are invalid."
    );
  }
  const clientId = envelope.request.headers.client_id.value;
  if (
    !plainObject(header) ||
    !exactKeys(header, ["alg", "typ"]) ||
    header.alg !== "HS256" ||
    header.typ !== "JWT" ||
    !plainObject(claims) ||
    !exactKeys(claims, ["aud", "exp", "iat", "iss"]) ||
    claims.aud !== "https://www.lifterp.com" ||
    claims.iss !== `https://www.lifterp.com/${clientId}` ||
    !Number.isSafeInteger(claims.iat) ||
    !Number.isSafeInteger(claims.exp) ||
    Number(claims.iat) < 0 ||
    Number(claims.iat) > Math.floor(now.getTime() / 1_000) ||
    Number(claims.exp) <= Number(claims.iat) ||
    Number(claims.exp) <= Math.floor(now.getTime() / 1_000) ||
    Number(claims.exp) > recordExpiresAtEpoch
  ) {
    fail(
      "authentication_envelope_mismatch",
      "Lift Proofing authentication envelope claims are invalid."
    );
  }
  return {
    authentication_fingerprint: sha256(
      "vornan-proof-authentication-envelope-v1",
      envelope.jwt.compact_sha256,
      createHash("sha256").update(clientId).digest("hex"),
      envelope.jwt.header_json,
      envelope.jwt.claims_json
    )
  };
}

function validateAttemptContract(attempt: LiftProofingApprovalAttemptContract) {
  if (
    !plainObject(attempt) ||
    !exactKeys(attempt, ATTEMPT_KEYS) ||
    attempt.kind !== "lift_proofing_approval_attempt" ||
    !ATTEMPT_ID.test(attempt.attempt_id) ||
    !HASH.test(attempt.record_fingerprint) ||
    !HASH.test(attempt.request_fingerprint) ||
    !HASH.test(attempt.authentication_fingerprint) ||
    !plainObject(attempt.ledger_directive) ||
    !exactKeys(attempt.ledger_directive, ATTEMPT_LEDGER_KEYS) ||
    attempt.ledger_directive.expected_outcome !== "prepared" ||
    !Number.isInteger(attempt.ledger_directive.expected_record_version) ||
    attempt.ledger_directive.expected_record_version < 1 ||
    !HASH.test(attempt.ledger_directive.canonical_body_hash) ||
    attempt.ledger_directive.required_next_outcome !== "submission_uncertain" ||
    !plainObject(attempt.execution_boundary) ||
    !exactKeys(attempt.execution_boundary, ATTEMPT_BOUNDARY_KEYS) ||
    attempt.execution_boundary.persist_before_transport !== true ||
    attempt.execution_boundary.persistence !== "not_implemented" ||
    attempt.execution_boundary.transport !== "not_implemented" ||
    attempt.execution_boundary.automatic_retry !== false ||
    attempt.execution_boundary.confirmation !== "not_implemented"
  ) {
    fail("attempt_contract_invalid", "Lift Proofing approval attempt is invalid.");
  }
  const expectedAttemptId = `pattempt_${sha256(
    "vornan-proof-approval-attempt-v1",
    attempt.record_fingerprint,
    attempt.request_fingerprint,
    attempt.authentication_fingerprint,
    String(attempt.ledger_directive.expected_record_version),
    attempt.ledger_directive.canonical_body_hash
  )}`;
  if (attempt.attempt_id !== expectedAttemptId) {
    fail("attempt_contract_invalid", "Lift Proofing approval attempt digest is invalid.");
  }
}

export function prepareLiftProofingApprovalAttempt(input: {
  record: ProofDecisionLedgerRecord;
  plan: LiftProofingApprovalExecutionPlan;
  authentication: LiftProofingApprovalAuthenticationEnvelope;
  now: Date;
}): LiftProofingApprovalAttemptContract {
  validatePreparedRecord(input.record, input.now);
  const plan = validatePlanBinding(input.record, input.plan);
  const authentication = validateAuthenticationBinding(
    plan,
    input.authentication,
    input.now,
    input.record.expires_at_epoch
  );
  const recordFingerprint = sha256(
    "vornan-proof-decision-record-v1",
    input.record.intent.order_number,
    input.record.idempotency_key,
    input.record.canonical_body_hash,
    input.record.intent.task_id,
    input.record.intent.attachment_id,
    input.record.prepared_audit_event_id,
    String(input.record.record_version),
    input.record.created_at,
    input.record.updated_at,
    String(input.record.expires_at_epoch)
  );
  const requestFingerprint = sha256(
    "vornan-proof-approval-request-v1",
    plan.request.method,
    plan.request.path,
    plan.request.canonical_body_sha256,
    plan.request.required_header_names.join("\n")
  );
  const attemptId = `pattempt_${sha256(
    "vornan-proof-approval-attempt-v1",
    recordFingerprint,
    requestFingerprint,
    authentication.authentication_fingerprint,
    String(input.record.record_version),
    input.record.canonical_body_hash
  )}`;

  return {
    kind: "lift_proofing_approval_attempt",
    attempt_id: attemptId,
    record_fingerprint: recordFingerprint,
    request_fingerprint: requestFingerprint,
    authentication_fingerprint: authentication.authentication_fingerprint,
    ledger_directive: {
      expected_outcome: "prepared",
      expected_record_version: input.record.record_version,
      canonical_body_hash: input.record.canonical_body_hash,
      required_next_outcome: "submission_uncertain"
    },
    execution_boundary: {
      persist_before_transport: true,
      persistence: "not_implemented",
      transport: "not_implemented",
      automatic_retry: false,
      confirmation: "not_implemented"
    }
  };
}

export function reconcileLiftProofingApprovalObservation(input: {
  attempt: LiftProofingApprovalAttemptContract;
  observation: LiftProofingDecisionResponseObservation;
}): LiftProofingApprovalReconciliationDirective {
  validateAttemptContract(input.attempt);
  const observation = classifyLiftProofingDecisionResponse(input.observation);
  return {
    kind: "lift_proofing_approval_reconciliation_directive",
    attempt_id: input.attempt.attempt_id,
    observation,
    ledger_directive:
      observation.reconciliation === "read_after_write_required"
        ? {
            expected_outcome: "submission_uncertain",
            next_outcome: "reconciling",
            action: "authoritative_read_after_write_required"
          }
        : {
            expected_outcome: "submission_uncertain",
            next_outcome: null,
            action: "manual_review_required"
          },
    execution_boundary: {
      confirmed: false,
      automatic_retry: false,
      persistence: "not_implemented",
      authoritative_read: "not_implemented"
    }
  };
}

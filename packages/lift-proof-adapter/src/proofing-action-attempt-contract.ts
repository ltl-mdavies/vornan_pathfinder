import { createHash } from "node:crypto";
import {
  LIFT_PROOFING_ACTIONS,
  buildLiftProofingActionExecutionPlan,
  type LiftProofingAction,
  type LiftProofingActionExecutionPlan,
  type LiftProofingPreparedActionRecord,
  validateLiftProofingPreparedActionRecord
} from "./proofing-action-plan.js";
import type { LiftProofingActionAuthenticationEnvelope } from "./proofing-action-auth-envelope.js";
import {
  classifyLiftProofingDecisionResponse,
  type LiftProofingDecisionResponseClassification,
  type LiftProofingDecisionResponseObservation
} from "./proofing-decision-contract.js";

export interface LiftProofingActionAttemptContract {
  kind: "lift_proofing_action_attempt";
  action: LiftProofingAction;
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

export interface LiftProofingActionReconciliationDirective {
  kind: "lift_proofing_action_reconciliation_directive";
  action: LiftProofingAction;
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

export type LiftProofingActionAttemptFailureCode =
  | "prepared_record_invalid"
  | "prepared_record_stale"
  | "action_plan_mismatch"
  | "authentication_envelope_mismatch"
  | "attempt_contract_invalid";

export class LiftProofingActionAttemptError extends Error {
  constructor(
    public readonly code: LiftProofingActionAttemptFailureCode,
    message: string
  ) {
    super(message);
    this.name = "LiftProofingActionAttemptError";
  }
}

const HASH = /^[a-f0-9]{64}$/;
const CLIENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const ATTEMPT_ID = /^paction_[a-f0-9]{64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const ACTIONS = new Set<string>(LIFT_PROOFING_ACTIONS);
const ATTEMPT_KEYS = [
  "action",
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

function fail(code: LiftProofingActionAttemptFailureCode, message: string): never {
  throw new LiftProofingActionAttemptError(code, message);
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

function validateCurrentRecord(record: LiftProofingPreparedActionRecord, now: Date) {
  try {
    validateLiftProofingPreparedActionRecord(record);
  } catch {
    fail("prepared_record_invalid", "Prepared Proof action record is invalid.");
  }
  const nowMs = now.getTime();
  if (
    !Number.isFinite(nowMs) ||
    Date.parse(record.created_at) > nowMs ||
    Date.parse(record.updated_at) > nowMs ||
    record.expires_at_epoch <= Math.floor(nowMs / 1_000)
  ) {
    fail("prepared_record_stale", "Prepared Proof action record is stale.");
  }
}

function validatePlanBinding(
  record: LiftProofingPreparedActionRecord,
  plan: LiftProofingActionExecutionPlan
) {
  let expected: LiftProofingActionExecutionPlan;
  try {
    expected = buildLiftProofingActionExecutionPlan({ prepared: record });
  } catch {
    fail("action_plan_mismatch", "Lift Proofing action plan is invalid.");
  }
  if (JSON.stringify(plan) !== JSON.stringify(expected)) {
    fail("action_plan_mismatch", "Lift Proofing action plan does not match the record.");
  }
  return expected;
}

function decodeBase64Url(value: string) {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    fail(
      "authentication_envelope_mismatch",
      "Lift Proofing action authentication envelope is invalid."
    );
  }
}

function validateAuthenticationBinding(
  record: LiftProofingPreparedActionRecord,
  plan: LiftProofingActionExecutionPlan,
  envelope: LiftProofingActionAuthenticationEnvelope,
  now: Date
) {
  if (
    !plainObject(envelope) ||
    envelope.kind !== "lift_proofing_action_authentication_envelope" ||
    envelope.action !== plan.action ||
    !plainObject(envelope.request) ||
    !plainObject(envelope.request.headers) ||
    !plainObject(envelope.request.headers.content_type) ||
    !plainObject(envelope.request.headers.authorization) ||
    !plainObject(envelope.request.headers.client_id) ||
    !plainObject(envelope.jwt) ||
    !plainObject(envelope.execution_boundary) ||
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
    envelope.execution_boundary.credential_source !== "injected_synthetic_fixture" ||
    envelope.execution_boundary.credential_retention !== "none" ||
    envelope.execution_boundary.persistence !== "not_implemented" ||
    envelope.execution_boundary.transport !== "not_implemented" ||
    envelope.execution_boundary.response_execution !== "not_implemented"
  ) {
    fail(
      "authentication_envelope_mismatch",
      "Lift Proofing action authentication envelope does not match the plan."
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
      "Lift Proofing action authentication envelope digest is invalid."
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
      "Lift Proofing action authentication envelope serialization is invalid."
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
      "Lift Proofing action authentication envelope claims are invalid."
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
    Number(claims.exp) > record.expires_at_epoch
  ) {
    fail(
      "authentication_envelope_mismatch",
      "Lift Proofing action authentication envelope claims are invalid."
    );
  }
  return sha256(
    "vornan-proof-action-authentication-v1",
    envelope.jwt.compact_sha256,
    createHash("sha256").update(clientId).digest("hex"),
    envelope.jwt.header_json,
    envelope.jwt.claims_json,
    envelope.action
  );
}

function validateAttempt(attempt: LiftProofingActionAttemptContract) {
  if (
    !plainObject(attempt) ||
    !exactKeys(attempt, ATTEMPT_KEYS) ||
    attempt.kind !== "lift_proofing_action_attempt" ||
    !ACTIONS.has(attempt.action) ||
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
    fail("attempt_contract_invalid", "Lift Proofing action attempt is invalid.");
  }
  const expectedId = `paction_${sha256(
    "vornan-proof-action-attempt-v1",
    attempt.action,
    attempt.record_fingerprint,
    attempt.request_fingerprint,
    attempt.authentication_fingerprint,
    String(attempt.ledger_directive.expected_record_version),
    attempt.ledger_directive.canonical_body_hash
  )}`;
  if (attempt.attempt_id !== expectedId) {
    fail("attempt_contract_invalid", "Lift Proofing action attempt digest is invalid.");
  }
}

export function prepareLiftProofingActionAttempt(input: {
  record: LiftProofingPreparedActionRecord;
  plan: LiftProofingActionExecutionPlan;
  authentication: LiftProofingActionAuthenticationEnvelope;
  now: Date;
}): LiftProofingActionAttemptContract {
  validateCurrentRecord(input.record, input.now);
  const plan = validatePlanBinding(input.record, input.plan);
  const authenticationFingerprint = validateAuthenticationBinding(
    input.record,
    plan,
    input.authentication,
    input.now
  );
  const recordFingerprint = sha256(
    "vornan-proof-action-record-v1",
    input.record.intent.action,
    input.record.intent.company_id,
    input.record.intent.order_number,
    input.record.idempotency_key,
    input.record.canonical_body_hash,
    input.record.intent.task_id,
    input.record.intent.attachment_id,
    input.record.intent.participant_id,
    input.record.intent.grant_id,
    String(input.record.intent.expected_task_version),
    input.record.intent.expected_version_id,
    input.record.intent.feedback_fingerprint,
    input.record.prepared_audit_event_id,
    String(input.record.record_version),
    input.record.created_at,
    input.record.updated_at,
    String(input.record.expires_at_epoch)
  );
  const requestFingerprint = sha256(
    "vornan-proof-action-request-v1",
    plan.action,
    plan.request.method,
    plan.request.path,
    plan.request.canonical_body_sha256,
    plan.request.required_header_names.join("\n")
  );
  const attemptId = `paction_${sha256(
    "vornan-proof-action-attempt-v1",
    plan.action,
    recordFingerprint,
    requestFingerprint,
    authenticationFingerprint,
    String(input.record.record_version),
    input.record.canonical_body_hash
  )}`;

  return {
    kind: "lift_proofing_action_attempt",
    action: plan.action,
    attempt_id: attemptId,
    record_fingerprint: recordFingerprint,
    request_fingerprint: requestFingerprint,
    authentication_fingerprint: authenticationFingerprint,
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

export function reconcileLiftProofingActionObservation(input: {
  attempt: LiftProofingActionAttemptContract;
  observation: LiftProofingDecisionResponseObservation;
}): LiftProofingActionReconciliationDirective {
  validateAttempt(input.attempt);
  const observation = classifyLiftProofingDecisionResponse(input.observation);
  return {
    kind: "lift_proofing_action_reconciliation_directive",
    action: input.attempt.action,
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

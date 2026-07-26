import { createHash } from "node:crypto";
import { isIP } from "node:net";
import {
  buildLiftProofingDecisionRequestContract,
  type LiftProofingDecisionBody,
  type LiftProofingRejectReason
} from "./proofing-decision-contract.js";

export const LIFT_PROOFING_ACTIONS = [
  "APPROVE",
  "REJECT",
  "SEND_BACK_TO_ARTIST",
  "CANCEL_LINE",
  "REVISED_ART_WILL_BE_SENT"
] as const;

export type LiftProofingAction = (typeof LIFT_PROOFING_ACTIONS)[number];

export const LIFT_PROOFING_ACTION_USER_NAME = "VORNAN_PROOF" as const;
export const LIFT_PROOFING_ACTION_APPROVE_QUANTITY = 1 as const;
export const LIFT_PROOFING_ACTION_REQUIRED_HEADER_NAMES = Object.freeze([
  "Content-Type",
  "Authorization",
  "Lift-ERP-Client-Id"
] as const);

export interface LiftProofingPreparedActionIntent {
  action: LiftProofingAction;
  company_id: string;
  order_number: string;
  task_id: string;
  attachment_id: string;
  participant_id: string;
  grant_id: string;
  expected_task_version: number;
  expected_version_id: string;
  feedback_fingerprint: string;
  note: string | null;
  revised_art_url: string | null;
}

export interface LiftProofingPreparedActionRecord {
  idempotency_key: string;
  canonical_body_hash: string;
  intent: LiftProofingPreparedActionIntent;
  outcome: "prepared";
  prepared_audit_event_id: string;
  record_version: number;
  created_at: string;
  updated_at: string;
  expires_at_epoch: number;
}

export interface LiftProofingActionExecutionPlan {
  kind: "lift_proofing_action";
  action: LiftProofingAction;
  target: {
    company_id: string;
    proofing_id: string;
  };
  request: {
    method: "PUT";
    path: string;
    required_header_names: typeof LIFT_PROOFING_ACTION_REQUIRED_HEADER_NAMES;
    body: LiftProofingDecisionBody;
    canonical_body_json: string;
    canonical_body_sha256: string;
  };
  execution_boundary: {
    jwt_policy: "authoritative_confirmation_required";
    jwt_compact_serialization: "not_implemented";
    jwt_signing: "not_implemented";
    credentials: "not_accessed";
    persistence: "not_implemented";
    transport: "not_implemented";
    response_execution: "not_implemented";
    response_contract: "unconfirmed";
    automatic_retry: false;
  };
}

export type LiftProofingActionPlanFailureCode =
  | "prepared_record_invalid"
  | "canonical_hash_mismatch"
  | "action_invalid"
  | "revised_art_url_invalid";

export class LiftProofingActionPlanError extends Error {
  constructor(
    public readonly code: LiftProofingActionPlanFailureCode,
    message: string
  ) {
    super(message);
    this.name = "LiftProofingActionPlanError";
  }
}

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;
const HASH = /^[a-f0-9]{64}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const INTERNAL_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const PREPARED_AUDIT_EVENT_ID = /^paudit_decision-[a-f0-9]{64}$/;
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
  "action",
  "attachment_id",
  "company_id",
  "expected_task_version",
  "expected_version_id",
  "feedback_fingerprint",
  "grant_id",
  "note",
  "order_number",
  "participant_id",
  "revised_art_url",
  "task_id"
] as const;
const ACTIONS = new Set<string>(LIFT_PROOFING_ACTIONS);

function fail(code: LiftProofingActionPlanFailureCode, message: string): never {
  throw new LiftProofingActionPlanError(code, message);
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

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (plainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableJsonValue(entry)])
    );
  }
  return value;
}

export function liftProofingPreparedActionCanonicalJson(
  intent: LiftProofingPreparedActionIntent
) {
  return JSON.stringify(stableJsonValue(intent));
}

export function liftProofingPreparedActionCanonicalHash(
  intent: LiftProofingPreparedActionIntent
) {
  return createHash("sha256")
    .update(liftProofingPreparedActionCanonicalJson(intent))
    .digest("hex");
}

function normalizedText(value: unknown, maximum: number, optional = false) {
  if (value === null && optional) return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (
    (!normalized && !optional) ||
    normalized.length > maximum ||
    CONTROL_CHARACTERS.test(normalized)
  ) {
    return undefined;
  }
  return normalized || null;
}

function safeRevisedArtUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.length > 2_048) {
    fail("revised_art_url_invalid", "A safe revised-art HTTPS URL is required.");
  }
  try {
    const url = new URL(value.trim());
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      !hostname.includes(".") ||
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      isIP(hostname) !== 0
    ) {
      fail("revised_art_url_invalid", "A safe revised-art HTTPS URL is required.");
    }
    return url.toString();
  } catch (error) {
    if (error instanceof LiftProofingActionPlanError) throw error;
    fail("revised_art_url_invalid", "A safe revised-art HTTPS URL is required.");
  }
}

function validIntent(
  value: unknown
): value is LiftProofingPreparedActionIntent {
  if (!plainObject(value) || !exactKeys(value, INTENT_KEYS)) return false;
  if (
    typeof value.action !== "string" ||
    !ACTIONS.has(value.action) ||
    typeof value.company_id !== "string" ||
    !IDENTIFIER.test(value.company_id) ||
    typeof value.order_number !== "string" ||
    !/^A\d{7,8}$/.test(value.order_number) ||
    typeof value.task_id !== "string" ||
    !INTERNAL_IDENTIFIER.test(value.task_id) ||
    typeof value.attachment_id !== "string" ||
    !INTERNAL_IDENTIFIER.test(value.attachment_id) ||
    typeof value.participant_id !== "string" ||
    !INTERNAL_IDENTIFIER.test(value.participant_id) ||
    typeof value.grant_id !== "string" ||
    !INTERNAL_IDENTIFIER.test(value.grant_id) ||
    !Number.isInteger(value.expected_task_version) ||
    Number(value.expected_task_version) <= 0 ||
    typeof value.expected_version_id !== "string" ||
    !INTERNAL_IDENTIFIER.test(value.expected_version_id) ||
    typeof value.feedback_fingerprint !== "string" ||
    !value.feedback_fingerprint ||
    value.feedback_fingerprint.length > 256 ||
    CONTROL_CHARACTERS.test(value.feedback_fingerprint) ||
    (
      value.note !== null &&
      (
        typeof value.note !== "string" ||
        normalizedText(value.note, 2_000, true) !== value.note
      )
    )
  ) {
    return false;
  }
  if (value.action === "REVISED_ART_WILL_BE_SENT") {
    try {
      return safeRevisedArtUrl(value.revised_art_url) === value.revised_art_url;
    } catch {
      return false;
    }
  }
  return value.revised_art_url === null;
}

export function validateLiftProofingPreparedActionRecord(
  record: LiftProofingPreparedActionRecord
) {
  if (
    !plainObject(record) ||
    !exactKeys(record, RECORD_KEYS) ||
    typeof record.idempotency_key !== "string" ||
    !IDEMPOTENCY_KEY.test(record.idempotency_key) ||
    typeof record.canonical_body_hash !== "string" ||
    !HASH.test(record.canonical_body_hash) ||
    record.outcome !== "prepared" ||
    typeof record.prepared_audit_event_id !== "string" ||
    !PREPARED_AUDIT_EVENT_ID.test(record.prepared_audit_event_id) ||
    !Number.isInteger(record.record_version) ||
    record.record_version < 1 ||
    typeof record.created_at !== "string" ||
    !Number.isFinite(Date.parse(record.created_at)) ||
    typeof record.updated_at !== "string" ||
    !Number.isFinite(Date.parse(record.updated_at)) ||
    !Number.isInteger(record.expires_at_epoch) ||
    !validIntent(record.intent)
  ) {
    fail("prepared_record_invalid", "Prepared Proof action record is invalid.");
  }
  const createdAt = Date.parse(record.created_at);
  const updatedAt = Date.parse(record.updated_at);
  if (
    updatedAt < createdAt ||
    record.expires_at_epoch !==
      Math.floor(createdAt / 1_000) + THIRTY_DAYS_SECONDS ||
    Math.floor(updatedAt / 1_000) >= record.expires_at_epoch
  ) {
    fail("prepared_record_invalid", "Prepared Proof action record timing is invalid.");
  }
  if (
    record.canonical_body_hash !==
      liftProofingPreparedActionCanonicalHash(record.intent)
  ) {
    fail("canonical_hash_mismatch", "Prepared Proof action hash does not match its intent.");
  }
  return record;
}

function actionBody(intent: LiftProofingPreparedActionIntent): LiftProofingDecisionBody {
  const common = {
    userName: LIFT_PROOFING_ACTION_USER_NAME,
    ...(intent.note === null ? {} : { comment: intent.note })
  };
  if (intent.action === "APPROVE") {
    return {
      approve: true,
      approveQuantity: LIFT_PROOFING_ACTION_APPROVE_QUANTITY,
      ...common
    };
  }
  if (intent.action === "REVISED_ART_WILL_BE_SENT") {
    return {
      approve: false,
      rejectReason: intent.action,
      artUrl: safeRevisedArtUrl(intent.revised_art_url),
      upload: true,
      ...common
    };
  }
  return {
    approve: false,
    rejectReason: intent.action as LiftProofingRejectReason,
    ...common
  };
}

export function buildLiftProofingActionExecutionPlan(input: {
  prepared: LiftProofingPreparedActionRecord;
}): LiftProofingActionExecutionPlan {
  const prepared = validateLiftProofingPreparedActionRecord(input.prepared);
  const request = buildLiftProofingDecisionRequestContract({
    company_id: prepared.intent.company_id,
    proofing_id: prepared.intent.attachment_id,
    body: actionBody(prepared.intent)
  });
  const canonicalBodyJson = JSON.stringify(stableJsonValue(request.body));

  return {
    kind: "lift_proofing_action",
    action: prepared.intent.action,
    target: {
      company_id: prepared.intent.company_id,
      proofing_id: prepared.intent.attachment_id
    },
    request: {
      method: request.method,
      path: request.path,
      required_header_names: LIFT_PROOFING_ACTION_REQUIRED_HEADER_NAMES,
      body: request.body,
      canonical_body_json: canonicalBodyJson,
      canonical_body_sha256: createHash("sha256")
        .update(canonicalBodyJson)
        .digest("hex")
    },
    execution_boundary: {
      jwt_policy: "authoritative_confirmation_required",
      jwt_compact_serialization: "not_implemented",
      jwt_signing: "not_implemented",
      credentials: "not_accessed",
      persistence: "not_implemented",
      transport: "not_implemented",
      response_execution: "not_implemented",
      response_contract: request.response_contract,
      automatic_retry: false
    }
  };
}

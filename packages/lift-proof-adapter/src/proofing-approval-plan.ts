import { createHash } from "node:crypto";
import type {
  ProofDecisionCanonicalIntent,
  ProofDecisionIntegrityContract
} from "@pathfinder/proof-domain";
import {
  buildLiftProofingDecisionRequestContract,
  type LiftProofingApproveBody
} from "./proofing-decision-contract.js";

export const LIFT_PROOFING_APPROVAL_USER_NAME = "VORNAN_PROOF" as const;
export const LIFT_PROOFING_APPROVAL_QUANTITY = 1 as const;
export const LIFT_PROOFING_APPROVAL_REQUIRED_HEADER_NAMES = Object.freeze([
  "Content-Type",
  "Authorization",
  "Lift-ERP-Client-Id"
] as const);

export interface LiftProofingApprovalExecutionPlan {
  kind: "lift_proofing_approval";
  target: {
    company_id: string;
    proofing_id: string;
  };
  request: {
    method: "PUT";
    path: string;
    required_header_names: typeof LIFT_PROOFING_APPROVAL_REQUIRED_HEADER_NAMES;
    body: LiftProofingApproveBody;
    canonical_body_json: string;
    canonical_body_sha256: string;
  };
  execution_boundary: {
    jwt_policy: "authoritative_confirmation_required";
    jwt_compact_serialization: "not_implemented";
    jwt_signing: "not_implemented";
    credentials: "not_accessed";
    transport: "not_implemented";
    response_execution: "not_implemented";
    response_contract: "unconfirmed";
  };
}

export type LiftProofingApprovalPlanFailureCode =
  | "prepared_contract_invalid"
  | "canonical_hash_mismatch";

export class LiftProofingApprovalPlanError extends Error {
  constructor(
    public readonly code: LiftProofingApprovalPlanFailureCode,
    message: string
  ) {
    super(message);
    this.name = "LiftProofingApprovalPlanError";
  }
}

const CONTRACT_KEYS = ["canonical_body_hash", "idempotency_key", "intent", "outcome"] as const;
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
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function fail(code: LiftProofingApprovalPlanFailureCode, message: string): never {
  throw new LiftProofingApprovalPlanError(code, message);
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function validIntent(value: unknown): value is ProofDecisionCanonicalIntent {
  if (!plainObject(value) || !exactKeys(value, INTENT_KEYS)) {
    return false;
  }
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
        !CONTROL_CHARACTERS.test(value.note)
      )
    );
}

function validatePreparedContract(
  value: ProofDecisionIntegrityContract
): asserts value is ProofDecisionIntegrityContract {
  if (
    !plainObject(value) ||
    !exactKeys(value, CONTRACT_KEYS) ||
    typeof value.idempotency_key !== "string" ||
    !IDEMPOTENCY_KEY.test(value.idempotency_key) ||
    typeof value.canonical_body_hash !== "string" ||
    !HASH.test(value.canonical_body_hash) ||
    value.outcome !== "prepared" ||
    !validIntent(value.intent)
  ) {
    fail("prepared_contract_invalid", "Prepared Proof approval contract is invalid.");
  }
  const expectedHash = createHash("sha256")
    .update(JSON.stringify(value.intent))
    .digest("hex");
  if (value.canonical_body_hash !== expectedHash) {
    fail("canonical_hash_mismatch", "Prepared Proof approval contract hash does not match its intent.");
  }
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableJsonValue);
  }
  if (plainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableJsonValue(entry)])
    );
  }
  return value;
}

export function buildLiftProofingApprovalExecutionPlan(input: {
  company_id: string;
  prepared: ProofDecisionIntegrityContract;
}): LiftProofingApprovalExecutionPlan {
  validatePreparedContract(input.prepared);
  const request = buildLiftProofingDecisionRequestContract({
    company_id: input.company_id,
    proofing_id: input.prepared.intent.attachment_id,
    body: {
      approve: true,
      approveQuantity: LIFT_PROOFING_APPROVAL_QUANTITY,
      userName: LIFT_PROOFING_APPROVAL_USER_NAME,
      ...(input.prepared.intent.note === null ? {} : { comment: input.prepared.intent.note })
    }
  });
  if (!request.body.approve) {
    fail("prepared_contract_invalid", "Prepared Proof approval produced a non-approval body.");
  }
  const canonicalBodyJson = JSON.stringify(stableJsonValue(request.body));

  return {
    kind: "lift_proofing_approval",
    target: {
      company_id: input.company_id.trim(),
      proofing_id: input.prepared.intent.attachment_id
    },
    request: {
      method: request.method,
      path: request.path,
      required_header_names: LIFT_PROOFING_APPROVAL_REQUIRED_HEADER_NAMES,
      body: request.body,
      canonical_body_json: canonicalBodyJson,
      canonical_body_sha256: createHash("sha256").update(canonicalBodyJson).digest("hex")
    },
    execution_boundary: {
      jwt_policy: "authoritative_confirmation_required",
      jwt_compact_serialization: "not_implemented",
      jwt_signing: "not_implemented",
      credentials: "not_accessed",
      transport: "not_implemented",
      response_execution: "not_implemented",
      response_contract: request.response_contract
    }
  };
}

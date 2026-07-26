import { createHash, createHmac } from "node:crypto";
import {
  buildLiftProofingDecisionPath,
  buildLiftProofingUnsignedJwtContract,
  normalizeLiftProofingDecisionBody,
  type LiftProofingDecisionBody
} from "./proofing-decision-contract.js";
import {
  LIFT_PROOFING_ACTION_REQUIRED_HEADER_NAMES,
  type LiftProofingAction,
  type LiftProofingActionExecutionPlan
} from "./proofing-action-plan.js";

export interface LiftProofingActionAuthenticationEnvelope {
  kind: "lift_proofing_action_authentication_envelope";
  action: LiftProofingAction;
  request: {
    method: "PUT";
    path: string;
    headers: {
      content_type: {
        name: "Content-Type";
        value: "application/json";
      };
      authorization: {
        name: "Authorization";
        scheme: "Bearer";
        value: string;
      };
      client_id: {
        name: "Lift-ERP-Client-Id";
        value: string;
      };
    };
    body: LiftProofingDecisionBody;
    canonical_body_json: string;
    canonical_body_sha256: string;
  };
  jwt: {
    header_json: string;
    claims_json: string;
    compact: string;
    compact_sha256: string;
    lifetime_policy: "caller_supplied_unconfirmed";
  };
  execution_boundary: {
    credential_source: "injected_synthetic_fixture";
    credential_retention: "none";
    persistence: "not_implemented";
    transport: "not_implemented";
    response_execution: "not_implemented";
  };
}

export type LiftProofingActionAuthenticationFailureCode =
  | "action_plan_invalid"
  | "signing_key_invalid";

export class LiftProofingActionAuthenticationError extends Error {
  constructor(
    public readonly code: LiftProofingActionAuthenticationFailureCode,
    message: string
  ) {
    super(message);
    this.name = "LiftProofingActionAuthenticationError";
  }
}

const MINIMUM_HS256_KEY_BYTES = 32;
const MAXIMUM_HS256_KEY_BYTES = 4_096;
const HASH = /^[a-f0-9]{64}$/;

function fail(
  code: LiftProofingActionAuthenticationFailureCode,
  message: string
): never {
  throw new LiftProofingActionAuthenticationError(code, message);
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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

function exactHeaderNames(value: unknown) {
  return Array.isArray(value) &&
    value.length === LIFT_PROOFING_ACTION_REQUIRED_HEADER_NAMES.length &&
    value.every(
      (entry, index) =>
        entry === LIFT_PROOFING_ACTION_REQUIRED_HEADER_NAMES[index]
    );
}

function actionMatchesBody(
  action: LiftProofingAction,
  body: LiftProofingDecisionBody
) {
  if (action === "APPROVE") return body.approve === true;
  return body.approve === false && body.rejectReason === action;
}

function validateActionPlan(plan: LiftProofingActionExecutionPlan) {
  if (
    !plainObject(plan) ||
    plan.kind !== "lift_proofing_action" ||
    !plainObject(plan.target) ||
    !plainObject(plan.request) ||
    !plainObject(plan.execution_boundary) ||
    plan.request.method !== "PUT" ||
    !exactHeaderNames(plan.request.required_header_names) ||
    typeof plan.request.canonical_body_json !== "string" ||
    typeof plan.request.canonical_body_sha256 !== "string" ||
    !HASH.test(plan.request.canonical_body_sha256) ||
    plan.execution_boundary.credentials !== "not_accessed" ||
    plan.execution_boundary.persistence !== "not_implemented" ||
    plan.execution_boundary.transport !== "not_implemented" ||
    plan.execution_boundary.response_execution !== "not_implemented" ||
    plan.execution_boundary.automatic_retry !== false
  ) {
    fail("action_plan_invalid", "Lift Proofing action plan is invalid.");
  }

  let normalizedBody: LiftProofingDecisionBody;
  let expectedPath: string;
  try {
    normalizedBody = normalizeLiftProofingDecisionBody(plan.request.body);
    expectedPath = buildLiftProofingDecisionPath(
      plan.target.company_id,
      plan.target.proofing_id
    );
  } catch {
    fail("action_plan_invalid", "Lift Proofing action plan is invalid.");
  }
  const expectedBodyJson = JSON.stringify(stableJsonValue(normalizedBody));
  const expectedBodyHash = createHash("sha256")
    .update(expectedBodyJson)
    .digest("hex");
  if (
    !actionMatchesBody(plan.action, normalizedBody) ||
    plan.request.path !== expectedPath ||
    plan.request.canonical_body_json !== expectedBodyJson ||
    plan.request.canonical_body_sha256 !== expectedBodyHash ||
    JSON.stringify(plan.request.body) !== JSON.stringify(normalizedBody)
  ) {
    fail("action_plan_invalid", "Lift Proofing action plan integrity check failed.");
  }
  return {
    body: normalizedBody,
    path: expectedPath,
    canonical_body_json: expectedBodyJson,
    canonical_body_sha256: expectedBodyHash
  };
}

function signingKeyCopy(value: Uint8Array) {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength < MINIMUM_HS256_KEY_BYTES ||
    value.byteLength > MAXIMUM_HS256_KEY_BYTES
  ) {
    fail("signing_key_invalid", "Injected synthetic Lift Proofing signing key is invalid.");
  }
  return Buffer.from(value);
}

function base64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function buildLiftProofingActionAuthenticationEnvelope(input: {
  plan: LiftProofingActionExecutionPlan;
  synthetic_client_id: string;
  synthetic_signing_key_bytes: Uint8Array;
  iat: number;
  exp: number;
}): LiftProofingActionAuthenticationEnvelope {
  const validatedPlan = validateActionPlan(input.plan);
  const jwt = buildLiftProofingUnsignedJwtContract({
    client_id: input.synthetic_client_id,
    iat: input.iat,
    exp: input.exp
  });
  const headerJson = JSON.stringify(jwt.header);
  const claimsJson = JSON.stringify(jwt.claims);
  const signingInput = `${base64UrlJson(jwt.header)}.${base64UrlJson(jwt.claims)}`;
  const key = signingKeyCopy(input.synthetic_signing_key_bytes);
  let signature: string;
  try {
    signature = createHmac("sha256", key)
      .update(signingInput)
      .digest("base64url");
  } finally {
    key.fill(0);
  }
  const compact = `${signingInput}.${signature}`;

  return {
    kind: "lift_proofing_action_authentication_envelope",
    action: input.plan.action,
    request: {
      method: input.plan.request.method,
      path: validatedPlan.path,
      headers: {
        content_type: {
          name: "Content-Type",
          value: "application/json"
        },
        authorization: {
          name: "Authorization",
          scheme: "Bearer",
          value: `Bearer ${compact}`
        },
        client_id: {
          name: "Lift-ERP-Client-Id",
          value: input.synthetic_client_id.trim()
        }
      },
      body: validatedPlan.body,
      canonical_body_json: validatedPlan.canonical_body_json,
      canonical_body_sha256: validatedPlan.canonical_body_sha256
    },
    jwt: {
      header_json: headerJson,
      claims_json: claimsJson,
      compact,
      compact_sha256: createHash("sha256").update(compact).digest("hex"),
      lifetime_policy: "caller_supplied_unconfirmed"
    },
    execution_boundary: {
      credential_source: "injected_synthetic_fixture",
      credential_retention: "none",
      persistence: "not_implemented",
      transport: "not_implemented",
      response_execution: "not_implemented"
    }
  };
}

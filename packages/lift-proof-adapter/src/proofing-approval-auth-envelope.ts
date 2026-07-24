import { createHash, createHmac } from "node:crypto";
import type { LiftProofingApprovalExecutionPlan } from "./proofing-approval-plan.js";
import {
  buildLiftProofingDecisionPath,
  buildLiftProofingUnsignedJwtContract,
  normalizeLiftProofingDecisionBody,
  type LiftProofingApproveBody
} from "./proofing-decision-contract.js";

export interface LiftProofingApprovalAuthenticationEnvelope {
  kind: "lift_proofing_approval_authentication_envelope";
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
    body: LiftProofingApproveBody;
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
    credential_source: "injected";
    credential_retention: "none";
    transport: "not_implemented";
    persistence: "not_implemented";
    response_execution: "not_implemented";
  };
}

export type LiftProofingApprovalAuthenticationFailureCode =
  | "approval_plan_invalid"
  | "signing_key_invalid";

export class LiftProofingApprovalAuthenticationError extends Error {
  constructor(
    public readonly code: LiftProofingApprovalAuthenticationFailureCode,
    message: string
  ) {
    super(message);
    this.name = "LiftProofingApprovalAuthenticationError";
  }
}

const MINIMUM_HS256_KEY_BYTES = 32;
const MAXIMUM_HS256_KEY_BYTES = 4_096;
const HASH = /^[a-f0-9]{64}$/;
const REQUIRED_HEADER_NAMES = [
  "Content-Type",
  "Authorization",
  "Lift-ERP-Client-Id"
] as const;

function fail(code: LiftProofingApprovalAuthenticationFailureCode, message: string): never {
  throw new LiftProofingApprovalAuthenticationError(code, message);
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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

function exactHeaderNames(value: unknown): value is typeof REQUIRED_HEADER_NAMES {
  return Array.isArray(value) &&
    value.length === REQUIRED_HEADER_NAMES.length &&
    value.every((entry, index) => entry === REQUIRED_HEADER_NAMES[index]);
}

function validateApprovalPlan(plan: LiftProofingApprovalExecutionPlan) {
  if (
    !plainObject(plan) ||
    plan.kind !== "lift_proofing_approval" ||
    !plainObject(plan.target) ||
    !plainObject(plan.request) ||
    !plainObject(plan.execution_boundary) ||
    plan.request.method !== "PUT" ||
    !exactHeaderNames(plan.request.required_header_names) ||
    typeof plan.request.canonical_body_json !== "string" ||
    typeof plan.request.canonical_body_sha256 !== "string" ||
    !HASH.test(plan.request.canonical_body_sha256) ||
    plan.execution_boundary.credentials !== "not_accessed" ||
    plan.execution_boundary.transport !== "not_implemented" ||
    plan.execution_boundary.response_execution !== "not_implemented"
  ) {
    fail("approval_plan_invalid", "Lift Proofing approval plan is invalid.");
  }

  let normalizedBody: ReturnType<typeof normalizeLiftProofingDecisionBody>;
  try {
    normalizedBody = normalizeLiftProofingDecisionBody(plan.request.body);
  } catch {
    fail("approval_plan_invalid", "Lift Proofing approval plan is invalid.");
  }
  if (!normalizedBody.approve) {
    fail("approval_plan_invalid", "Lift Proofing approval plan must contain an approval body.");
  }

  let expectedPath: string;
  try {
    expectedPath = buildLiftProofingDecisionPath(
      plan.target.company_id,
      plan.target.proofing_id
    );
  } catch {
    fail("approval_plan_invalid", "Lift Proofing approval plan is invalid.");
  }
  const expectedBodyJson = JSON.stringify(stableJsonValue(normalizedBody));
  const expectedBodyHash = createHash("sha256").update(expectedBodyJson).digest("hex");
  if (
    plan.request.path !== expectedPath ||
    plan.request.canonical_body_json !== expectedBodyJson ||
    plan.request.canonical_body_sha256 !== expectedBodyHash ||
    JSON.stringify(plan.request.body) !== JSON.stringify(normalizedBody)
  ) {
    fail("approval_plan_invalid", "Lift Proofing approval plan integrity check failed.");
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
    fail("signing_key_invalid", "Injected Lift Proofing signing key is invalid.");
  }
  return Buffer.from(value);
}

function base64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function buildLiftProofingApprovalAuthenticationEnvelope(input: {
  plan: LiftProofingApprovalExecutionPlan;
  client_id: string;
  signing_key_bytes: Uint8Array;
  iat: number;
  exp: number;
}): LiftProofingApprovalAuthenticationEnvelope {
  const validatedPlan = validateApprovalPlan(input.plan);
  const jwt = buildLiftProofingUnsignedJwtContract({
    client_id: input.client_id,
    iat: input.iat,
    exp: input.exp
  });
  const headerJson = JSON.stringify(jwt.header);
  const claimsJson = JSON.stringify(jwt.claims);
  const signingInput = `${base64UrlJson(jwt.header)}.${base64UrlJson(jwt.claims)}`;
  const key = signingKeyCopy(input.signing_key_bytes);
  let signature: string;
  try {
    signature = createHmac("sha256", key).update(signingInput).digest("base64url");
  } finally {
    key.fill(0);
  }
  const compact = `${signingInput}.${signature}`;

  return {
    kind: "lift_proofing_approval_authentication_envelope",
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
          value: jwt.claims.iss.slice(`${jwt.claims.aud}/`.length)
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
      credential_source: "injected",
      credential_retention: "none",
      transport: "not_implemented",
      persistence: "not_implemented",
      response_execution: "not_implemented"
    }
  };
}

import { createHash, createHmac } from "node:crypto";
import { isIP } from "node:net";
import {
  buildLiftProofingDecisionPath,
  buildLiftProofingUnsignedJwtContract,
  classifyLiftProofingDecisionResponse,
  normalizeLiftProofingDecisionBody,
  type LiftProofingDecisionBody,
  type LiftProofingDecisionResponseClassification
} from "./proofing-decision-contract.js";
import {
  LIFT_PROOFING_ACTION_USER_NAME,
  type LiftProofingAction
} from "./proofing-action-plan.js";

export type { LiftProofingAction } from "./proofing-action-plan.js";

export interface LiftProofingRuntimeRequest {
  action: LiftProofingAction;
  company_id: string;
  proofing_id: string;
  comment: string | null;
  revised_art_url: string | null;
  approve_quantity?: number | null;
}

export interface LiftProofingRuntimePlan {
  action: LiftProofingAction;
  method: "PUT";
  path: string;
  body: LiftProofingDecisionBody;
  canonical_body_json: string;
  canonical_body_sha256: string;
}

export interface LiftProofingRuntimeObservation {
  status: number | null;
  classification: LiftProofingDecisionResponseClassification;
  transport_error: boolean;
}

export class LiftProofingActionRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiftProofingActionRuntimeError";
  }
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function boundedIdentifier(value: string, label: string) {
  const normalized = value.trim();
  if (!IDENTIFIER.test(normalized)) {
    throw new LiftProofingActionRuntimeError(`${label} is invalid.`);
  }
  return normalized;
}

function boundedComment(value: string | null) {
  if (value === null) return null;
  const normalized = value.trim();
  if (normalized.length > 2_000 || CONTROL_CHARACTERS.test(normalized)) {
    throw new LiftProofingActionRuntimeError("Lift Proofing action comment is invalid.");
  }
  return normalized || null;
}

function approveQuantity(action: LiftProofingAction, value: number | null) {
  if (action !== "APPROVE") {
    if (value !== null) {
      throw new LiftProofingActionRuntimeError(
        "Approval quantity is only valid for an approval action."
      );
    }
    return null;
  }
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new LiftProofingActionRuntimeError(
      "Lift Proofing approval quantity must be a positive whole number."
    );
  }
  return value;
}

function safeHttpsUrl(value: string | null) {
  if (!value) {
    throw new LiftProofingActionRuntimeError("A safe revised-art HTTPS URL is required.");
  }
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      !host.includes(".") ||
      host === "localhost" ||
      host.endsWith(".localhost") ||
      isIP(host) !== 0
    ) {
      throw new Error("unsafe");
    }
    return url.toString();
  } catch {
    throw new LiftProofingActionRuntimeError("A safe revised-art HTTPS URL is required.");
  }
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableJsonValue(entry)])
    );
  }
  return value;
}

export function buildLiftProofingRuntimePlan(
  input: LiftProofingRuntimeRequest
): LiftProofingRuntimePlan {
  const companyId = boundedIdentifier(input.company_id, "Lift company ID");
  const proofingId = boundedIdentifier(input.proofing_id, "Lift proofing ID");
  const comment = boundedComment(input.comment);
  if (input.action === "SEND_BACK_TO_ARTIST" && !comment) {
    throw new LiftProofingActionRuntimeError(
      "Send back to artist requires instructions for the prepress team."
    );
  }
  const requestedApproveQuantity = approveQuantity(
    input.action,
    input.approve_quantity ?? null
  );
  const common = {
    userName: LIFT_PROOFING_ACTION_USER_NAME,
    ...(comment ? { comment } : {})
  };
  const body = normalizeLiftProofingDecisionBody(
    input.action === "APPROVE"
      ? {
          approve: true,
          ...(requestedApproveQuantity === null
            ? {}
            : { approveQuantity: requestedApproveQuantity }),
          ...common
        }
      : input.action === "REVISED_ART_WILL_BE_SENT"
        ? {
            approve: false,
            rejectReason: input.action,
            artUrl: safeHttpsUrl(input.revised_art_url),
            upload: true,
            ...common
          }
        : {
            approve: false,
            rejectReason: input.action,
            ...common
          }
  );
  const canonicalBodyJson = JSON.stringify(stableJsonValue(body));
  return {
    action: input.action,
    method: "PUT",
    path: buildLiftProofingDecisionPath(companyId, proofingId),
    body,
    canonical_body_json: canonicalBodyJson,
    canonical_body_sha256: createHash("sha256")
      .update(canonicalBodyJson)
      .digest("hex")
  };
}

export function buildLiftProofingRuntimeHeaders(input: {
  plan: LiftProofingRuntimePlan;
  client_id: string;
  client_secret: string;
  issued_at_epoch: number;
  expires_at_epoch: number;
}) {
  const clientId = boundedIdentifier(input.client_id, "Lift Proofing API client ID");
  if (
    typeof input.client_secret !== "string" ||
    input.client_secret.length < 32 ||
    input.client_secret.length > 4_096
  ) {
    throw new LiftProofingActionRuntimeError("Lift Proofing API signing secret is invalid.");
  }
  const jwt = buildLiftProofingUnsignedJwtContract({
    client_id: clientId,
    iat: input.issued_at_epoch,
    exp: input.expires_at_epoch
  });
  const encodedHeader = Buffer.from(JSON.stringify(jwt.header)).toString("base64url");
  const encodedClaims = Buffer.from(JSON.stringify(jwt.claims)).toString("base64url");
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const key = Buffer.from(input.client_secret, "utf8");
  let signature: string;
  try {
    signature = createHmac("sha256", key).update(signingInput).digest("base64url");
  } finally {
    key.fill(0);
  }
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${signingInput}.${signature}`,
    "Lift-ERP-Client-Id": clientId
  } as const;
}

function joinedRequestUrl(baseUrl: string, path: string) {
  const base = new URL(baseUrl);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) {
    throw new LiftProofingActionRuntimeError("Lift Proofing API base URL is invalid.");
  }
  const url = new URL(`${base.toString().replace(/\/+$/, "")}${path}`);
  if (url.origin !== base.origin) {
    throw new LiftProofingActionRuntimeError("Lift Proofing request URL escaped its configured origin.");
  }
  return url.toString();
}

export async function sendLiftProofingRuntimeAction(input: {
  base_url: string;
  plan: LiftProofingRuntimePlan;
  headers: ReturnType<typeof buildLiftProofingRuntimeHeaders>;
  timeout_ms: number;
  fetcher?: typeof fetch;
}): Promise<LiftProofingRuntimeObservation> {
  const fetcher = input.fetcher ?? fetch;
  try {
    const response = await fetcher(joinedRequestUrl(input.base_url, input.plan.path), {
      method: "PUT",
      headers: input.headers,
      body: input.plan.canonical_body_json,
      redirect: "error",
      signal: AbortSignal.timeout(input.timeout_ms)
    });
    return {
      status: response.status,
      classification: classifyLiftProofingDecisionResponse({ status: response.status }),
      transport_error: false
    };
  } catch {
    return {
      status: null,
      classification: classifyLiftProofingDecisionResponse({}),
      transport_error: true
    };
  }
}

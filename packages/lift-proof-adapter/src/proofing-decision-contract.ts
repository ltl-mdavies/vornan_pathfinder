export const LIFT_PROOFING_DECISION_METHOD = "PUT" as const;
export const LIFT_PROOFING_DECISION_PATH_TEMPLATE =
  "/order-management/companies/{company_id}/proofing/{proofing_id}" as const;

export const LIFT_PROOFING_DECISION_HEADER_REQUIREMENTS = Object.freeze({
  content_type: Object.freeze({
    name: "Content-Type",
    value: "application/json"
  }),
  authorization: Object.freeze({
    name: "Authorization",
    scheme: "Bearer"
  }),
  client_id: Object.freeze({
    name: "Lift-ERP-Client-Id"
  })
});

export const LIFT_PROOFING_JWT_HEADER = Object.freeze({
  alg: "HS256",
  typ: "JWT"
} as const);
export const LIFT_PROOFING_JWT_AUDIENCE = "https://www.lifterp.com" as const;

export const LIFT_PROOFING_REJECT_REASONS = [
  "REJECT",
  "SEND_BACK_TO_ARTIST",
  "CANCEL_LINE",
  "REVISED_ART_WILL_BE_SENT"
] as const;

export type LiftProofingRejectReason = (typeof LIFT_PROOFING_REJECT_REASONS)[number];

export interface LiftProofingApproveBody {
  approve: true;
  userName: string;
  approveQuantity?: number;
  comment?: string;
}

export interface LiftProofingRejectBody {
  approve: false;
  userName: string;
  rejectReason: LiftProofingRejectReason;
  comment?: string;
  artUrl?: string;
  upload?: boolean;
}

export type LiftProofingDecisionBody = LiftProofingApproveBody | LiftProofingRejectBody;

export interface LiftProofingUnsignedJwtContract {
  header: typeof LIFT_PROOFING_JWT_HEADER;
  claims: {
    iss: string;
    aud: typeof LIFT_PROOFING_JWT_AUDIENCE;
    iat: number;
    exp: number;
  };
  serialization: "not_implemented";
  signing: "not_implemented";
}

export interface LiftProofingDecisionRequestContract {
  method: typeof LIFT_PROOFING_DECISION_METHOD;
  path: string;
  required_headers: typeof LIFT_PROOFING_DECISION_HEADER_REQUIREMENTS;
  body: LiftProofingDecisionBody;
  response_contract: "unconfirmed";
}

export interface LiftProofingDecisionResponseObservation {
  status?: number;
  content_type?: string | null;
  body?: unknown;
}

export interface LiftProofingDecisionResponseClassification {
  classification:
    | "success_observed_unconfirmed"
    | "request_rejected_unconfirmed"
    | "ambiguous"
    | "unexpected_or_unclassified";
  confirmed: false;
  retryable: false;
  reconciliation: "read_after_write_required" | "manual_review_required";
  reason:
    | "authoritative_read_after_write_required"
    | "authoritative_error_contract_required"
    | "retry_safety_unconfirmed"
    | "redirect_not_supported"
    | "provisional_response_not_supported"
    | "response_status_invalid_or_missing";
}

export type LiftProofingDecisionContractFailureCode =
  | "identifier_invalid"
  | "jwt_time_invalid"
  | "body_invalid"
  | "user_name_invalid"
  | "comment_invalid"
  | "approve_quantity_invalid"
  | "reject_reason_invalid"
  | "revised_art_url_required"
  | "revised_art_fields_invalid";

export class LiftProofingDecisionContractError extends Error {
  constructor(
    public readonly code: LiftProofingDecisionContractFailureCode,
    message: string
  ) {
    super(message);
    this.name = "LiftProofingDecisionContractError";
  }
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const APPROVE_KEYS = new Set(["approve", "approveQuantity", "comment", "userName"]);
const REJECT_KEYS = new Set(["approve", "artUrl", "comment", "rejectReason", "upload", "userName"]);
const REJECT_REASONS = new Set<string>(LIFT_PROOFING_REJECT_REASONS);

function fail(code: LiftProofingDecisionContractFailureCode, message: string): never {
  throw new LiftProofingDecisionContractError(code, message);
}

function boundedIdentifier(value: unknown, label: string) {
  if (typeof value !== "string") {
    fail("identifier_invalid", `${label} is invalid.`);
  }
  const normalized = value.trim();
  if (!IDENTIFIER.test(normalized)) {
    fail("identifier_invalid", `${label} is invalid.`);
  }
  return normalized;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(input: Record<string, unknown>, allowed: ReadonlySet<string>) {
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    fail("body_invalid", "Lift Proofing decision body contains an unsupported field.");
  }
}

function boundedText(
  value: unknown,
  options: {
    code: "user_name_invalid" | "comment_invalid";
    label: string;
    maximum: number;
    optional?: boolean;
  }
) {
  if (value === undefined && options.optional) {
    return undefined;
  }
  if (typeof value !== "string") {
    fail(options.code, `${options.label} is invalid.`);
  }
  const normalized = value.trim();
  if (
    (!normalized && !options.optional) ||
    normalized.length > options.maximum ||
    CONTROL_CHARACTERS.test(normalized)
  ) {
    fail(options.code, `${options.label} is invalid.`);
  }
  return normalized || undefined;
}

function revisedArtUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.length > 2_048) {
    fail("revised_art_url_required", "A safe revised-art URL is required.");
  }
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash
    ) {
      fail("revised_art_url_required", "A safe revised-art URL is required.");
    }
    return url.toString();
  } catch (error) {
    if (error instanceof LiftProofingDecisionContractError) {
      throw error;
    }
    fail("revised_art_url_required", "A safe revised-art URL is required.");
  }
}

export function buildLiftProofingDecisionPath(companyId: string, proofingId: string) {
  const company = boundedIdentifier(companyId, "Lift company ID");
  const proofing = boundedIdentifier(proofingId, "Lift proofing ID");
  return `/order-management/companies/${encodeURIComponent(company)}/proofing/${encodeURIComponent(proofing)}`;
}

export function buildLiftProofingUnsignedJwtContract(input: {
  client_id: string;
  iat: number;
  exp: number;
}): LiftProofingUnsignedJwtContract {
  const clientId = boundedIdentifier(input.client_id, "Lift Proofing client ID");
  if (
    !Number.isSafeInteger(input.iat) ||
    input.iat < 0 ||
    !Number.isSafeInteger(input.exp) ||
    input.exp <= input.iat
  ) {
    fail("jwt_time_invalid", "Lift Proofing JWT timestamps are invalid.");
  }
  return {
    header: LIFT_PROOFING_JWT_HEADER,
    claims: {
      iss: `${LIFT_PROOFING_JWT_AUDIENCE}/${clientId}`,
      aud: LIFT_PROOFING_JWT_AUDIENCE,
      iat: input.iat,
      exp: input.exp
    },
    serialization: "not_implemented",
    signing: "not_implemented"
  };
}

export function normalizeLiftProofingDecisionBody(input: unknown): LiftProofingDecisionBody {
  if (!plainObject(input) || typeof input.approve !== "boolean") {
    fail("body_invalid", "Lift Proofing decision body is invalid.");
  }

  const userName = boundedText(input.userName, {
    code: "user_name_invalid",
    label: "Lift Proofing user name",
    maximum: 256
  }) as string;
  const comment = boundedText(input.comment, {
    code: "comment_invalid",
    label: "Lift Proofing comment",
    maximum: 2_000,
    optional: true
  });

  if (input.approve) {
    exactKeys(input, APPROVE_KEYS);
    if (
      input.approveQuantity !== undefined &&
      (
        typeof input.approveQuantity !== "number" ||
        !Number.isFinite(input.approveQuantity) ||
        input.approveQuantity <= 0
      )
    ) {
      fail("approve_quantity_invalid", "Lift Proofing approval quantity is invalid.");
    }
    return {
      approve: true,
      userName,
      ...(input.approveQuantity === undefined ? {} : { approveQuantity: input.approveQuantity }),
      ...(comment === undefined ? {} : { comment })
    };
  }

  exactKeys(input, REJECT_KEYS);
  if (typeof input.rejectReason !== "string" || !REJECT_REASONS.has(input.rejectReason)) {
    fail("reject_reason_invalid", "Lift Proofing rejection reason is invalid.");
  }
  const rejectReason = input.rejectReason as LiftProofingRejectReason;
  if (input.upload !== undefined && typeof input.upload !== "boolean") {
    fail("revised_art_fields_invalid", "Lift Proofing revised-art fields are invalid.");
  }

  if (rejectReason === "REVISED_ART_WILL_BE_SENT") {
    const artUrl = revisedArtUrl(input.artUrl);
    return {
      approve: false,
      userName,
      rejectReason,
      artUrl,
      ...(input.upload === undefined ? {} : { upload: input.upload }),
      ...(comment === undefined ? {} : { comment })
    };
  }

  if (input.artUrl !== undefined || input.upload !== undefined) {
    fail(
      "revised_art_fields_invalid",
      "Lift Proofing revised-art fields require the revised-art rejection reason."
    );
  }
  return {
    approve: false,
    userName,
    rejectReason,
    ...(comment === undefined ? {} : { comment })
  };
}

export function buildLiftProofingDecisionRequestContract(input: {
  company_id: string;
  proofing_id: string;
  body: unknown;
}): LiftProofingDecisionRequestContract {
  return {
    method: LIFT_PROOFING_DECISION_METHOD,
    path: buildLiftProofingDecisionPath(input.company_id, input.proofing_id),
    required_headers: LIFT_PROOFING_DECISION_HEADER_REQUIREMENTS,
    body: normalizeLiftProofingDecisionBody(input.body),
    response_contract: "unconfirmed"
  };
}

export function classifyLiftProofingDecisionResponse(
  observation: LiftProofingDecisionResponseObservation
): LiftProofingDecisionResponseClassification {
  if (
    !Number.isSafeInteger(observation.status) ||
    Number(observation.status) < 100 ||
    Number(observation.status) > 599
  ) {
    return {
      classification: "unexpected_or_unclassified",
      confirmed: false,
      retryable: false,
      reconciliation: "manual_review_required",
      reason: "response_status_invalid_or_missing"
    };
  }
  const status = Number(observation.status);
  if (status >= 200 && status <= 299) {
    return {
      classification: "success_observed_unconfirmed",
      confirmed: false,
      retryable: false,
      reconciliation: "read_after_write_required",
      reason: "authoritative_read_after_write_required"
    };
  }
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return {
      classification: "ambiguous",
      confirmed: false,
      retryable: false,
      reconciliation: "manual_review_required",
      reason: "retry_safety_unconfirmed"
    };
  }
  if (status >= 400 && status <= 499) {
    return {
      classification: "request_rejected_unconfirmed",
      confirmed: false,
      retryable: false,
      reconciliation: "manual_review_required",
      reason: "authoritative_error_contract_required"
    };
  }
  if (status >= 300 && status <= 399) {
    return {
      classification: "unexpected_or_unclassified",
      confirmed: false,
      retryable: false,
      reconciliation: "manual_review_required",
      reason: "redirect_not_supported"
    };
  }
  return {
    classification: "unexpected_or_unclassified",
    confirmed: false,
    retryable: false,
    reconciliation: "manual_review_required",
    reason: "provisional_response_not_supported"
  };
}

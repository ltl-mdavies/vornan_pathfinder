export type InspectionPriority = "normal" | "high";
export type InspectionWorkflow = "catalog" | "proof_shadow";

export type InspectionStatus =
  | "queued"
  | "running"
  | "reconciling"
  | "completed"
  | "failed"
  | "unavailable"
  | "cancelled";

export type InspectionVerdict = "pass" | "warn" | "fail" | "indeterminate";

export interface InspectionProviderDescriptor {
  readonly provider_key: string;
  readonly display_name: string;
  readonly adapter_version: string;
  readonly engine_versions: readonly string[];
  readonly capabilities: {
    readonly accepted_content_types: readonly string[];
    readonly maximum_bytes: number;
    readonly maximum_pages: number | null;
    readonly supports_async: boolean;
    readonly supports_webhooks: boolean;
    readonly supports_polling: boolean;
    readonly supports_cancellation: boolean;
    readonly supports_multi_page: boolean;
    readonly priorities: readonly InspectionPriority[];
  };
}

export interface InspectionRequest {
  readonly inspection_id: string;
  readonly idempotency_key: string;
  readonly customer_scope: {
    readonly customer_id: string;
    readonly catalog_id: string;
    readonly catalog_product_id: string;
    readonly workflow: InspectionWorkflow;
  };
  readonly priority: InspectionPriority;
  readonly asset: {
    readonly artwork_asset_id: string;
    readonly artwork_version_id: string;
    readonly object_version_id: string;
    readonly sha256: string;
    readonly content_type: string;
    readonly content_length: number;
    readonly page_count: number | null;
  };
  readonly specification: {
    readonly specification_revision_id: string;
    readonly width: number;
    readonly height: number;
    readonly units: "in" | "mm" | "cm";
    readonly artwork_scale: {
      readonly numerator: number;
      readonly denominator: number;
    };
    readonly target_dpi: number;
    readonly bleed?: {
      readonly top: number;
      readonly right: number;
      readonly bottom: number;
      readonly left: number;
    };
  };
  readonly policy_revision_id: string;
  readonly requested_engine_revision: string | null;
}

export interface ExpectedInspectionBinding {
  readonly inspection_id: string;
  readonly idempotency_key: string;
  readonly customer_id: string;
  readonly catalog_id: string;
  readonly catalog_product_id: string;
  readonly artwork_asset_id: string;
  readonly artwork_version_id: string;
  readonly object_version_id: string;
  readonly sha256: string;
  readonly specification_revision_id: string;
  readonly policy_revision_id: string;
}

export interface TransientAssetAccess {
  readonly url: string;
  readonly expires_at: string;
}

export interface InspectionCallContext {
  readonly correlation_id: string;
  readonly deadline_at: string;
  readonly acquire_asset_access: () => Promise<TransientAssetAccess>;
  readonly acquire_credentials: () => Promise<Readonly<Record<string, string>>>;
}

export interface ProviderInspectionReference {
  readonly inspection_id: string;
  readonly provider_key: string;
  readonly provider_reference: string;
  readonly idempotency_key: string;
}

export interface InspectionSubmission {
  readonly status: "accepted" | "running" | "completed" | "rejected";
  readonly provider_reference: string | null;
  readonly observation: InspectionObservation | null;
  readonly accepted_at: string | null;
}

export interface NormalizedInspectionMetric {
  readonly key: string;
  readonly value: number | string | boolean;
  readonly unit: string | null;
  readonly page: number | null;
}

export interface NormalizedInspectionFinding {
  readonly code: string;
  readonly severity: "info" | "warning" | "error";
  readonly message_key: string;
  readonly page: number | null;
  readonly region: Readonly<Record<string, number>> | null;
}

export type InspectionErrorCategory =
  | "provider_disabled"
  | "provider_unavailable"
  | "rate_limited"
  | "input_rejected"
  | "unsupported_content"
  | "timeout"
  | "submission_uncertain"
  | "authentication_failed"
  | "provider_error"
  | "normalization_failed"
  | "cancelled";

export interface InspectionError {
  readonly category: InspectionErrorCategory;
  readonly reason_code: string;
  readonly retry_disposition: "never" | "bounded" | "reconcile";
  readonly correlation_id: string;
  readonly occurred_at: string;
}

export interface InspectionObservation {
  readonly inspection_id: string;
  readonly status: InspectionStatus;
  readonly verdict: InspectionVerdict | null;
  readonly provider_reference: string | null;
  readonly provider_key: string;
  readonly adapter_version: string;
  readonly engine_revision: string | null;
  readonly policy_revision_id: string;
  readonly metrics: readonly NormalizedInspectionMetric[];
  readonly findings: readonly NormalizedInspectionFinding[];
  readonly native_report: {
    readonly private_report_ref: string;
    readonly sha256: string;
    readonly schema_version: string;
  } | null;
  readonly submitted_at: string | null;
  readonly started_at: string | null;
  readonly completed_at: string | null;
  readonly error: InspectionError | null;
}

export interface VerifiedProviderWebhook {
  readonly provider_key: string;
  readonly provider_reference: string;
  readonly received_at: string;
  readonly payload: unknown;
}

export interface ArtworkInspectionProvider {
  descriptor(): Promise<InspectionProviderDescriptor>;
  submit(request: InspectionRequest, context: InspectionCallContext): Promise<InspectionSubmission>;
  reconcile(
    reference: ProviderInspectionReference,
    context: InspectionCallContext
  ): Promise<InspectionObservation>;
  cancel?(
    reference: ProviderInspectionReference,
    context: InspectionCallContext
  ): Promise<InspectionObservation>;
  normalizeWebhook?(input: VerifiedProviderWebhook): Promise<InspectionObservation>;
}

export interface SafeInspectionSummary {
  readonly inspection_id: string;
  readonly status: InspectionStatus;
  readonly verdict: InspectionVerdict | null;
  readonly engine_revision: string | null;
  readonly metrics: readonly NormalizedInspectionMetric[];
  readonly findings: readonly NormalizedInspectionFinding[];
  readonly has_native_report: boolean;
  readonly completed_at: string | null;
  readonly error_category: InspectionErrorCategory | null;
  readonly error_reason_code: string | null;
}

export type ArtworkInspectionContractErrorCode =
  | "invalid_value"
  | "unsupported_capability"
  | "binding_mismatch"
  | "invalid_observation"
  | "invalid_transition";

export class ArtworkInspectionContractError extends Error {
  constructor(
    readonly code: ArtworkInspectionContractErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ArtworkInspectionContractError";
  }
}

export interface InspectionIdempotencyIdentity {
  readonly inspection_id: string;
  readonly artwork_sha256: string;
  readonly specification_revision_id: string;
  readonly policy_revision_id: string;
  readonly provider_key: string;
  readonly adapter_version: string;
  readonly engine_revision: string | null;
}

const TERMINAL_STATUSES = new Set<InspectionStatus>([
  "completed",
  "failed",
  "unavailable",
  "cancelled"
]);

const STATUS_TRANSITIONS: Readonly<Record<InspectionStatus, readonly InspectionStatus[]>> = {
  queued: ["queued", "running", "reconciling", "completed", "failed", "unavailable", "cancelled"],
  running: ["running", "reconciling", "completed", "failed", "unavailable", "cancelled"],
  reconciling: ["reconciling", "running", "completed", "failed", "unavailable", "cancelled"],
  completed: [],
  failed: [],
  unavailable: [],
  cancelled: []
};

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 256) {
    throw new ArtworkInspectionContractError("invalid_value", `${label} must be non-empty and bounded`);
  }
  return normalized;
}

function requirePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ArtworkInspectionContractError("invalid_value", `${label} must be positive`);
  }
  return value;
}

function requireNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new ArtworkInspectionContractError("invalid_value", `${label} must be non-negative`);
  }
  return value;
}

function requireTimestamp(value: string, label: string): string {
  if (!value || Number.isNaN(Date.parse(value))) {
    throw new ArtworkInspectionContractError("invalid_value", `${label} must be an ISO timestamp`);
  }
  return value;
}

function requireSha256(value: string, label: string): string {
  const normalized = value.toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new ArtworkInspectionContractError("invalid_value", `${label} must be a SHA-256 hex digest`);
  }
  return normalized;
}

function freezeArray<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values]);
}

function freezeObservation(observation: InspectionObservation): InspectionObservation {
  return Object.freeze({
    ...observation,
    metrics: freezeArray(observation.metrics.map((metric) => Object.freeze({ ...metric }))),
    findings: freezeArray(
      observation.findings.map((finding) =>
        Object.freeze({
          ...finding,
          region: finding.region === null ? null : Object.freeze({ ...finding.region })
        })
      )
    ),
    native_report:
      observation.native_report === null ? null : Object.freeze({ ...observation.native_report }),
    error: observation.error === null ? null : Object.freeze({ ...observation.error })
  });
}

export function buildInspectionIdempotencyMaterial(identity: InspectionIdempotencyIdentity): string {
  const values = [
    requireText(identity.inspection_id, "inspection_id"),
    requireSha256(identity.artwork_sha256, "artwork_sha256"),
    requireText(identity.specification_revision_id, "specification_revision_id"),
    requireText(identity.policy_revision_id, "policy_revision_id"),
    requireText(identity.provider_key, "provider_key"),
    requireText(identity.adapter_version, "adapter_version"),
    identity.engine_revision === null ? "none" : requireText(identity.engine_revision, "engine_revision")
  ];
  return `artwork-inspection:v1:${values.map((value) => encodeURIComponent(value)).join("|")}`;
}

export function validateInspectionRequest(
  request: InspectionRequest,
  descriptor?: InspectionProviderDescriptor
): InspectionRequest {
  const pageCount = request.asset.page_count;
  if (pageCount !== null && (!Number.isInteger(pageCount) || pageCount <= 0)) {
    throw new ArtworkInspectionContractError("invalid_value", "asset.page_count must be a positive integer");
  }
  const bleed = request.specification.bleed
    ? Object.freeze({
        top: requireNonNegative(request.specification.bleed.top, "bleed.top"),
        right: requireNonNegative(request.specification.bleed.right, "bleed.right"),
        bottom: requireNonNegative(request.specification.bleed.bottom, "bleed.bottom"),
        left: requireNonNegative(request.specification.bleed.left, "bleed.left")
      })
    : undefined;

  const validated: InspectionRequest = Object.freeze({
    inspection_id: requireText(request.inspection_id, "inspection_id"),
    idempotency_key: requireText(request.idempotency_key, "idempotency_key"),
    customer_scope: Object.freeze({
      customer_id: requireText(request.customer_scope.customer_id, "customer_id"),
      catalog_id: requireText(request.customer_scope.catalog_id, "catalog_id"),
      catalog_product_id: requireText(request.customer_scope.catalog_product_id, "catalog_product_id"),
      workflow: request.customer_scope.workflow
    }),
    priority: request.priority,
    asset: Object.freeze({
      artwork_asset_id: requireText(request.asset.artwork_asset_id, "artwork_asset_id"),
      artwork_version_id: requireText(request.asset.artwork_version_id, "artwork_version_id"),
      object_version_id: requireText(request.asset.object_version_id, "object_version_id"),
      sha256: requireSha256(request.asset.sha256, "asset.sha256"),
      content_type: requireText(request.asset.content_type, "content_type").toLowerCase(),
      content_length: requirePositive(request.asset.content_length, "content_length"),
      page_count: pageCount
    }),
    specification: Object.freeze({
      specification_revision_id: requireText(
        request.specification.specification_revision_id,
        "specification_revision_id"
      ),
      width: requirePositive(request.specification.width, "width"),
      height: requirePositive(request.specification.height, "height"),
      units: request.specification.units,
      artwork_scale: Object.freeze({
        numerator: requirePositive(request.specification.artwork_scale.numerator, "scale.numerator"),
        denominator: requirePositive(request.specification.artwork_scale.denominator, "scale.denominator")
      }),
      target_dpi: requirePositive(request.specification.target_dpi, "target_dpi"),
      ...(bleed ? { bleed } : {})
    }),
    policy_revision_id: requireText(request.policy_revision_id, "policy_revision_id"),
    requested_engine_revision:
      request.requested_engine_revision === null
        ? null
        : requireText(request.requested_engine_revision, "requested_engine_revision")
  });

  if (!(["catalog", "proof_shadow"] as const).includes(validated.customer_scope.workflow)) {
    throw new ArtworkInspectionContractError("invalid_value", "workflow is unsupported");
  }
  if (!(["normal", "high"] as const).includes(validated.priority)) {
    throw new ArtworkInspectionContractError("invalid_value", "priority is unsupported");
  }
  if (!(["in", "mm", "cm"] as const).includes(validated.specification.units)) {
    throw new ArtworkInspectionContractError("invalid_value", "units are unsupported");
  }

  if (descriptor) {
    assertProviderSupportsRequest(descriptor, validated);
  }
  return validated;
}

export function assertProviderSupportsRequest(
  descriptor: InspectionProviderDescriptor,
  request: InspectionRequest
): void {
  if (!descriptor.capabilities.accepted_content_types.includes(request.asset.content_type)) {
    throw new ArtworkInspectionContractError("unsupported_capability", "content type is not supported");
  }
  if (request.asset.content_length > descriptor.capabilities.maximum_bytes) {
    throw new ArtworkInspectionContractError("unsupported_capability", "content length exceeds provider capability");
  }
  if (!descriptor.capabilities.priorities.includes(request.priority)) {
    throw new ArtworkInspectionContractError("unsupported_capability", "priority is not supported");
  }
  if (
    request.asset.page_count !== null &&
    descriptor.capabilities.maximum_pages !== null &&
    request.asset.page_count > descriptor.capabilities.maximum_pages
  ) {
    throw new ArtworkInspectionContractError("unsupported_capability", "page count exceeds provider capability");
  }
  if (request.asset.page_count !== null && request.asset.page_count > 1 && !descriptor.capabilities.supports_multi_page) {
    throw new ArtworkInspectionContractError("unsupported_capability", "multi-page input is not supported");
  }
  if (
    request.requested_engine_revision !== null &&
    !descriptor.engine_versions.includes(request.requested_engine_revision)
  ) {
    throw new ArtworkInspectionContractError("unsupported_capability", "engine revision is not supported");
  }
}

export function assertInspectionRequestMatches(
  request: InspectionRequest,
  expected: ExpectedInspectionBinding
): void {
  const comparisons: ReadonlyArray<readonly [string, string, string]> = [
    ["inspection_id", request.inspection_id, expected.inspection_id],
    ["idempotency_key", request.idempotency_key, expected.idempotency_key],
    ["customer_id", request.customer_scope.customer_id, expected.customer_id],
    ["catalog_id", request.customer_scope.catalog_id, expected.catalog_id],
    ["catalog_product_id", request.customer_scope.catalog_product_id, expected.catalog_product_id],
    ["artwork_asset_id", request.asset.artwork_asset_id, expected.artwork_asset_id],
    ["artwork_version_id", request.asset.artwork_version_id, expected.artwork_version_id],
    ["object_version_id", request.asset.object_version_id, expected.object_version_id],
    ["sha256", request.asset.sha256, expected.sha256.toLowerCase()],
    [
      "specification_revision_id",
      request.specification.specification_revision_id,
      expected.specification_revision_id
    ],
    ["policy_revision_id", request.policy_revision_id, expected.policy_revision_id]
  ];
  const mismatch = comparisons.find(([, actual, wanted]) => actual !== wanted);
  if (mismatch) {
    throw new ArtworkInspectionContractError(
      "binding_mismatch",
      `${mismatch[0]} does not match the authorized inspection binding`
    );
  }
}

export function validateInspectionObservation(observation: InspectionObservation): InspectionObservation {
  requireText(observation.inspection_id, "inspection_id");
  requireText(observation.provider_key, "provider_key");
  requireText(observation.adapter_version, "adapter_version");
  requireText(observation.policy_revision_id, "policy_revision_id");
  if (observation.engine_revision !== null) {
    requireText(observation.engine_revision, "engine_revision");
  }
  if (observation.provider_reference !== null) {
    requireText(observation.provider_reference, "provider_reference");
  }

  if (observation.status === "completed" && observation.verdict === null) {
    throw new ArtworkInspectionContractError("invalid_observation", "completed observations require a verdict");
  }
  if (observation.status !== "completed" && observation.verdict !== null) {
    throw new ArtworkInspectionContractError(
      "invalid_observation",
      "only completed observations may include a verdict"
    );
  }
  if (["failed", "unavailable"].includes(observation.status) && observation.error === null) {
    throw new ArtworkInspectionContractError(
      "invalid_observation",
      "failed and unavailable observations require a sanitized error"
    );
  }
  if (observation.status === "reconciling") {
    if (observation.error?.retry_disposition !== "reconcile") {
      throw new ArtworkInspectionContractError(
        "invalid_observation",
        "reconciling observations require reconcile disposition"
      );
    }
  }
  if (observation.completed_at !== null) {
    requireTimestamp(observation.completed_at, "completed_at");
  }
  if (observation.started_at !== null) {
    requireTimestamp(observation.started_at, "started_at");
  }
  if (observation.submitted_at !== null) {
    requireTimestamp(observation.submitted_at, "submitted_at");
  }
  if (observation.native_report) {
    requireText(observation.native_report.private_report_ref, "private_report_ref");
    requireSha256(observation.native_report.sha256, "native_report.sha256");
    requireText(observation.native_report.schema_version, "native_report.schema_version");
  }
  if (observation.error) {
    requireText(observation.error.reason_code, "error.reason_code");
    requireText(observation.error.correlation_id, "error.correlation_id");
    requireTimestamp(observation.error.occurred_at, "error.occurred_at");
  }
  return observation;
}

export function appendInspectionObservation(
  history: readonly InspectionObservation[],
  observation: InspectionObservation
): readonly InspectionObservation[] {
  validateInspectionObservation(observation);
  const immutableObservation = freezeObservation(observation);
  const previous = history.at(-1);
  if (previous) {
    const identityFields: ReadonlyArray<readonly [string, string | null, string | null]> = [
      ["inspection_id", immutableObservation.inspection_id, previous.inspection_id],
      ["provider_key", immutableObservation.provider_key, previous.provider_key],
      ["adapter_version", immutableObservation.adapter_version, previous.adapter_version],
      ["engine_revision", immutableObservation.engine_revision, previous.engine_revision],
      ["policy_revision_id", immutableObservation.policy_revision_id, previous.policy_revision_id]
    ];
    const mismatch = identityFields.find(([, actual, expected]) => actual !== expected);
    if (mismatch) {
      throw new ArtworkInspectionContractError(
        "binding_mismatch",
        `${mismatch[0]} cannot change within an inspection history`
      );
    }
    if (
      TERMINAL_STATUSES.has(previous.status) ||
      !STATUS_TRANSITIONS[previous.status].includes(immutableObservation.status)
    ) {
      throw new ArtworkInspectionContractError(
        "invalid_transition",
        `inspection status cannot transition from ${previous.status} to ${immutableObservation.status}`
      );
    }
  }
  return freezeArray([...history, immutableObservation]);
}

export function createSubmissionUncertainObservation(input: {
  readonly inspection_id: string;
  readonly provider_key: string;
  readonly adapter_version: string;
  readonly engine_revision: string | null;
  readonly policy_revision_id: string;
  readonly provider_reference: string | null;
  readonly correlation_id: string;
  readonly occurred_at: string;
  readonly submitted_at: string;
}): InspectionObservation {
  const observation: InspectionObservation = Object.freeze({
    inspection_id: requireText(input.inspection_id, "inspection_id"),
    status: "reconciling",
    verdict: null,
    provider_reference:
      input.provider_reference === null
        ? null
        : requireText(input.provider_reference, "provider_reference"),
    provider_key: requireText(input.provider_key, "provider_key"),
    adapter_version: requireText(input.adapter_version, "adapter_version"),
    engine_revision:
      input.engine_revision === null ? null : requireText(input.engine_revision, "engine_revision"),
    policy_revision_id: requireText(input.policy_revision_id, "policy_revision_id"),
    metrics: Object.freeze([]),
    findings: Object.freeze([]),
    native_report: null,
    submitted_at: requireTimestamp(input.submitted_at, "submitted_at"),
    started_at: null,
    completed_at: null,
    error: Object.freeze({
      category: "submission_uncertain",
      reason_code: "provider_acceptance_unknown",
      retry_disposition: "reconcile",
      correlation_id: requireText(input.correlation_id, "correlation_id"),
      occurred_at: requireTimestamp(input.occurred_at, "occurred_at")
    })
  });
  return validateInspectionObservation(observation);
}

export function toSafeInspectionSummary(observation: InspectionObservation): SafeInspectionSummary {
  validateInspectionObservation(observation);
  return Object.freeze({
    inspection_id: observation.inspection_id,
    status: observation.status,
    verdict: observation.verdict,
    engine_revision: observation.engine_revision,
    metrics: freezeArray(observation.metrics.map((metric) => Object.freeze({ ...metric }))),
    findings: freezeArray(
      observation.findings.map((finding) =>
        Object.freeze({
          ...finding,
          region: finding.region === null ? null : Object.freeze({ ...finding.region })
        })
      )
    ),
    has_native_report: observation.native_report !== null,
    completed_at: observation.completed_at,
    error_category: observation.error?.category ?? null,
    error_reason_code: observation.error?.reason_code ?? null
  });
}

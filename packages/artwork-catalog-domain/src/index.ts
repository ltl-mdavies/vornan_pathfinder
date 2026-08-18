import {
  appendInspectionObservation,
  type InspectionObservation,
  type InspectionStatus,
  type InspectionVerdict
} from "@pathfinder/artwork-inspection-contracts";

type BrandedId<Brand extends string> = string & { readonly __brand: Brand };

export type CustomerId = BrandedId<"CustomerId">;
export type CatalogId = BrandedId<"CatalogId">;
export type CatalogProductId = BrandedId<"CatalogProductId">;
export type CatalogProductRevisionId = BrandedId<"CatalogProductRevisionId">;
export type ProductSpecificationRevisionId = BrandedId<"ProductSpecificationRevisionId">;
export type ArtworkAssetId = BrandedId<"ArtworkAssetId">;
export type ArtworkVersionId = BrandedId<"ArtworkVersionId">;
export type InspectionPolicyRevisionId = BrandedId<"InspectionPolicyRevisionId">;
export type ArtworkInspectionId = BrandedId<"ArtworkInspectionId">;
export type ArtworkApprovalId = BrandedId<"ArtworkApprovalId">;
export type ArtworkApprovalDecisionId = BrandedId<"ArtworkApprovalDecisionId">;

export type ArtworkVersionState =
  | "initialized"
  | "uploading"
  | "uploaded"
  | "content_verified"
  | "scan_pending"
  | "usable"
  | "blocked";

export type InspectionPolicyMode = "disabled" | "advisory" | "required";
export type InspectionEvidenceState =
  | "not_requested"
  | "queued"
  | "running"
  | "pass"
  | "warn"
  | "fail"
  | "unavailable";

export interface CustomerCatalog {
  readonly customer_id: CustomerId;
  readonly catalog_id: CatalogId;
  readonly created_at: string;
}

export interface ProductSpecificationRevision {
  readonly customer_id: CustomerId;
  readonly specification_revision_id: ProductSpecificationRevisionId;
  readonly width: number;
  readonly height: number;
  readonly units: "in" | "mm" | "cm";
  readonly artwork_scale: {
    readonly numerator: number;
    readonly denominator: number;
  };
  readonly target_dpi: number;
  readonly created_at: string;
}

export interface CatalogProduct {
  readonly customer_id: CustomerId;
  readonly catalog_id: CatalogId;
  readonly catalog_product_id: CatalogProductId;
  readonly created_at: string;
}

export interface CatalogProductRevision {
  readonly customer_id: CustomerId;
  readonly catalog_id: CatalogId;
  readonly catalog_product_id: CatalogProductId;
  readonly catalog_product_revision_id: CatalogProductRevisionId;
  readonly specification_revision_id: ProductSpecificationRevisionId;
  readonly created_at: string;
}

export interface ArtworkAsset {
  readonly customer_id: CustomerId;
  readonly catalog_id: CatalogId;
  readonly catalog_product_id: CatalogProductId;
  readonly artwork_asset_id: ArtworkAssetId;
  readonly created_at: string;
}

export interface ArtworkVersion {
  readonly customer_id: CustomerId;
  readonly catalog_id: CatalogId;
  readonly catalog_product_id: CatalogProductId;
  readonly artwork_asset_id: ArtworkAssetId;
  readonly artwork_version_id: ArtworkVersionId;
  readonly specification_revision_id: ProductSpecificationRevisionId;
  readonly object_version_id: string;
  readonly sha256: string;
  readonly content_type: string;
  readonly content_length: number;
  readonly original_filename: string;
  readonly predecessor_version_id: ArtworkVersionId | null;
  readonly state: ArtworkVersionState;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface InspectionPolicyRevision {
  readonly customer_id: CustomerId;
  readonly catalog_id: CatalogId;
  readonly policy_revision_id: InspectionPolicyRevisionId;
  readonly mode: InspectionPolicyMode;
  readonly provider_key: string | null;
  readonly created_at: string;
}

export interface ArtworkInspection {
  readonly customer_id: CustomerId;
  readonly catalog_id: CatalogId;
  readonly catalog_product_id: CatalogProductId;
  readonly artwork_asset_id: ArtworkAssetId;
  readonly artwork_version_id: ArtworkVersionId;
  readonly specification_revision_id: ProductSpecificationRevisionId;
  readonly policy_revision_id: InspectionPolicyRevisionId;
  readonly inspection_id: ArtworkInspectionId;
  readonly object_version_id: string;
  readonly sha256: string;
  readonly provider_key: string;
  readonly adapter_version: string;
  readonly engine_revision: string | null;
  readonly idempotency_key: string;
  readonly status: InspectionStatus;
  readonly verdict: InspectionVerdict | null;
  readonly observations: readonly InspectionObservation[];
  readonly created_at: string;
  readonly updated_at: string;
}

export type ArtworkApprovalParty = "prepress" | "customer";
export type ArtworkApprovalDecisionOutcome = "approved" | "rejected";
export type ArtworkApprovalState = "not_requested" | "pending" | "approved" | "rejected";

export interface ArtworkApprovalDecision {
  readonly approval_decision_id: ArtworkApprovalDecisionId;
  readonly party: ArtworkApprovalParty;
  readonly outcome: ArtworkApprovalDecisionOutcome;
  readonly decided_by: string;
  readonly note: string | null;
  readonly decided_at: string;
}

export interface ArtworkApproval {
  readonly customer_id: CustomerId;
  readonly catalog_id: CatalogId;
  readonly catalog_product_id: CatalogProductId;
  readonly artwork_asset_id: ArtworkAssetId;
  readonly artwork_version_id: ArtworkVersionId;
  readonly specification_revision_id: ProductSpecificationRevisionId;
  readonly approval_id: ArtworkApprovalId;
  readonly object_version_id: string;
  readonly sha256: string;
  readonly decisions: readonly ArtworkApprovalDecision[];
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ArtworkReadiness {
  readonly asset_safety: "usable" | "pending" | "blocked";
  readonly inspection_requirement: InspectionPolicyMode;
  readonly inspection_evidence: InspectionEvidenceState;
  readonly human_approval: ArtworkApprovalState;
  readonly business_release: "held";
}

export type ArtworkCatalogDomainErrorCode =
  | "invalid_value"
  | "binding_mismatch"
  | "invalid_transition"
  | "inspection_disabled"
  | "asset_not_usable"
  | "rerun_conflict"
  | "approval_conflict";

export class ArtworkCatalogDomainError extends Error {
  constructor(
    readonly code: ArtworkCatalogDomainErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ArtworkCatalogDomainError";
  }
}

const ARTWORK_VERSION_TRANSITIONS: Readonly<Record<ArtworkVersionState, readonly ArtworkVersionState[]>> = {
  initialized: ["uploading"],
  uploading: ["uploaded", "blocked"],
  uploaded: ["content_verified", "blocked"],
  content_verified: ["scan_pending", "blocked"],
  scan_pending: ["usable", "blocked"],
  usable: [],
  blocked: []
};

function requireId<Brand extends string>(value: string, label: string): BrandedId<Brand> {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalized)) {
    throw new ArtworkCatalogDomainError("invalid_value", `${label} is invalid`);
  }
  return normalized as BrandedId<Brand>;
}

function requireText(value: string, label: string, maximum = 512): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new ArtworkCatalogDomainError("invalid_value", `${label} must be non-empty and bounded`);
  }
  return normalized;
}

function requireTimestamp(value: string, label: string): string {
  if (!value || Number.isNaN(Date.parse(value))) {
    throw new ArtworkCatalogDomainError("invalid_value", `${label} must be an ISO timestamp`);
  }
  return value;
}

function requirePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ArtworkCatalogDomainError("invalid_value", `${label} must be positive`);
  }
  return value;
}

function requireSha256(value: string): string {
  const normalized = value.toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new ArtworkCatalogDomainError("invalid_value", "sha256 must be a SHA-256 hex digest");
  }
  return normalized;
}

function assertEqual(label: string, actual: string, expected: string): void {
  if (actual !== expected) {
    throw new ArtworkCatalogDomainError("binding_mismatch", `${label} binding mismatch`);
  }
}

export function createCustomerCatalog(input: {
  readonly customer_id: string;
  readonly catalog_id: string;
  readonly created_at: string;
}): CustomerCatalog {
  return Object.freeze({
    customer_id: requireId<"CustomerId">(input.customer_id, "customer_id"),
    catalog_id: requireId<"CatalogId">(input.catalog_id, "catalog_id"),
    created_at: requireTimestamp(input.created_at, "created_at")
  });
}

export function createProductSpecificationRevision(input: {
  readonly customer_id: string;
  readonly specification_revision_id: string;
  readonly width: number;
  readonly height: number;
  readonly units: "in" | "mm" | "cm";
  readonly artwork_scale: { readonly numerator: number; readonly denominator: number };
  readonly target_dpi: number;
  readonly created_at: string;
}): ProductSpecificationRevision {
  if (!(["in", "mm", "cm"] as const).includes(input.units)) {
    throw new ArtworkCatalogDomainError("invalid_value", "units are unsupported");
  }
  return Object.freeze({
    customer_id: requireId<"CustomerId">(input.customer_id, "customer_id"),
    specification_revision_id: requireId<"ProductSpecificationRevisionId">(
      input.specification_revision_id,
      "specification_revision_id"
    ),
    width: requirePositive(input.width, "width"),
    height: requirePositive(input.height, "height"),
    units: input.units,
    artwork_scale: Object.freeze({
      numerator: requirePositive(input.artwork_scale.numerator, "artwork_scale.numerator"),
      denominator: requirePositive(input.artwork_scale.denominator, "artwork_scale.denominator")
    }),
    target_dpi: requirePositive(input.target_dpi, "target_dpi"),
    created_at: requireTimestamp(input.created_at, "created_at")
  });
}

export function createCatalogProduct(input: {
  readonly catalog: CustomerCatalog;
  readonly catalog_product_id: string;
  readonly created_at: string;
}): CatalogProduct {
  return Object.freeze({
    customer_id: input.catalog.customer_id,
    catalog_id: input.catalog.catalog_id,
    catalog_product_id: requireId<"CatalogProductId">(input.catalog_product_id, "catalog_product_id"),
    created_at: requireTimestamp(input.created_at, "created_at")
  });
}

export function createCatalogProductRevision(input: {
  readonly product: CatalogProduct;
  readonly specification: ProductSpecificationRevision;
  readonly catalog_product_revision_id: string;
  readonly created_at: string;
}): CatalogProductRevision {
  assertEqual("customer_id", input.specification.customer_id, input.product.customer_id);
  return Object.freeze({
    customer_id: input.product.customer_id,
    catalog_id: input.product.catalog_id,
    catalog_product_id: input.product.catalog_product_id,
    catalog_product_revision_id: requireId<"CatalogProductRevisionId">(
      input.catalog_product_revision_id,
      "catalog_product_revision_id"
    ),
    specification_revision_id: input.specification.specification_revision_id,
    created_at: requireTimestamp(input.created_at, "created_at")
  });
}

export function createArtworkAsset(input: {
  readonly product: CatalogProduct;
  readonly artwork_asset_id: string;
  readonly created_at: string;
}): ArtworkAsset {
  return Object.freeze({
    customer_id: input.product.customer_id,
    catalog_id: input.product.catalog_id,
    catalog_product_id: input.product.catalog_product_id,
    artwork_asset_id: requireId<"ArtworkAssetId">(input.artwork_asset_id, "artwork_asset_id"),
    created_at: requireTimestamp(input.created_at, "created_at")
  });
}

export function createArtworkVersion(input: {
  readonly asset: ArtworkAsset;
  readonly specification: ProductSpecificationRevision;
  readonly artwork_version_id: string;
  readonly object_version_id: string;
  readonly sha256: string;
  readonly content_type: string;
  readonly content_length: number;
  readonly original_filename: string;
  readonly predecessor_version_id?: ArtworkVersionId | null;
  readonly created_at: string;
}): ArtworkVersion {
  assertEqual("customer_id", input.specification.customer_id, input.asset.customer_id);
  const createdAt = requireTimestamp(input.created_at, "created_at");
  return Object.freeze({
    customer_id: input.asset.customer_id,
    catalog_id: input.asset.catalog_id,
    catalog_product_id: input.asset.catalog_product_id,
    artwork_asset_id: input.asset.artwork_asset_id,
    artwork_version_id: requireId<"ArtworkVersionId">(input.artwork_version_id, "artwork_version_id"),
    specification_revision_id: input.specification.specification_revision_id,
    object_version_id: requireText(input.object_version_id, "object_version_id"),
    sha256: requireSha256(input.sha256),
    content_type: requireText(input.content_type, "content_type").toLowerCase(),
    content_length: requirePositive(input.content_length, "content_length"),
    original_filename: requireText(input.original_filename, "original_filename"),
    predecessor_version_id: input.predecessor_version_id ?? null,
    state: "initialized",
    created_at: createdAt,
    updated_at: createdAt
  });
}

export function transitionArtworkVersion(
  version: ArtworkVersion,
  nextState: ArtworkVersionState,
  occurredAt: string
): ArtworkVersion {
  if (!ARTWORK_VERSION_TRANSITIONS[version.state].includes(nextState)) {
    throw new ArtworkCatalogDomainError(
      "invalid_transition",
      `artwork version cannot transition from ${version.state} to ${nextState}`
    );
  }
  const timestamp = requireTimestamp(occurredAt, "occurred_at");
  if (Date.parse(timestamp) < Date.parse(version.updated_at)) {
    throw new ArtworkCatalogDomainError("invalid_transition", "artwork version time cannot move backwards");
  }
  return Object.freeze({ ...version, state: nextState, updated_at: timestamp });
}

export function createInspectionPolicyRevision(input: {
  readonly catalog: CustomerCatalog;
  readonly policy_revision_id: string;
  readonly mode: InspectionPolicyMode;
  readonly provider_key: string | null;
  readonly created_at: string;
}): InspectionPolicyRevision {
  if (!(["disabled", "advisory", "required"] as const).includes(input.mode)) {
    throw new ArtworkCatalogDomainError("invalid_value", "inspection policy mode is unsupported");
  }
  if (input.mode === "disabled" && input.provider_key !== null) {
    throw new ArtworkCatalogDomainError("invalid_value", "disabled inspection policy cannot select a provider");
  }
  if (input.mode !== "disabled" && input.provider_key === null) {
    throw new ArtworkCatalogDomainError("invalid_value", "enabled inspection policy requires a provider key");
  }
  return Object.freeze({
    customer_id: input.catalog.customer_id,
    catalog_id: input.catalog.catalog_id,
    policy_revision_id: requireId<"InspectionPolicyRevisionId">(
      input.policy_revision_id,
      "policy_revision_id"
    ),
    mode: input.mode,
    provider_key:
      input.provider_key === null ? null : requireText(input.provider_key, "provider_key"),
    created_at: requireTimestamp(input.created_at, "created_at")
  });
}

function assetSafety(state: ArtworkVersionState): ArtworkReadiness["asset_safety"] {
  if (state === "usable") return "usable";
  if (state === "blocked") return "blocked";
  return "pending";
}

function assertApprovalVersionBinding(approval: ArtworkApproval, version: ArtworkVersion): void {
  const bindings: ReadonlyArray<readonly [string, string, string]> = [
    ["approval.customer_id", approval.customer_id, version.customer_id],
    ["approval.catalog_id", approval.catalog_id, version.catalog_id],
    ["approval.catalog_product_id", approval.catalog_product_id, version.catalog_product_id],
    ["approval.artwork_asset_id", approval.artwork_asset_id, version.artwork_asset_id],
    ["approval.artwork_version_id", approval.artwork_version_id, version.artwork_version_id],
    ["approval.specification_revision_id", approval.specification_revision_id, version.specification_revision_id],
    ["approval.object_version_id", approval.object_version_id, version.object_version_id],
    ["approval.sha256", approval.sha256, version.sha256]
  ];
  const mismatch = bindings.find(([, actual, expected]) => actual !== expected);
  if (mismatch) {
    throw new ArtworkCatalogDomainError("binding_mismatch", `${mismatch[0]} binding mismatch`);
  }
}

export function approvalState(approval: ArtworkApproval | null | undefined): ArtworkApprovalState {
  if (!approval) return "not_requested";
  if (approval.decisions.some((decision) => decision.outcome === "rejected")) return "rejected";
  const parties = new Set(approval.decisions.map((decision) => decision.party));
  return parties.has("prepress") && parties.has("customer") ? "approved" : "pending";
}

export function createArtworkApproval(input: {
  readonly version: ArtworkVersion;
  readonly approval_id: string;
  readonly created_at: string;
}): ArtworkApproval {
  if (input.version.state !== "usable") {
    throw new ArtworkCatalogDomainError(
      "asset_not_usable",
      "only a usable artwork version may enter approval"
    );
  }
  const createdAt = requireTimestamp(input.created_at, "created_at");
  if (Date.parse(createdAt) < Date.parse(input.version.updated_at)) {
    throw new ArtworkCatalogDomainError(
      "invalid_transition",
      "approval request time cannot precede the usable artwork version"
    );
  }
  return Object.freeze({
    customer_id: input.version.customer_id,
    catalog_id: input.version.catalog_id,
    catalog_product_id: input.version.catalog_product_id,
    artwork_asset_id: input.version.artwork_asset_id,
    artwork_version_id: input.version.artwork_version_id,
    specification_revision_id: input.version.specification_revision_id,
    approval_id: requireId<"ArtworkApprovalId">(input.approval_id, "approval_id"),
    object_version_id: input.version.object_version_id,
    sha256: input.version.sha256,
    decisions: Object.freeze([]),
    created_at: createdAt,
    updated_at: createdAt
  });
}

export function appendArtworkApprovalDecision(input: {
  readonly approval: ArtworkApproval;
  readonly approval_decision_id: string;
  readonly party: ArtworkApprovalParty;
  readonly outcome: ArtworkApprovalDecisionOutcome;
  readonly decided_by: string;
  readonly note?: string | null;
  readonly decided_at: string;
}): ArtworkApproval {
  if (!(["prepress", "customer"] as const).includes(input.party)) {
    throw new ArtworkCatalogDomainError("invalid_value", "approval party is unsupported");
  }
  if (!(["approved", "rejected"] as const).includes(input.outcome)) {
    throw new ArtworkCatalogDomainError("invalid_value", "approval outcome is unsupported");
  }
  if (approvalState(input.approval) !== "pending") {
    throw new ArtworkCatalogDomainError("approval_conflict", "terminal approval cannot accept decisions");
  }
  const decisionId = requireId<"ArtworkApprovalDecisionId">(
    input.approval_decision_id,
    "approval_decision_id"
  );
  if (input.approval.decisions.some((decision) => decision.approval_decision_id === decisionId)) {
    throw new ArtworkCatalogDomainError("approval_conflict", "approval decision identity must be unique");
  }
  if (input.approval.decisions.some((decision) => decision.party === input.party)) {
    throw new ArtworkCatalogDomainError("approval_conflict", "approval party decision is immutable");
  }
  const decidedAt = requireTimestamp(input.decided_at, "decided_at");
  if (Date.parse(decidedAt) < Date.parse(input.approval.updated_at)) {
    throw new ArtworkCatalogDomainError("invalid_transition", "approval decision time cannot move backwards");
  }
  const note = input.note === null || input.note === undefined
    ? null
    : requireText(input.note, "approval note", 1_000);
  const decision = Object.freeze({
    approval_decision_id: decisionId,
    party: input.party,
    outcome: input.outcome,
    decided_by: requireText(input.decided_by, "decided_by", 256),
    note,
    decided_at: decidedAt
  });
  return Object.freeze({
    ...input.approval,
    decisions: Object.freeze([...input.approval.decisions, decision]),
    updated_at: decidedAt
  });
}

export function evaluateArtworkReadiness(
  version: ArtworkVersion,
  policy: InspectionPolicyRevision,
  inspection?: ArtworkInspection | null,
  approval?: ArtworkApproval | null
): ArtworkReadiness {
  assertEqual("customer_id", policy.customer_id, version.customer_id);
  assertEqual("catalog_id", policy.catalog_id, version.catalog_id);
  if (inspection) {
    assertEqual("inspection.customer_id", inspection.customer_id, version.customer_id);
    assertEqual("inspection.catalog_id", inspection.catalog_id, version.catalog_id);
    assertEqual("inspection.artwork_version_id", inspection.artwork_version_id, version.artwork_version_id);
    assertEqual("inspection.policy_revision_id", inspection.policy_revision_id, policy.policy_revision_id);
  }
  if (approval) assertApprovalVersionBinding(approval, version);

  let evidence: InspectionEvidenceState = "not_requested";
  if (policy.mode !== "disabled") {
    if (!inspection) evidence = version.state === "usable" ? "queued" : "not_requested";
    else if (inspection.status === "queued") evidence = "queued";
    else if (["running", "reconciling"].includes(inspection.status)) evidence = "running";
    else if (inspection.status === "completed") {
      evidence =
        inspection.verdict === null || inspection.verdict === "indeterminate"
          ? "unavailable"
          : inspection.verdict;
    }
    else evidence = "unavailable";
  }

  return Object.freeze({
    asset_safety: assetSafety(version.state),
    inspection_requirement: policy.mode,
    inspection_evidence: evidence,
    human_approval: approvalState(approval),
    business_release: "held"
  });
}

export function createArtworkInspection(input: {
  readonly version: ArtworkVersion;
  readonly policy: InspectionPolicyRevision;
  readonly inspection_id: string;
  readonly provider_key: string;
  readonly adapter_version: string;
  readonly engine_revision: string | null;
  readonly idempotency_key: string;
  readonly created_at: string;
}): ArtworkInspection {
  if (input.version.state !== "usable") {
    throw new ArtworkCatalogDomainError("asset_not_usable", "only a usable artwork version may be inspected");
  }
  assertEqual("customer_id", input.policy.customer_id, input.version.customer_id);
  assertEqual("catalog_id", input.policy.catalog_id, input.version.catalog_id);
  if (input.policy.mode === "disabled") {
    throw new ArtworkCatalogDomainError("inspection_disabled", "inspection policy is disabled");
  }
  assertEqual("provider_key", input.provider_key, input.policy.provider_key ?? "");
  const createdAt = requireTimestamp(input.created_at, "created_at");
  return Object.freeze({
    customer_id: input.version.customer_id,
    catalog_id: input.version.catalog_id,
    catalog_product_id: input.version.catalog_product_id,
    artwork_asset_id: input.version.artwork_asset_id,
    artwork_version_id: input.version.artwork_version_id,
    specification_revision_id: input.version.specification_revision_id,
    policy_revision_id: input.policy.policy_revision_id,
    inspection_id: requireId<"ArtworkInspectionId">(input.inspection_id, "inspection_id"),
    object_version_id: input.version.object_version_id,
    sha256: input.version.sha256,
    provider_key: requireText(input.provider_key, "provider_key"),
    adapter_version: requireText(input.adapter_version, "adapter_version"),
    engine_revision:
      input.engine_revision === null ? null : requireText(input.engine_revision, "engine_revision"),
    idempotency_key: requireText(input.idempotency_key, "idempotency_key"),
    status: "queued",
    verdict: null,
    observations: Object.freeze([]),
    created_at: createdAt,
    updated_at: createdAt
  });
}

export function recordArtworkInspectionObservation(
  inspection: ArtworkInspection,
  observation: InspectionObservation,
  occurredAt: string
): ArtworkInspection {
  assertEqual("inspection_id", observation.inspection_id, inspection.inspection_id);
  assertEqual("provider_key", observation.provider_key, inspection.provider_key);
  assertEqual("adapter_version", observation.adapter_version, inspection.adapter_version);
  assertEqual("policy_revision_id", observation.policy_revision_id, inspection.policy_revision_id);
  assertEqual("engine_revision", observation.engine_revision ?? "", inspection.engine_revision ?? "");
  const timestamp = requireTimestamp(occurredAt, "occurred_at");
  if (Date.parse(timestamp) < Date.parse(inspection.updated_at)) {
    throw new ArtworkCatalogDomainError("invalid_transition", "inspection time cannot move backwards");
  }
  const observations = appendInspectionObservation(inspection.observations, observation);
  return Object.freeze({
    ...inspection,
    status: observation.status,
    verdict: observation.verdict,
    observations,
    updated_at: timestamp
  });
}

export function appendArtworkInspectionRerun(
  history: readonly ArtworkInspection[],
  next: ArtworkInspection
): readonly ArtworkInspection[] {
  if (history.some((inspection) => inspection.inspection_id === next.inspection_id)) {
    throw new ArtworkCatalogDomainError("rerun_conflict", "inspection_id must be unique for a rerun");
  }
  const previous = history.at(-1);
  if (previous) {
    const bindings: ReadonlyArray<readonly [string, string, string]> = [
      ["customer_id", next.customer_id, previous.customer_id],
      ["catalog_id", next.catalog_id, previous.catalog_id],
      ["catalog_product_id", next.catalog_product_id, previous.catalog_product_id],
      ["artwork_asset_id", next.artwork_asset_id, previous.artwork_asset_id],
      ["artwork_version_id", next.artwork_version_id, previous.artwork_version_id],
      ["specification_revision_id", next.specification_revision_id, previous.specification_revision_id],
      ["object_version_id", next.object_version_id, previous.object_version_id],
      ["sha256", next.sha256, previous.sha256]
    ];
    const mismatch = bindings.find(([, actual, expected]) => actual !== expected);
    if (mismatch) {
      throw new ArtworkCatalogDomainError(
        "binding_mismatch",
        `${mismatch[0]} cannot change within an inspection rerun history`
      );
    }
    const revisionChanged =
      next.policy_revision_id !== previous.policy_revision_id ||
      next.provider_key !== previous.provider_key ||
      next.adapter_version !== previous.adapter_version ||
      next.engine_revision !== previous.engine_revision;
    if (!revisionChanged || next.idempotency_key === previous.idempotency_key) {
      throw new ArtworkCatalogDomainError(
        "rerun_conflict",
        "rerun requires a new policy, provider, adapter, or engine identity and idempotency key"
      );
    }
  }
  return Object.freeze([...history, next]);
}

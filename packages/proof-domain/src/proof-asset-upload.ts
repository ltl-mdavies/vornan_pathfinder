import {
  buildProofRevisionAssetKeys,
  computeProofAssetCleanupEligibleAtEpoch,
  computeProofAssetLiftNotBeforeEpoch,
  PROOF_ASSET_RETENTION,
  type ProofAssetLifecycleState,
  type ProofAssetMalwareScanStatus
} from "./proof-asset-lifecycle.js";

const ORDER_NUMBER = /^A\d{7,8}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const ASSET_ID = /^passet_[a-f0-9]{64}$/;
const REVISION_ID = /^prevision_[a-f0-9]{64}$/;
const PUBLICATION_ID = /^ppublication_[a-f0-9]{64}$/;
const PACKET_ID = /^ppacket_[a-f0-9]{64}$/;
const LOCATOR_ID = /^plocator_[a-f0-9]{64}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const OBJECT_VERSION_ID = /^[A-Za-z0-9._~+/=-]{1,1024}$/;
const BUCKET_NAME =
  /^vornan-pathfinder-proof-assets-[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const CONTENT_TYPE =
  /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i;
const MAX_S3_OBJECT_LENGTH = 5 * 1024 * 1024 * 1024 * 1024;
const MAX_PACKET_MEMBERSHIPS = 50;
const DELIVERY_HOST = "go.vornan.co";

export type ProofAssetUploadState = Extract<
  ProofAssetLifecycleState,
  | "initialized"
  | "uploading"
  | "uploaded"
  | "verifying"
  | "scan_pending"
  | "ready_for_lift"
>;

export type ProofAssetStorageClass =
  | "unfinalized"
  | "quarantined"
  | "retained_source";

export type ProofAssetPacketKind =
  | "client_current"
  | "internal_source_complete";

export type ProofAssetVerificationStatus =
  | "pending"
  | "quarantined"
  | "cleared";

export type ProofAssetPublicationStatus =
  | "not_started"
  | "published"
  | "delivery_verified";

export interface ProofAssetPacketMembership {
  packet_id: string;
  packet_kind: ProofAssetPacketKind;
  source_object_version_id: string;
  source_sha256: string;
  included_at: string;
}

/**
 * Durable metadata only. This record must never contain creative bytes, signed
 * URLs, URL query strings, credentials, JWTs, authorization headers, customer
 * comments, or external-repository locations.
 */
export interface ProofAssetUploadRecord {
  schema_version: 1;
  asset_id: string;
  revision_id: string;
  publication_id: string;
  source_kind: "proof_upload";
  storage_boundary: "proof_assets";
  bucket_name: string;
  order_number: string;
  task_id: string;
  attachment_id: string;
  replaces_proof_version_id: string;
  original_filename: string;
  content_policy_id: string;
  content_policy_max_bytes: number;
  declared_content_type: string;
  declared_content_length: number;
  declared_sha256: string;
  source_key: string;
  outbound_key: string;
  state: ProofAssetUploadState;
  storage_class: ProofAssetStorageClass;
  record_version: number;
  initialized_at: string;
  updated_at: string;
  upload_started_at: string | null;
  upload_completed_at: string | null;
  source_object_version_id: string | null;
  source_content_type: string | null;
  source_content_length: number | null;
  source_sha256: string | null;
  verification_started_at: string | null;
  scan_started_at: string | null;
  verification_status: ProofAssetVerificationStatus;
  malware_scan_status: ProofAssetMalwareScanStatus;
  scan_evidence_sha256: string | null;
  scan_completed_at: string | null;
  quarantine_reason:
    | "threats_found"
    | "unsupported"
    | "access_denied"
    | "scan_failed"
    | null;
  cleared_at: string | null;
  outbound_object_version_id: string | null;
  outbound_content_length: number | null;
  outbound_sha256: string | null;
  published_at: string | null;
  publication_status: ProofAssetPublicationStatus;
  delivery_locator_id: string | null;
  delivery_host: "go.vornan.co" | null;
  delivery_url_sha256: string | null;
  delivery_verified_at: string | null;
  settle_delay_seconds: 1 | 2 | null;
  lift_not_before_epoch: number | null;
  retention_days: number;
  order_completed_at: string | null;
  last_proof_activity_at: string;
  retention_anchor_at: string;
  cleanup_eligible_at_epoch: number;
  legal_hold: boolean;
  packet_memberships: ProofAssetPacketMembership[];
}

export interface ProofAssetMutationResult {
  status: "updated" | "replay";
  record: ProofAssetUploadRecord;
}

export class ProofAssetUploadError extends Error {
  constructor(
    public readonly code:
      | "invalid"
      | "cross_bound"
      | "stale"
      | "invalid_transition"
      | "conflict",
    message: string
  ) {
    super(message);
    this.name = "ProofAssetUploadError";
  }
}

const RECORD_KEYS = [
  "asset_id",
  "attachment_id",
  "bucket_name",
  "cleanup_eligible_at_epoch",
  "cleared_at",
  "content_policy_id",
  "content_policy_max_bytes",
  "declared_content_length",
  "declared_content_type",
  "declared_sha256",
  "delivery_host",
  "delivery_locator_id",
  "delivery_url_sha256",
  "delivery_verified_at",
  "initialized_at",
  "last_proof_activity_at",
  "legal_hold",
  "lift_not_before_epoch",
  "malware_scan_status",
  "order_completed_at",
  "order_number",
  "original_filename",
  "outbound_content_length",
  "outbound_key",
  "outbound_object_version_id",
  "outbound_sha256",
  "packet_memberships",
  "publication_id",
  "publication_status",
  "published_at",
  "quarantine_reason",
  "record_version",
  "replaces_proof_version_id",
  "retention_anchor_at",
  "retention_days",
  "revision_id",
  "scan_completed_at",
  "scan_evidence_sha256",
  "scan_started_at",
  "schema_version",
  "settle_delay_seconds",
  "source_content_length",
  "source_content_type",
  "source_key",
  "source_kind",
  "source_object_version_id",
  "source_sha256",
  "state",
  "storage_boundary",
  "storage_class",
  "task_id",
  "updated_at",
  "upload_completed_at",
  "upload_started_at",
  "verification_started_at",
  "verification_status"
].sort().join(",");

const PACKET_KEYS = [
  "included_at",
  "packet_id",
  "packet_kind",
  "source_object_version_id",
  "source_sha256"
].sort().join(",");

const COMPLETED_STATES = new Set<ProofAssetUploadState>([
  "uploaded",
  "verifying",
  "scan_pending",
  "ready_for_lift"
]);
const VERIFYING_STATES = new Set<ProofAssetUploadState>([
  "verifying",
  "scan_pending",
  "ready_for_lift"
]);

function exactKeys(value: object, expected: string) {
  return Object.keys(value).sort().join(",") === expected;
}

function timestamp(value: unknown, label: string) {
  if (typeof value !== "string") {
    throw new ProofAssetUploadError("invalid", `${label} is invalid.`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new ProofAssetUploadError("invalid", `${label} is invalid.`);
  }
  return parsed;
}

function optionalTimestamp(value: unknown, label: string) {
  return value === null ? null : timestamp(value, label);
}

function safeContentLength(
  value: unknown,
  label: string,
  maximum = MAX_S3_OBJECT_LENGTH
) {
  if (
    !Number.isInteger(value) ||
    (value as number) < 1 ||
    (value as number) > maximum
  ) {
    throw new ProofAssetUploadError("invalid", `${label} is invalid.`);
  }
  return value as number;
}

function optionalString(
  value: unknown,
  pattern: RegExp,
  label: string
) {
  if (value === null) return null;
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new ProofAssetUploadError("invalid", `${label} is invalid.`);
  }
  return value;
}

function requireExpectedVersion(
  record: ProofAssetUploadRecord,
  expectedRecordVersion: number
) {
  if (
    !Number.isInteger(expectedRecordVersion) ||
    expectedRecordVersion !== record.record_version
  ) {
    throw new ProofAssetUploadError(
      "stale",
      "Proof asset metadata changed before this operation completed."
    );
  }
}

function requireAtOrAfter(
  value: string,
  lowerBound: string,
  label: string
) {
  if (timestamp(value, label) < timestamp(lowerBound, label)) {
    throw new ProofAssetUploadError("invalid", `${label} is out of order.`);
  }
}

function updatedRecord(
  record: ProofAssetUploadRecord,
  expectedRecordVersion: number,
  updatedAt: string,
  patch: Partial<ProofAssetUploadRecord>
) {
  requireExpectedVersion(record, expectedRecordVersion);
  requireAtOrAfter(updatedAt, record.updated_at, "Proof asset update timestamp");
  return validateProofAssetUploadRecord({
    ...record,
    ...patch,
    record_version: record.record_version + 1,
    updated_at: updatedAt
  });
}

function packetMembership(value: unknown) {
  const membership = value as ProofAssetPacketMembership;
  if (
    !membership ||
    typeof membership !== "object" ||
    !exactKeys(membership, PACKET_KEYS) ||
    !PACKET_ID.test(membership.packet_id) ||
    !["client_current", "internal_source_complete"].includes(
      membership.packet_kind
    ) ||
    !OBJECT_VERSION_ID.test(membership.source_object_version_id) ||
    !SHA256.test(membership.source_sha256)
  ) {
    throw new ProofAssetUploadError(
      "invalid",
      "Proof asset packet membership is invalid."
    );
  }
  timestamp(membership.included_at, "Proof asset packet membership timestamp");
  return membership;
}

function validateStateFields(record: ProofAssetUploadRecord) {
  const completed = COMPLETED_STATES.has(record.state);
  const verifying = VERIFYING_STATES.has(record.state);
  const scanStarted =
    record.state === "scan_pending" || record.state === "ready_for_lift";
  const quarantined = record.verification_status === "quarantined";
  const cleared = record.verification_status === "cleared";
  const published = record.publication_status !== "not_started";
  const deliveryReady = record.state === "ready_for_lift";

  if (
    (record.state === "initialized" &&
      (record.upload_started_at !== null ||
        completed ||
        record.storage_class !== "unfinalized")) ||
    (record.state === "uploading" &&
      (record.upload_started_at === null ||
        completed ||
        record.storage_class !== "unfinalized")) ||
    (completed &&
      (record.upload_started_at === null ||
        record.upload_completed_at === null ||
        record.source_object_version_id === null ||
        record.source_content_type === null ||
        record.source_content_length === null ||
        record.source_sha256 === null)) ||
    (!completed &&
      (record.upload_completed_at !== null ||
        record.source_object_version_id !== null ||
        record.source_content_type !== null ||
        record.source_content_length !== null ||
        record.source_sha256 !== null)) ||
    (verifying && record.verification_started_at === null) ||
    (!verifying && record.verification_started_at !== null) ||
    (scanStarted && record.scan_started_at === null) ||
    (!scanStarted && record.scan_started_at !== null) ||
    (record.verification_status === "pending" &&
      (record.storage_class !== "unfinalized" ||
        record.malware_scan_status !== "pending" ||
        record.scan_completed_at !== null ||
        record.scan_evidence_sha256 !== null ||
        record.quarantine_reason !== null ||
        record.cleared_at !== null)) ||
    (quarantined &&
      (record.storage_class !== "quarantined" ||
        record.scan_completed_at === null ||
        record.scan_evidence_sha256 === null ||
        record.quarantine_reason === null ||
        ![
          "threats_found",
          "unsupported",
          "access_denied",
          "failed"
        ].includes(record.malware_scan_status))) ||
    (!quarantined && record.quarantine_reason !== null) ||
    (cleared &&
      (record.storage_class !== "retained_source" ||
        record.malware_scan_status !== "no_threats_found" ||
        record.scan_completed_at === null ||
        record.scan_evidence_sha256 === null ||
        record.cleared_at === null)) ||
    (!cleared && record.cleared_at !== null) ||
    (published &&
      (record.verification_status !== "cleared" ||
        record.outbound_object_version_id === null ||
        record.outbound_content_length === null ||
        record.outbound_sha256 === null ||
        record.published_at === null)) ||
    (!published &&
      (record.outbound_object_version_id !== null ||
        record.outbound_content_length !== null ||
        record.outbound_sha256 !== null ||
        record.published_at !== null)) ||
    (record.publication_status === "delivery_verified" && !deliveryReady) ||
    (deliveryReady && record.publication_status !== "delivery_verified") ||
    (deliveryReady &&
      (record.delivery_locator_id === null ||
        record.delivery_host !== DELIVERY_HOST ||
        record.delivery_url_sha256 === null ||
        record.delivery_verified_at === null ||
        record.settle_delay_seconds === null ||
        record.lift_not_before_epoch === null)) ||
    (!deliveryReady &&
      (record.delivery_locator_id !== null ||
        record.delivery_host !== null ||
        record.delivery_url_sha256 !== null ||
        record.delivery_verified_at !== null ||
        record.settle_delay_seconds !== null ||
        record.lift_not_before_epoch !== null))
  ) {
    throw new ProofAssetUploadError(
      "invalid",
      "Proof asset metadata does not match its lifecycle state."
    );
  }
}

export function validateProofAssetUploadRecord(value: unknown) {
  const record = value as ProofAssetUploadRecord;
  if (
    !record ||
    typeof record !== "object" ||
    !exactKeys(record, RECORD_KEYS) ||
    record.schema_version !== 1 ||
    !ASSET_ID.test(record.asset_id) ||
    !REVISION_ID.test(record.revision_id) ||
    !PUBLICATION_ID.test(record.publication_id) ||
    record.source_kind !== "proof_upload" ||
    record.storage_boundary !== "proof_assets" ||
    !BUCKET_NAME.test(record.bucket_name) ||
    !ORDER_NUMBER.test(record.order_number) ||
    !IDENTIFIER.test(record.task_id) ||
    !IDENTIFIER.test(record.attachment_id) ||
    !IDENTIFIER.test(record.replaces_proof_version_id) ||
    !IDENTIFIER.test(record.content_policy_id) ||
    !CONTENT_TYPE.test(record.declared_content_type) ||
    !SHA256.test(record.declared_sha256) ||
    !Number.isInteger(record.content_policy_max_bytes) ||
    record.content_policy_max_bytes < 1 ||
    record.content_policy_max_bytes > MAX_S3_OBJECT_LENGTH ||
    ![
      "initialized",
      "uploading",
      "uploaded",
      "verifying",
      "scan_pending",
      "ready_for_lift"
    ].includes(record.state) ||
    !["unfinalized", "quarantined", "retained_source"].includes(
      record.storage_class
    ) ||
    !["pending", "quarantined", "cleared"].includes(
      record.verification_status
    ) ||
    !["not_started", "published", "delivery_verified"].includes(
      record.publication_status
    ) ||
    ![
      "pending",
      "no_threats_found",
      "threats_found",
      "unsupported",
      "access_denied",
      "failed"
    ].includes(record.malware_scan_status) ||
    !Number.isInteger(record.record_version) ||
    record.record_version < 1 ||
    !Number.isInteger(record.retention_days) ||
    record.retention_days < PROOF_ASSET_RETENTION.minimum_days ||
    record.retention_days > PROOF_ASSET_RETENTION.maximum_days ||
    typeof record.legal_hold !== "boolean" ||
    !Array.isArray(record.packet_memberships) ||
    record.packet_memberships.length > MAX_PACKET_MEMBERSHIPS
  ) {
    throw new ProofAssetUploadError("invalid", "Proof asset metadata is invalid.");
  }
  safeContentLength(
    record.declared_content_length,
    "Declared content length",
    record.content_policy_max_bytes
  );
  const keys = buildProofRevisionAssetKeys({
    order_number: record.order_number,
    task_id: record.task_id,
    revision_id: record.revision_id,
    asset_id: record.asset_id,
    publication_id: record.publication_id,
    filename: record.original_filename
  });
  if (
    record.source_key !== keys.source_key ||
    record.outbound_key !== keys.outbound_key
  ) {
    throw new ProofAssetUploadError(
      "cross_bound",
      "Proof asset storage keys do not match the bound order, task, and revision."
    );
  }

  const initializedAt = timestamp(record.initialized_at, "Initialization timestamp");
  const updatedAt = timestamp(record.updated_at, "Update timestamp");
  const uploadStartedAt = optionalTimestamp(
    record.upload_started_at,
    "Upload start timestamp"
  );
  const uploadCompletedAt = optionalTimestamp(
    record.upload_completed_at,
    "Upload completion timestamp"
  );
  const verificationStartedAt = optionalTimestamp(
    record.verification_started_at,
    "Verification start timestamp"
  );
  const scanStartedAt = optionalTimestamp(
    record.scan_started_at,
    "Scan start timestamp"
  );
  const scanCompletedAt = optionalTimestamp(
    record.scan_completed_at,
    "Scan completion timestamp"
  );
  const clearedAt = optionalTimestamp(record.cleared_at, "Clearance timestamp");
  const publishedAt = optionalTimestamp(record.published_at, "Publication timestamp");
  const deliveryVerifiedAt = optionalTimestamp(
    record.delivery_verified_at,
    "Delivery verification timestamp"
  );
  const orderCompletedAt =
    record.order_completed_at === null
      ? Number.NEGATIVE_INFINITY
      : timestamp(record.order_completed_at, "Order completion timestamp");
  const lastProofActivityAt = timestamp(
    record.last_proof_activity_at,
    "Last Proof activity timestamp"
  );
  const retentionAnchorAt = timestamp(
    record.retention_anchor_at,
    "Retention anchor timestamp"
  );
  if (
    updatedAt < initializedAt ||
    retentionAnchorAt !== Math.max(orderCompletedAt, lastProofActivityAt) ||
    retentionAnchorAt > updatedAt ||
    record.cleanup_eligible_at_epoch !==
      computeProofAssetCleanupEligibleAtEpoch({
        retention_anchor_at: record.retention_anchor_at,
        retention_days: record.retention_days
      }) ||
    (uploadStartedAt !== null && uploadStartedAt < initializedAt) ||
    (uploadCompletedAt !== null &&
      (uploadStartedAt === null || uploadCompletedAt < uploadStartedAt)) ||
    (verificationStartedAt !== null &&
      (uploadCompletedAt === null ||
        verificationStartedAt < uploadCompletedAt)) ||
    (scanStartedAt !== null &&
      (verificationStartedAt === null ||
        scanStartedAt < verificationStartedAt)) ||
    (scanCompletedAt !== null &&
      (scanStartedAt === null || scanCompletedAt < scanStartedAt)) ||
    (clearedAt !== null &&
      (scanCompletedAt === null || clearedAt < scanCompletedAt)) ||
    (publishedAt !== null &&
      (clearedAt === null || publishedAt < clearedAt)) ||
    (deliveryVerifiedAt !== null &&
      (publishedAt === null || deliveryVerifiedAt < publishedAt))
  ) {
    throw new ProofAssetUploadError(
      "invalid",
      "Proof asset lifecycle timing is invalid."
    );
  }

  optionalString(
    record.source_object_version_id,
    OBJECT_VERSION_ID,
    "Source object version"
  );
  if (
    record.source_content_type !== null &&
    !CONTENT_TYPE.test(record.source_content_type)
  ) {
    throw new ProofAssetUploadError("invalid", "Source content type is invalid.");
  }
  if (record.source_content_length !== null) {
    safeContentLength(record.source_content_length, "Source content length");
  }
  optionalString(record.source_sha256, SHA256, "Source checksum");
  optionalString(record.scan_evidence_sha256, SHA256, "Scan evidence digest");
  optionalString(
    record.outbound_object_version_id,
    OBJECT_VERSION_ID,
    "Outbound object version"
  );
  if (record.outbound_content_length !== null) {
    safeContentLength(record.outbound_content_length, "Outbound content length");
  }
  optionalString(record.outbound_sha256, SHA256, "Outbound checksum");
  optionalString(record.delivery_locator_id, LOCATOR_ID, "Delivery locator");
  optionalString(record.delivery_url_sha256, SHA256, "Delivery URL digest");
  if (
    record.delivery_host !== null &&
    record.delivery_host !== DELIVERY_HOST
  ) {
    throw new ProofAssetUploadError("invalid", "Delivery host is invalid.");
  }
  if (
    record.settle_delay_seconds !== null &&
    ![1, 2].includes(record.settle_delay_seconds)
  ) {
    throw new ProofAssetUploadError("invalid", "Settle delay is invalid.");
  }
  if (
    record.lift_not_before_epoch !== null &&
    (!Number.isInteger(record.lift_not_before_epoch) ||
      record.delivery_verified_at === null ||
      record.lift_not_before_epoch !==
        computeProofAssetLiftNotBeforeEpoch({
          delivery_verified_at: record.delivery_verified_at,
          settle_delay_seconds: record.settle_delay_seconds ?? undefined
        }))
  ) {
    throw new ProofAssetUploadError("invalid", "Lift readiness time is invalid.");
  }

  if (
    record.source_object_version_id !== null &&
    (record.source_content_type !== record.declared_content_type ||
      record.source_content_length !== record.declared_content_length ||
      record.source_sha256 !== record.declared_sha256)
  ) {
    throw new ProofAssetUploadError(
      "cross_bound",
      "Completed upload metadata does not match the initialized asset."
    );
  }
  if (
    record.outbound_object_version_id !== null &&
    (record.outbound_content_length !== record.source_content_length ||
      record.outbound_sha256 !== record.source_sha256)
  ) {
    throw new ProofAssetUploadError(
      "cross_bound",
      "Outbound publication does not match the verified source object."
    );
  }

  validateStateFields(record);

  const packetIds = new Set<string>();
  for (const candidate of record.packet_memberships) {
    const membership = packetMembership(candidate);
    if (
      packetIds.has(membership.packet_id) ||
      membership.source_object_version_id !== record.source_object_version_id ||
      membership.source_sha256 !== record.source_sha256 ||
      timestamp(membership.included_at, "Packet inclusion timestamp") < initializedAt
    ) {
      throw new ProofAssetUploadError(
        "cross_bound",
        "Proof packet membership does not match the immutable source object."
      );
    }
    packetIds.add(membership.packet_id);
  }
  return record;
}

export function createProofAssetUploadRecord(input: {
  asset_id: string;
  revision_id: string;
  publication_id: string;
  bucket_name: string;
  order_number: string;
  task_id: string;
  attachment_id: string;
  replaces_proof_version_id: string;
  original_filename: string;
  content_policy_id: string;
  content_policy_max_bytes: number;
  allowed_content_types: readonly string[];
  declared_content_type: string;
  declared_content_length: number;
  declared_sha256: string;
  retention_days?: number;
  order_completed_at: string | null;
  last_proof_activity_at: string;
  initialized_at: string;
}) {
  const initializedAt = timestamp(input.initialized_at, "Initialization timestamp");
  if (
    !Array.isArray(input.allowed_content_types) ||
    input.allowed_content_types.length < 1 ||
    input.allowed_content_types.length > 100 ||
    input.allowed_content_types.some(
      (candidate) =>
        typeof candidate !== "string" || !CONTENT_TYPE.test(candidate)
    ) ||
    !input.allowed_content_types.includes(input.declared_content_type)
  ) {
    throw new ProofAssetUploadError(
      "invalid",
      "Declared content type is not allowed by the Proof asset policy."
    );
  }
  const orderCompletedAt =
    input.order_completed_at === null
      ? Number.NEGATIVE_INFINITY
      : timestamp(input.order_completed_at, "Order completion timestamp");
  const lastProofActivityAt = timestamp(
    input.last_proof_activity_at,
    "Last Proof activity timestamp"
  );
  const retentionAnchorAt = Math.max(orderCompletedAt, lastProofActivityAt);
  if (retentionAnchorAt > initializedAt) {
    throw new ProofAssetUploadError(
      "invalid",
      "Proof asset retention anchor cannot be in the future."
    );
  }
  const retentionAnchor = new Date(retentionAnchorAt).toISOString();
  const keys = buildProofRevisionAssetKeys({
    order_number: input.order_number,
    task_id: input.task_id,
    revision_id: input.revision_id,
    asset_id: input.asset_id,
    publication_id: input.publication_id,
    filename: input.original_filename
  });
  const record: ProofAssetUploadRecord = {
    schema_version: 1,
    asset_id: input.asset_id,
    revision_id: input.revision_id,
    publication_id: input.publication_id,
    source_kind: "proof_upload",
    storage_boundary: "proof_assets",
    bucket_name: input.bucket_name,
    order_number: input.order_number,
    task_id: input.task_id,
    attachment_id: input.attachment_id,
    replaces_proof_version_id: input.replaces_proof_version_id,
    original_filename: input.original_filename,
    content_policy_id: input.content_policy_id,
    content_policy_max_bytes: input.content_policy_max_bytes,
    declared_content_type: input.declared_content_type,
    declared_content_length: input.declared_content_length,
    declared_sha256: input.declared_sha256,
    source_key: keys.source_key,
    outbound_key: keys.outbound_key,
    state: "initialized",
    storage_class: "unfinalized",
    record_version: 1,
    initialized_at: input.initialized_at,
    updated_at: input.initialized_at,
    upload_started_at: null,
    upload_completed_at: null,
    source_object_version_id: null,
    source_content_type: null,
    source_content_length: null,
    source_sha256: null,
    verification_started_at: null,
    scan_started_at: null,
    verification_status: "pending",
    malware_scan_status: "pending",
    scan_evidence_sha256: null,
    scan_completed_at: null,
    quarantine_reason: null,
    cleared_at: null,
    outbound_object_version_id: null,
    outbound_content_length: null,
    outbound_sha256: null,
    published_at: null,
    publication_status: "not_started",
    delivery_locator_id: null,
    delivery_host: null,
    delivery_url_sha256: null,
    delivery_verified_at: null,
    settle_delay_seconds: null,
    lift_not_before_epoch: null,
    retention_days:
      input.retention_days ?? PROOF_ASSET_RETENTION.default_days,
    order_completed_at: input.order_completed_at,
    last_proof_activity_at: input.last_proof_activity_at,
    retention_anchor_at: retentionAnchor,
    cleanup_eligible_at_epoch: computeProofAssetCleanupEligibleAtEpoch({
      retention_anchor_at: retentionAnchor,
      retention_days: input.retention_days
    }),
    legal_hold: false,
    packet_memberships: []
  };
  return validateProofAssetUploadRecord(record);
}

/**
 * Advances the server-authored retention inputs when later order completion or
 * Proof activity occurs. Exact replays do not move the cleanup timestamp, and
 * callers cannot move either source timestamp backwards or into the future.
 */
export function updateProofAssetRetentionActivity(input: {
  record: unknown;
  expected_record_version: number;
  updated_at: string;
  order_completed_at: string | null;
  last_proof_activity_at: string;
}): ProofAssetMutationResult {
  const record = validateProofAssetUploadRecord(input.record);
  const exact =
    record.order_completed_at === input.order_completed_at &&
    record.last_proof_activity_at === input.last_proof_activity_at;
  if (exact) {
    return { status: "replay", record };
  }

  const updatedAt = timestamp(input.updated_at, "Retention update timestamp");
  const currentOrderCompletedAt =
    record.order_completed_at === null
      ? Number.NEGATIVE_INFINITY
      : timestamp(record.order_completed_at, "Order completion timestamp");
  const nextOrderCompletedAt =
    input.order_completed_at === null
      ? Number.NEGATIVE_INFINITY
      : timestamp(input.order_completed_at, "Order completion timestamp");
  const currentLastProofActivityAt = timestamp(
    record.last_proof_activity_at,
    "Last Proof activity timestamp"
  );
  const nextLastProofActivityAt = timestamp(
    input.last_proof_activity_at,
    "Last Proof activity timestamp"
  );

  if (
    nextOrderCompletedAt < currentOrderCompletedAt ||
    nextLastProofActivityAt < currentLastProofActivityAt
  ) {
    throw new ProofAssetUploadError(
      "conflict",
      "Proof asset retention activity cannot move backwards."
    );
  }
  const nextRetentionAnchorAt = Math.max(
    nextOrderCompletedAt,
    nextLastProofActivityAt
  );
  if (nextRetentionAnchorAt > updatedAt) {
    throw new ProofAssetUploadError(
      "invalid",
      "Proof asset retention activity cannot be in the future."
    );
  }
  const retentionAnchor = new Date(nextRetentionAnchorAt).toISOString();

  return {
    status: "updated",
    record: updatedRecord(
      record,
      input.expected_record_version,
      input.updated_at,
      {
        order_completed_at: input.order_completed_at,
        last_proof_activity_at: input.last_proof_activity_at,
        retention_anchor_at: retentionAnchor,
        cleanup_eligible_at_epoch: computeProofAssetCleanupEligibleAtEpoch({
          retention_anchor_at: retentionAnchor,
          retention_days: record.retention_days
        })
      }
    )
  };
}

export function beginProofAssetUpload(input: {
  record: unknown;
  expected_record_version: number;
  upload_started_at: string;
}): ProofAssetMutationResult {
  const record = validateProofAssetUploadRecord(input.record);
  if (record.state === "uploading") {
    if (record.upload_started_at === input.upload_started_at) {
      return { status: "replay", record };
    }
    throw new ProofAssetUploadError(
      "conflict",
      "Proof upload start does not match the durable upload session."
    );
  }
  if (record.state !== "initialized") {
    throw new ProofAssetUploadError(
      "invalid_transition",
      "Proof asset is not waiting for upload."
    );
  }
  return {
    status: "updated",
    record: updatedRecord(
      record,
      input.expected_record_version,
      input.upload_started_at,
      {
        state: "uploading",
        upload_started_at: input.upload_started_at
      }
    )
  };
}

export function completeProofAssetUpload(input: {
  record: unknown;
  expected_record_version: number;
  upload_completed_at: string;
  source_object_version_id: string;
  source_content_type: string;
  source_content_length: number;
  source_sha256: string;
}): ProofAssetMutationResult {
  const record = validateProofAssetUploadRecord(input.record);
  const exact =
    record.source_object_version_id === input.source_object_version_id &&
    record.source_content_type === input.source_content_type &&
    record.source_content_length === input.source_content_length &&
    record.source_sha256 === input.source_sha256 &&
    record.upload_completed_at === input.upload_completed_at;
  if (COMPLETED_STATES.has(record.state)) {
    if (exact) return { status: "replay", record };
    throw new ProofAssetUploadError(
      "conflict",
      "Proof upload completion conflicts with the immutable source object."
    );
  }
  if (record.state !== "uploading") {
    throw new ProofAssetUploadError(
      "invalid_transition",
      "Proof asset upload has not started."
    );
  }
  if (
    input.source_content_type !== record.declared_content_type ||
    input.source_content_length !== record.declared_content_length ||
    input.source_sha256 !== record.declared_sha256
  ) {
    throw new ProofAssetUploadError(
      "cross_bound",
      "Uploaded object metadata does not match the initialized asset."
    );
  }
  return {
    status: "updated",
    record: updatedRecord(
      record,
      input.expected_record_version,
      input.upload_completed_at,
      {
        state: "uploaded",
        upload_completed_at: input.upload_completed_at,
        source_object_version_id: input.source_object_version_id,
        source_content_type: input.source_content_type,
        source_content_length: input.source_content_length,
        source_sha256: input.source_sha256
      }
    )
  };
}

export function beginProofAssetVerification(input: {
  record: unknown;
  expected_record_version: number;
  verification_started_at: string;
}): ProofAssetMutationResult {
  const record = validateProofAssetUploadRecord(input.record);
  if (VERIFYING_STATES.has(record.state)) {
    if (record.verification_started_at === input.verification_started_at) {
      return { status: "replay", record };
    }
    throw new ProofAssetUploadError(
      "conflict",
      "Proof verification start conflicts with the durable record."
    );
  }
  if (record.state !== "uploaded") {
    throw new ProofAssetUploadError(
      "invalid_transition",
      "Proof asset is not ready for verification."
    );
  }
  return {
    status: "updated",
    record: updatedRecord(
      record,
      input.expected_record_version,
      input.verification_started_at,
      {
        state: "verifying",
        verification_started_at: input.verification_started_at
      }
    )
  };
}

export function beginProofAssetScan(input: {
  record: unknown;
  expected_record_version: number;
  scan_started_at: string;
}): ProofAssetMutationResult {
  const record = validateProofAssetUploadRecord(input.record);
  if (record.state === "scan_pending" || record.state === "ready_for_lift") {
    if (record.scan_started_at === input.scan_started_at) {
      return { status: "replay", record };
    }
    throw new ProofAssetUploadError(
      "conflict",
      "Proof scan start conflicts with the durable verification record."
    );
  }
  if (record.state !== "verifying") {
    throw new ProofAssetUploadError(
      "invalid_transition",
      "Proof asset verification is not ready for scanning."
    );
  }
  return {
    status: "updated",
    record: updatedRecord(
      record,
      input.expected_record_version,
      input.scan_started_at,
      {
        state: "scan_pending",
        scan_started_at: input.scan_started_at
      }
    )
  };
}

function quarantineReason(
  status: Exclude<ProofAssetMalwareScanStatus, "pending" | "no_threats_found">
): ProofAssetUploadRecord["quarantine_reason"] {
  if (status === "threats_found") return "threats_found";
  if (status === "unsupported") return "unsupported";
  if (status === "access_denied") return "access_denied";
  return "scan_failed";
}

export function completeProofAssetVerification(input: {
  record: unknown;
  expected_record_version: number;
  scan_completed_at: string;
  scan_status: Exclude<ProofAssetMalwareScanStatus, "pending">;
  scan_evidence_sha256: string;
}): ProofAssetMutationResult {
  const record = validateProofAssetUploadRecord(input.record);
  const nextVerificationStatus =
    input.scan_status === "no_threats_found" ? "cleared" : "quarantined";
  const expectedReason =
    input.scan_status === "no_threats_found"
      ? null
      : quarantineReason(input.scan_status);
  if (record.verification_status !== "pending") {
    if (
      record.verification_status === nextVerificationStatus &&
      record.malware_scan_status === input.scan_status &&
      record.scan_evidence_sha256 === input.scan_evidence_sha256 &&
      record.scan_completed_at === input.scan_completed_at
    ) {
      return { status: "replay", record };
    }
    throw new ProofAssetUploadError(
      "conflict",
      "Proof verification result conflicts with the durable scan result."
    );
  }
  if (record.state !== "scan_pending") {
    throw new ProofAssetUploadError(
      "invalid_transition",
      "Proof asset scan has not started."
    );
  }
  return {
    status: "updated",
    record: updatedRecord(
      record,
      input.expected_record_version,
      input.scan_completed_at,
      {
        storage_class:
          nextVerificationStatus === "cleared"
            ? "retained_source"
            : "quarantined",
        verification_status: nextVerificationStatus,
        malware_scan_status: input.scan_status,
        scan_evidence_sha256: input.scan_evidence_sha256,
        scan_completed_at: input.scan_completed_at,
        quarantine_reason: expectedReason,
        cleared_at:
          nextVerificationStatus === "cleared"
            ? input.scan_completed_at
            : null
      }
    )
  };
}

export function recordProofAssetPublication(input: {
  record: unknown;
  expected_record_version: number;
  published_at: string;
  outbound_object_version_id: string;
  outbound_content_length: number;
  outbound_sha256: string;
}): ProofAssetMutationResult {
  const record = validateProofAssetUploadRecord(input.record);
  const exact =
    record.published_at === input.published_at &&
    record.outbound_object_version_id === input.outbound_object_version_id &&
    record.outbound_content_length === input.outbound_content_length &&
    record.outbound_sha256 === input.outbound_sha256;
  if (record.publication_status !== "not_started") {
    if (exact) return { status: "replay", record };
    throw new ProofAssetUploadError(
      "conflict",
      "Proof publication conflicts with the immutable outbound object."
    );
  }
  if (
    record.state !== "scan_pending" ||
    record.verification_status !== "cleared"
  ) {
    throw new ProofAssetUploadError(
      "invalid_transition",
      "Only a cleared Proof asset may be published."
    );
  }
  if (
    input.outbound_content_length !== record.source_content_length ||
    input.outbound_sha256 !== record.source_sha256
  ) {
    throw new ProofAssetUploadError(
      "cross_bound",
      "Outbound publication does not match the verified source object."
    );
  }
  return {
    status: "updated",
    record: updatedRecord(
      record,
      input.expected_record_version,
      input.published_at,
      {
        publication_status: "published",
        outbound_object_version_id: input.outbound_object_version_id,
        outbound_content_length: input.outbound_content_length,
        outbound_sha256: input.outbound_sha256,
        published_at: input.published_at
      }
    )
  };
}

export function recordProofAssetDeliveryVerification(input: {
  record: unknown;
  expected_record_version: number;
  delivery_verified_at: string;
  delivery_locator_id: string;
  delivery_host: "go.vornan.co";
  delivery_url_sha256: string;
  direct_http_status: 200;
  redirected: false;
  observed_content_type: string;
  observed_content_length: number;
  settle_delay_seconds?: 1 | 2;
}): ProofAssetMutationResult {
  const record = validateProofAssetUploadRecord(input.record);
  const settleDelay = input.settle_delay_seconds ?? 2;
  const liftNotBefore = computeProofAssetLiftNotBeforeEpoch({
    delivery_verified_at: input.delivery_verified_at,
    settle_delay_seconds: settleDelay
  });
  const exact =
    record.delivery_verified_at === input.delivery_verified_at &&
    record.delivery_locator_id === input.delivery_locator_id &&
    record.delivery_host === input.delivery_host &&
    record.delivery_url_sha256 === input.delivery_url_sha256 &&
    record.settle_delay_seconds === settleDelay &&
    record.lift_not_before_epoch === liftNotBefore;
  if (record.state === "ready_for_lift") {
    if (exact) return { status: "replay", record };
    throw new ProofAssetUploadError(
      "conflict",
      "Proof delivery verification conflicts with the durable publication."
    );
  }
  if (
    record.state !== "scan_pending" ||
    record.publication_status !== "published"
  ) {
    throw new ProofAssetUploadError(
      "invalid_transition",
      "Proof publication is not ready for delivery verification."
    );
  }
  if (
    input.delivery_host !== DELIVERY_HOST ||
    input.direct_http_status !== 200 ||
    input.redirected !== false ||
    input.observed_content_type !== record.source_content_type ||
    input.observed_content_length !== record.source_content_length
  ) {
    throw new ProofAssetUploadError(
      "cross_bound",
      "Direct Proof delivery did not match the immutable source object."
    );
  }
  return {
    status: "updated",
    record: updatedRecord(
      record,
      input.expected_record_version,
      input.delivery_verified_at,
      {
        state: "ready_for_lift",
        publication_status: "delivery_verified",
        delivery_locator_id: input.delivery_locator_id,
        delivery_host: input.delivery_host,
        delivery_url_sha256: input.delivery_url_sha256,
        delivery_verified_at: input.delivery_verified_at,
        settle_delay_seconds: settleDelay,
        lift_not_before_epoch: liftNotBefore
      }
    )
  };
}

export function addProofAssetPacketMembership(input: {
  record: unknown;
  expected_record_version: number;
  packet_id: string;
  packet_kind: ProofAssetPacketKind;
  included_at: string;
}): ProofAssetMutationResult {
  const record = validateProofAssetUploadRecord(input.record);
  if (record.verification_status !== "cleared") {
    throw new ProofAssetUploadError(
      "invalid_transition",
      "Only a cleared Proof source may be added to a proof packet."
    );
  }
  const existing = record.packet_memberships.find(
    (candidate) => candidate.packet_id === input.packet_id
  );
  if (existing) {
    if (
      existing.packet_kind === input.packet_kind &&
      existing.included_at === input.included_at
    ) {
      return { status: "replay", record };
    }
    throw new ProofAssetUploadError(
      "conflict",
      "Proof packet membership conflicts with the durable packet."
    );
  }
  if (record.packet_memberships.length >= MAX_PACKET_MEMBERSHIPS) {
    throw new ProofAssetUploadError(
      "invalid",
      "Proof asset packet membership limit was reached."
    );
  }
  requireExpectedVersion(record, input.expected_record_version);
  const membership = packetMembership({
    packet_id: input.packet_id,
    packet_kind: input.packet_kind,
    source_object_version_id: record.source_object_version_id!,
    source_sha256: record.source_sha256!,
    included_at: input.included_at
  });
  return {
    status: "updated",
    record: updatedRecord(
      record,
      input.expected_record_version,
      input.included_at,
      {
        packet_memberships: [...record.packet_memberships, membership].sort(
          (left, right) => left.packet_id.localeCompare(right.packet_id)
        )
      }
    )
  };
}

const ORDER_NUMBER = /^A\d{7,8}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const ASSET_ID = /^passet_[a-f0-9]{64}$/;
const REVISION_ID = /^prevision_[a-f0-9]{64}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._() -]{0,239}$/;
const OBJECT_VERSION_ID = /^[A-Za-z0-9._~+/=-]{1,1024}$/;

export const PROOF_ASSET_RETENTION = Object.freeze({
  minimum_days: 60,
  default_days: 90,
  maximum_days: 90,
  abandoned_upload_days: 1,
  unfinalized_upload_days: 7,
  failed_scan_quarantine_days: 7,
  generated_packet_days: 30,
  outbound_copy_days: 14
});

export const PROOF_ASSET_SETTLE_DELAY = Object.freeze({
  minimum_seconds: 1,
  default_seconds: 2,
  maximum_seconds: 2
});

export type ProofAssetLifecycleState =
  | "initialized"
  | "uploading"
  | "uploaded"
  | "verifying"
  | "scan_pending"
  | "ready_for_lift"
  | "submission_uncertain"
  | "reconciling"
  | "retained"
  | "deleted";

export type ProofAssetMalwareScanStatus =
  | "pending"
  | "no_threats_found"
  | "threats_found"
  | "unsupported"
  | "access_denied"
  | "failed";

/**
 * Server-assembled readiness view. `delivery_url` is transient and must never be
 * written to the Proof asset record, action ledger, audit event, or log.
 */
export interface ProofRevisionAssetReadiness {
  asset_id: string;
  publication_id: string;
  revision_id: string;
  source_kind: "proof_upload";
  order_number: string;
  task_id: string;
  attachment_id: string;
  replaces_proof_version_id: string;
  original_filename: string;
  content_type: string;
  content_length: number;
  sha256: string;
  source_object_version_id: string;
  source_key: string;
  outbound_object_version_id: string;
  outbound_sha256: string;
  outbound_key: string;
  delivery_host: string;
  delivery_url: string;
  delivery_url_sha256: string;
  state: ProofAssetLifecycleState;
  malware_scan_status: ProofAssetMalwareScanStatus;
  outbound_status: "pending" | "published";
  delivery_status: "pending" | "verified_direct_200";
  upload_completed_at: string;
  verified_at: string;
  published_at: string;
  delivery_verified_at: string;
  settle_delay_seconds: number;
  lift_not_before_epoch: number;
  retention_days: number;
  order_completed_at: string | null;
  last_proof_activity_at: string;
  retention_anchor_at: string;
  cleanup_eligible_at_epoch: number;
  legal_hold: boolean;
}

export interface ProofRevisionAssetBinding {
  order_number: string;
  task_id: string;
  attachment_id: string;
  expected_proof_version_id: string;
  expected_revision_id: string;
  expected_source_object_version_id: string;
  expected_outbound_object_version_id: string;
  expected_delivery_url_sha256: string;
  asset_id: string;
}

export class ProofAssetLifecycleError extends Error {
  constructor(
    public readonly code:
      | "invalid"
      | "cross_bound"
      | "not_ready"
      | "scan_not_clear"
      | "delivery_not_ready"
      | "settling"
      | "cleanup_eligible",
    message: string
  ) {
    super(message);
    this.name = "ProofAssetLifecycleError";
  }
}

function timestamp(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new ProofAssetLifecycleError("invalid", "Proof asset timestamp is invalid.");
  }
  return parsed;
}

function safeSegment(value: string, label: string) {
  if (!IDENTIFIER.test(value)) {
    throw new ProofAssetLifecycleError("invalid", `${label} is invalid.`);
  }
  return value;
}

function safeFilename(value: string) {
  const normalized = value.trim().replace(/[/\\]/g, "_");
  if (!SAFE_FILENAME.test(normalized) || normalized === "." || normalized === "..") {
    throw new ProofAssetLifecycleError("invalid", "Proof asset filename is invalid.");
  }
  return normalized;
}

export function buildProofRevisionAssetKeys(input: {
  order_number: string;
  task_id: string;
  revision_id: string;
  asset_id: string;
  publication_id: string;
  filename: string;
}) {
  if (!ORDER_NUMBER.test(input.order_number)) {
    throw new ProofAssetLifecycleError("invalid", "Proof asset order number is invalid.");
  }
  const taskId = safeSegment(input.task_id, "Proof asset task ID");
  if (
    !REVISION_ID.test(input.revision_id) ||
    !ASSET_ID.test(input.asset_id) ||
    !/^ppublication_[a-f0-9]{64}$/.test(input.publication_id)
  ) {
    throw new ProofAssetLifecycleError("invalid", "Proof asset identity is invalid.");
  }
  const filename = safeFilename(input.filename);
  const prefix =
    `orders/${input.order_number}/tasks/${taskId}/revisions/${input.revision_id}`;
  return {
    source_key: `${prefix}/source/${input.asset_id}/${filename}`,
    outbound_key: `${prefix}/outbound/${input.publication_id}/${filename}`,
    packet_prefix: `orders/${input.order_number}/packets/`
  };
}

export function computeProofAssetCleanupEligibleAtEpoch(input: {
  retention_anchor_at: string;
  retention_days?: number;
}) {
  const retentionDays =
    input.retention_days ?? PROOF_ASSET_RETENTION.default_days;
  if (
    !Number.isInteger(retentionDays) ||
    retentionDays < PROOF_ASSET_RETENTION.minimum_days ||
    retentionDays > PROOF_ASSET_RETENTION.maximum_days
  ) {
    throw new ProofAssetLifecycleError(
      "invalid",
      "Proof asset retention must be between 60 and 90 days."
    );
  }
  return (
    Math.floor(timestamp(input.retention_anchor_at) / 1_000) +
    retentionDays * 24 * 60 * 60
  );
}

export function computeProofAssetLiftNotBeforeEpoch(input: {
  delivery_verified_at: string;
  settle_delay_seconds?: number;
}) {
  const settleDelay =
    input.settle_delay_seconds ?? PROOF_ASSET_SETTLE_DELAY.default_seconds;
  if (
    !Number.isInteger(settleDelay) ||
    settleDelay < PROOF_ASSET_SETTLE_DELAY.minimum_seconds ||
    settleDelay > PROOF_ASSET_SETTLE_DELAY.maximum_seconds
  ) {
    throw new ProofAssetLifecycleError(
      "invalid",
      "Proof asset settling delay must be one or two seconds."
    );
  }
  return Math.floor(timestamp(input.delivery_verified_at) / 1_000) + settleDelay;
}

function directDeliveryUrl(value: string, expectedHost: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ProofAssetLifecycleError("invalid", "Proof asset delivery URL is invalid.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== expectedHost ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    !parsed.pathname.startsWith("/a/")
  ) {
    throw new ProofAssetLifecycleError(
      "invalid",
      "Proof asset delivery URL must be a direct go.vornan.co asset URL."
    );
  }
  return parsed.toString();
}

export function validateProofRevisionAssetReadiness(
  value: unknown,
  options: { expected_delivery_host?: string } = {}
) {
  const record = value as ProofRevisionAssetReadiness;
  const expectedHost = options.expected_delivery_host ?? "go.vornan.co";
  let expectedKeys:
    | ReturnType<typeof buildProofRevisionAssetKeys>
    | undefined;
  if (record && typeof record === "object") {
    try {
      expectedKeys = buildProofRevisionAssetKeys({
        order_number: record.order_number,
        task_id: record.task_id,
        revision_id: record.revision_id,
        asset_id: record.asset_id,
        publication_id: record.publication_id,
        filename: record.original_filename
      });
    } catch {
      expectedKeys = undefined;
    }
  }
  if (
    !record ||
    typeof record !== "object" ||
    !ASSET_ID.test(record.asset_id) ||
    !/^ppublication_[a-f0-9]{64}$/.test(record.publication_id) ||
    !REVISION_ID.test(record.revision_id) ||
    record.source_kind !== "proof_upload" ||
    !ORDER_NUMBER.test(record.order_number) ||
    !IDENTIFIER.test(record.task_id) ||
    !IDENTIFIER.test(record.attachment_id) ||
    !IDENTIFIER.test(record.replaces_proof_version_id) ||
    !SAFE_FILENAME.test(record.original_filename) ||
    typeof record.content_type !== "string" ||
    !/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i.test(record.content_type) ||
    !Number.isInteger(record.content_length) ||
    record.content_length < 1 ||
    !SHA256.test(record.sha256) ||
    !OBJECT_VERSION_ID.test(record.source_object_version_id) ||
    !OBJECT_VERSION_ID.test(record.outbound_object_version_id) ||
    !SHA256.test(record.outbound_sha256) ||
    record.outbound_sha256 !== record.sha256 ||
    !expectedKeys ||
    record.source_key !== expectedKeys.source_key ||
    record.outbound_key !== expectedKeys.outbound_key ||
    record.delivery_host !== expectedHost ||
    !SHA256.test(record.delivery_url_sha256) ||
    record.state !== "ready_for_lift" ||
    record.outbound_status !== "published" ||
    record.delivery_status !== "verified_direct_200" ||
    !Number.isInteger(record.retention_days) ||
    record.retention_days < PROOF_ASSET_RETENTION.minimum_days ||
    record.retention_days > PROOF_ASSET_RETENTION.maximum_days ||
    typeof record.legal_hold !== "boolean"
  ) {
    throw new ProofAssetLifecycleError("invalid", "Proof revision asset record is invalid.");
  }
  directDeliveryUrl(record.delivery_url, expectedHost);
  const uploadCompleted = timestamp(record.upload_completed_at);
  const verified = timestamp(record.verified_at);
  const published = timestamp(record.published_at);
  const deliveryVerified = timestamp(record.delivery_verified_at);
  const orderCompleted =
    record.order_completed_at === null
      ? Number.NEGATIVE_INFINITY
      : timestamp(record.order_completed_at);
  const lastProofActivity = timestamp(record.last_proof_activity_at);
  const retentionAnchor = timestamp(record.retention_anchor_at);
  if (
    uploadCompleted > verified ||
    verified > published ||
    published > deliveryVerified ||
    lastProofActivity < uploadCompleted ||
    retentionAnchor !== Math.max(orderCompleted, lastProofActivity) ||
    record.lift_not_before_epoch !==
      computeProofAssetLiftNotBeforeEpoch({
        delivery_verified_at: record.delivery_verified_at,
        settle_delay_seconds: record.settle_delay_seconds
      }) ||
    record.cleanup_eligible_at_epoch !==
      computeProofAssetCleanupEligibleAtEpoch({
        retention_anchor_at: record.retention_anchor_at,
        retention_days: record.retention_days
      })
  ) {
    throw new ProofAssetLifecycleError("invalid", "Proof asset lifecycle timing is invalid.");
  }
  return record;
}

export function assertProofRevisionAssetReadyForLift(input: {
  asset: unknown;
  binding: ProofRevisionAssetBinding;
  now: Date;
  expected_delivery_host?: string;
}) {
  const asset = validateProofRevisionAssetReadiness(input.asset, {
    expected_delivery_host: input.expected_delivery_host
  });
  if (
    asset.asset_id !== input.binding.asset_id ||
    asset.order_number !== input.binding.order_number ||
    asset.task_id !== input.binding.task_id ||
    asset.attachment_id !== input.binding.attachment_id ||
    asset.replaces_proof_version_id !== input.binding.expected_proof_version_id ||
    asset.revision_id !== input.binding.expected_revision_id ||
    asset.source_object_version_id !==
      input.binding.expected_source_object_version_id ||
    asset.outbound_object_version_id !==
      input.binding.expected_outbound_object_version_id ||
    asset.delivery_url_sha256 !== input.binding.expected_delivery_url_sha256
  ) {
    throw new ProofAssetLifecycleError(
      "cross_bound",
      "Proof revision asset does not match the selected order, task, and attachment."
    );
  }
  if (asset.malware_scan_status !== "no_threats_found") {
    throw new ProofAssetLifecycleError(
      "scan_not_clear",
      "Proof revision asset has not passed malware scanning."
    );
  }
  if (
    asset.outbound_status !== "published" ||
    asset.delivery_status !== "verified_direct_200"
  ) {
    throw new ProofAssetLifecycleError(
      "delivery_not_ready",
      "Proof revision asset is not published for direct delivery."
    );
  }
  const nowEpoch = Math.floor(input.now.getTime() / 1_000);
  if (Math.floor(timestamp(asset.retention_anchor_at) / 1_000) > nowEpoch) {
    throw new ProofAssetLifecycleError(
      "invalid",
      "Proof asset retention anchor cannot be in the future."
    );
  }
  if (nowEpoch < asset.lift_not_before_epoch) {
    throw new ProofAssetLifecycleError(
      "settling",
      "Proof revision asset is still inside its post-publication settling window."
    );
  }
  if (!asset.legal_hold && nowEpoch >= asset.cleanup_eligible_at_epoch) {
    throw new ProofAssetLifecycleError(
      "cleanup_eligible",
      "Proof revision asset has reached its cleanup-eligibility boundary."
    );
  }
  return asset;
}

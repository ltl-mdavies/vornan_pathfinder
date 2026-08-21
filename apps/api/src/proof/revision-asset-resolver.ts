import { createHash } from "node:crypto";
import type { ProofRevisionAssetReadiness } from "@pathfinder/proof-domain/proof-asset-lifecycle";
import type { ProofAssetUploadRecord } from "@pathfinder/proof-domain/proof-asset-upload";
import { getProofAssetUploadRecord } from "./asset-upload-store.js";
import { proofAssetDeliveryUrl } from "./asset-delivery-url.js";

function legacyDeliveryUrl(locatorId: string) {
  return `https://go.vornan.co/a/${locatorId}`;
}

/**
 * Reassembles the transient Lift delivery URL from the durable opaque locator.
 * The URL itself never enters the asset record, audit trail, or action ledger.
 */
export async function resolveProofRevisionAssetReadiness(
  orderNumber: string,
  assetId: string
): Promise<ProofRevisionAssetReadiness | null> {
  const record = await getProofAssetUploadRecord(orderNumber, assetId);
  return assembleProofRevisionAssetReadiness(record);
}

export function assembleProofRevisionAssetReadiness(
  record: ProofAssetUploadRecord | null
): ProofRevisionAssetReadiness | null {
  if (
    !record ||
    record.state !== "ready_for_lift" ||
    record.publication_status !== "delivery_verified" ||
    !record.source_object_version_id ||
    !record.source_content_type ||
    record.source_content_length === null ||
    !record.source_sha256 ||
    !record.upload_completed_at ||
    !record.cleared_at ||
    !record.outbound_object_version_id ||
    !record.outbound_sha256 ||
    !record.published_at ||
    !record.delivery_locator_id ||
    !record.delivery_host ||
    !record.delivery_url_sha256 ||
    !record.delivery_verified_at ||
    !record.settle_delay_seconds ||
    !record.lift_not_before_epoch
  ) {
    return null;
  }
  const filenameUrl = proofAssetDeliveryUrl(
    "https://go.vornan.co",
    record.delivery_locator_id,
    record.original_filename
  );
  const filenameUrlSha256 = createHash("sha256").update(filenameUrl).digest("hex");
  const legacyUrl = legacyDeliveryUrl(record.delivery_locator_id);
  const legacyUrlSha256 = createHash("sha256").update(legacyUrl).digest("hex");
  const url = filenameUrlSha256 === record.delivery_url_sha256
    ? filenameUrl
    : legacyUrlSha256 === record.delivery_url_sha256
      ? legacyUrl
      : null;
  if (!url) {
    return null;
  }
  return {
    asset_id: record.asset_id,
    publication_id: record.publication_id,
    revision_id: record.revision_id,
    source_kind: record.source_kind,
    order_number: record.order_number,
    task_id: record.task_id,
    attachment_id: record.attachment_id,
    replaces_proof_version_id: record.replaces_proof_version_id,
    original_filename: record.original_filename,
    content_type: record.source_content_type,
    content_length: record.source_content_length,
    sha256: record.source_sha256,
    source_object_version_id: record.source_object_version_id,
    source_key: record.source_key,
    outbound_object_version_id: record.outbound_object_version_id,
    outbound_sha256: record.outbound_sha256,
    outbound_key: record.outbound_key,
    delivery_host: record.delivery_host,
    delivery_url: url,
    delivery_url_sha256: record.delivery_url_sha256,
    state: record.state,
    malware_scan_status: record.malware_scan_status,
    outbound_status: "published",
    delivery_status: "verified_direct_200",
    upload_completed_at: record.upload_completed_at,
    verified_at: record.cleared_at,
    published_at: record.published_at,
    delivery_verified_at: record.delivery_verified_at,
    settle_delay_seconds: record.settle_delay_seconds,
    lift_not_before_epoch: record.lift_not_before_epoch,
    retention_days: record.retention_days,
    order_completed_at: record.order_completed_at,
    last_proof_activity_at: record.last_proof_activity_at,
    retention_anchor_at: record.retention_anchor_at,
    cleanup_eligible_at_epoch: record.cleanup_eligible_at_epoch,
    legal_hold: record.legal_hold
  };
}

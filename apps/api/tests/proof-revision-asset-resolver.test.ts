import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  beginProofAssetScan,
  beginProofAssetUpload,
  beginProofAssetVerification,
  completeProofAssetUpload,
  completeProofAssetVerification,
  createProofAssetUploadRecord,
  recordProofAssetDeliveryVerification,
  recordProofAssetPublication
} from "@pathfinder/proof-domain/proof-asset-upload";
import { assembleProofRevisionAssetReadiness } from "../src/proof/revision-asset-resolver.ts";

const digest = "d".repeat(64);
const locator = `plocator_${"e".repeat(64)}`;
const deliveryUrl = `https://go.vornan.co/a/${locator}`;

function readyRecord() {
  let record = createProofAssetUploadRecord({
    asset_id: `passet_${"a".repeat(64)}`,
    revision_id: `prevision_${"b".repeat(64)}`,
    publication_id: `ppublication_${"c".repeat(64)}`,
    bucket_name: "vornan-pathfinder-proof-assets-dev-744016783602",
    order_number: "A0226753",
    task_id: "ptask_synthetic_001",
    attachment_id: "proofing-synthetic-0001",
    replaces_proof_version_id: "pversion-synthetic-001",
    original_filename: "Revised Artwork.pdf",
    content_policy_id: "proof-policy-synthetic-v1",
    content_policy_max_bytes: 1024 * 1024,
    allowed_content_types: ["application/pdf"],
    declared_content_type: "application/pdf",
    declared_content_length: 8192,
    declared_sha256: digest,
    order_completed_at: null,
    last_proof_activity_at: "2026-08-01T11:59:00.000Z",
    initialized_at: "2026-08-01T12:00:00.000Z"
  });
  record = beginProofAssetUpload({
    record,
    expected_record_version: 1,
    upload_started_at: "2026-08-01T12:00:01.000Z"
  }).record;
  record = completeProofAssetUpload({
    record,
    expected_record_version: 2,
    upload_completed_at: "2026-08-01T12:00:02.000Z",
    source_object_version_id: "source-version-1",
    source_content_type: "application/pdf",
    source_content_length: 8192,
    source_sha256: digest
  }).record;
  record = beginProofAssetVerification({
    record,
    expected_record_version: 3,
    verification_started_at: "2026-08-01T12:00:03.000Z"
  }).record;
  record = beginProofAssetScan({
    record,
    expected_record_version: 4,
    scan_started_at: "2026-08-01T12:00:04.000Z"
  }).record;
  record = completeProofAssetVerification({
    record,
    expected_record_version: 5,
    scan_completed_at: "2026-08-01T12:00:05.000Z",
    scan_status: "no_threats_found",
    scan_evidence_sha256: "f".repeat(64)
  }).record;
  record = recordProofAssetPublication({
    record,
    expected_record_version: 6,
    published_at: "2026-08-01T12:00:06.000Z",
    outbound_object_version_id: "outbound-version-1",
    outbound_content_length: 8192,
    outbound_sha256: digest
  }).record;
  return recordProofAssetDeliveryVerification({
    record,
    expected_record_version: 7,
    delivery_verified_at: "2026-08-01T12:00:07.000Z",
    delivery_locator_id: locator,
    delivery_host: "go.vornan.co",
    delivery_url_sha256: createHash("sha256").update(deliveryUrl).digest("hex"),
    direct_http_status: 200,
    redirected: false,
    observed_content_type: "application/pdf",
    observed_content_length: 8192,
    settle_delay_seconds: 2
  }).record;
}

test("reassembles only the checksum-bound transient direct URL", () => {
  const record = readyRecord();
  const readiness = assembleProofRevisionAssetReadiness(record);
  assert.equal(readiness?.delivery_url, deliveryUrl);
  assert.equal(readiness?.delivery_url_sha256, record.delivery_url_sha256);
  assert.equal(readiness?.state, "ready_for_lift");
  assert.equal(readiness?.outbound_object_version_id, "outbound-version-1");
  assert.equal(JSON.stringify(record).includes(deliveryUrl), false);
  assert.equal(assembleProofRevisionAssetReadiness({
    ...record,
    delivery_url_sha256: "0".repeat(64)
  }), null);
});

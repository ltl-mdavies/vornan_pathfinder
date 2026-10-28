import { createHash } from "node:crypto";
import { createProofAssetUploadRecord, beginProofAssetUpload, completeProofAssetUpload, beginProofAssetVerification, beginProofAssetScan, completeProofAssetVerification, recordProofAssetPublication, recordProofAssetDeliveryVerification } from "@pathfinder/proof-domain/proof-asset-upload";

export function readyRevisionAsset() {
  const digest = "d".repeat(64), locator = `plocator_${"e".repeat(64)}`;
  const ts = (seconds: number) => `2026-10-28T12:00:0${seconds}.000Z`;
  let record = createProofAssetUploadRecord({ asset_id: `passet_${"a".repeat(64)}`, revision_id: `prevision_${"b".repeat(64)}`, publication_id: `ppublication_${"c".repeat(64)}`, bucket_name: "vornan-pathfinder-proof-assets-dev-test", order_number: "A0230001", task_id: "ptask_synthetic", attachment_id: "275", replaces_proof_version_id: "pversion_synthetic", original_filename: "Revision.pdf", content_policy_id: "test-v1", content_policy_max_bytes: 1048576, allowed_content_types: ["application/pdf"], declared_content_type: "application/pdf", declared_content_length: 8192, declared_sha256: digest, order_completed_at: null, last_proof_activity_at: ts(0), initialized_at: ts(0) });
  record = beginProofAssetUpload({ record, expected_record_version: record.record_version, upload_started_at: ts(1) }).record;
  record = completeProofAssetUpload({ record, expected_record_version: record.record_version, upload_completed_at: ts(2), source_object_version_id: "source-version", source_content_type: "application/pdf", source_content_length: 8192, source_sha256: digest }).record;
  record = beginProofAssetVerification({ record, expected_record_version: record.record_version, verification_started_at: ts(3) }).record;
  record = beginProofAssetScan({ record, expected_record_version: record.record_version, scan_started_at: ts(4) }).record;
  record = completeProofAssetVerification({ record, expected_record_version: record.record_version, scan_completed_at: ts(5), scan_status: "no_threats_found", scan_evidence_sha256: "f".repeat(64) }).record;
  record = recordProofAssetPublication({ record, expected_record_version: record.record_version, published_at: ts(6), outbound_object_version_id: "outbound-version", outbound_content_length: 8192, outbound_sha256: digest }).record;
  return recordProofAssetDeliveryVerification({ record, expected_record_version: record.record_version, delivery_verified_at: ts(7), delivery_locator_id: locator, delivery_host: "go.vornan.co", delivery_url_sha256: createHash("sha256").update(`https://go.vornan.co/a/${locator}/Revision.pdf`).digest("hex"), direct_http_status: 200, redirected: false, observed_content_type: "application/pdf", observed_content_length: 8192, settle_delay_seconds: 2 }).record;
}

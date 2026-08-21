import assert from "node:assert/strict";
import test from "node:test";
import { CopyObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import {
  beginProofAssetScan,
  beginProofAssetUpload,
  beginProofAssetVerification,
  completeProofAssetUpload,
  completeProofAssetVerification,
  createProofAssetUploadRecord,
  type ProofAssetUploadRecord
} from "@pathfinder/proof-domain/proof-asset-upload";
import { createProofAssetPublicationService } from "../src/proof/asset-publication-service.ts";
import { ProofAssetVerificationPublicationError } from "../src/proof/asset-verification-publication.ts";

const digest = "d".repeat(64);
const encodedDigest = Buffer.from(digest, "hex").toString("base64");

function clearedRecord() {
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
  return completeProofAssetVerification({
    record,
    expected_record_version: 5,
    scan_completed_at: "2026-08-01T12:00:05.000Z",
    scan_status: "no_threats_found",
    scan_evidence_sha256: "f".repeat(64)
  }).record;
}

test("copies exact versions to immutable outbound and filename-bearing direct-delivery objects", async () => {
  let record: ProofAssetUploadRecord = clearedRecord();
  const commands: Array<CopyObjectCommand | HeadObjectCommand> = [];
  let headCount = 0;
  const now = new Date("2026-08-01T12:00:06.000Z");
  const service = createProofAssetPublicationService({
    now: () => now,
    runtimeConfig: () => ({
      enabled: true,
      bucket_name: record.bucket_name,
      delivery_base_url: "https://go.vornan.co",
      allowed_order_numbers: [record.order_number],
      activation_expires_at: "2026-08-01T14:00:00.000Z"
    }),
    getRecord: async () => record,
    transition: async (_current, next) => {
      record = next;
      return record;
    },
    s3: {
      async send(command) {
        commands.push(command);
        if (command instanceof CopyObjectCommand) {
          return command.input.Key === record.outbound_key
            ? { VersionId: "outbound-version-1" }
            : { VersionId: "locator-version-1" };
        }
        headCount += 1;
        if (headCount === 2) {
          const error = new Error("not found") as Error & {
            $metadata: { httpStatusCode: number };
          };
          error.$metadata = { httpStatusCode: 404 };
          throw error;
        }
        return {
          ContentLength: 8192,
          ContentType: "application/pdf",
          ChecksumSHA256: encodedDigest
        };
      }
    },
    fetchDirect: async () => new Response(new Uint8Array(8192), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-length": "8192"
      }
    })
  });

  const result = await service.publishCleared({
    order_number: record.order_number,
    asset_id: record.asset_id,
    correlation_id: "publication-runtime-test"
  });
  assert.equal(result.status, "ready");
  assert.equal(record.state, "ready_for_lift");
  assert.equal(record.publication_status, "delivery_verified");
  assert.equal(record.outbound_object_version_id, "outbound-version-1");
  assert.equal(record.lift_not_before_epoch, 1_785_585_608);
  assert.equal(commands.filter((command) => command instanceof CopyObjectCommand).length, 2);
  const locatorCopy = commands.find(
    (command) =>
      command instanceof CopyObjectCommand &&
      String(command.input.Key).startsWith("a/plocator_")
  ) as CopyObjectCommand;
  assert.match(String(locatorCopy.input.CopySource), /versionId=outbound-version-1/);
  assert.match(
    String(locatorCopy.input.Key),
    /^a\/plocator_[a-f0-9]{64}\/Revised Artwork\.pdf$/
  );
  assert.equal(
    locatorCopy.input.ContentDisposition,
    'inline; filename="Revised Artwork.pdf"'
  );
  assert.equal(JSON.stringify(result).includes("go.vornan.co"), false);
});

test("denies publication before storage or delivery when the separate gate is dark", async () => {
  let calls = 0;
  const service = createProofAssetPublicationService({
    runtimeConfig: () => ({
      enabled: false,
      bucket_name: null,
      delivery_base_url: null,
      allowed_order_numbers: [],
      activation_expires_at: null
    }),
    getRecord: async () => {
      calls += 1;
      return null;
    }
  });
  await assert.rejects(
    () => service.publishCleared({
      order_number: "A0226753",
      asset_id: `passet_${"a".repeat(64)}`,
      correlation_id: "publication-dark"
    }),
    (error: unknown) =>
      error instanceof ProofAssetVerificationPublicationError &&
      error.code === "publication_failed"
  );
  assert.equal(calls, 0);
});

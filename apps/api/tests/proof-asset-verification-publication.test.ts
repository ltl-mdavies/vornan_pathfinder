import assert from "node:assert/strict";
import test from "node:test";
import type { ProofAuditEvent } from "@pathfinder/proof-domain";
import {
  beginProofAssetUpload,
  completeProofAssetUpload,
  createProofAssetUploadRecord,
  type ProofAssetUploadRecord
} from "@pathfinder/proof-domain/proof-asset-upload";
import {
  createProofAssetVerificationPublicationService,
  ProofAssetVerificationPublicationError,
  type ProofAssetScanObservation,
  type ProofAssetVerificationPublicationDependencies
} from "../src/proof/asset-verification-publication.ts";

const bucket = "vornan-pathfinder-proof-assets-dev-744016783602";
const sourceVersion = "3/L4kqtJlcpXroDTDmJ+sourceVersion=";
const outboundVersion = "3/L4kqtJlcpXroDTDmJ+outboundVersion=";
const digest = "d".repeat(64);

function uploadedRecord() {
  const initialized = createProofAssetUploadRecord({
    asset_id: `passet_${"a".repeat(64)}`,
    revision_id: `prevision_${"b".repeat(64)}`,
    publication_id: `ppublication_${"c".repeat(64)}`,
    bucket_name: bucket,
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
  const uploading = beginProofAssetUpload({
    record: initialized,
    expected_record_version: 1,
    upload_started_at: "2026-08-01T12:00:01.000Z"
  }).record;
  return completeProofAssetUpload({
    record: uploading,
    expected_record_version: 2,
    upload_completed_at: "2026-08-01T12:00:02.000Z",
    source_object_version_id: sourceVersion,
    source_content_type: "application/pdf",
    source_content_length: 8192,
    source_sha256: digest
  }).record;
}

function observation(
  record: ProofAssetUploadRecord,
  scanResult: ProofAssetScanObservation["scan_result"] = "NO_THREATS_FOUND"
): ProofAssetScanObservation {
  return {
    schema_version: "1.0",
    event_id: "72c7d362-737a-6dce-fc78-9e27a0171419",
    occurred_at: "2026-08-01T12:00:08.000Z",
    bucket_name: record.bucket_name,
    object_key: record.source_key,
    object_version_id: sourceVersion,
    scan_result: scanResult
  };
}

function harness(initial = uploadedRecord()) {
  let record = initial;
  const audits: ProofAuditEvent[] = [];
  const lifecycles: string[] = [];
  const publications: Array<Record<string, unknown>> = [];
  const locators: Array<Record<string, unknown>> = [];
  let delivery = {
    observed_at: "2026-08-01T12:00:11.000Z",
    status: 200,
    redirected: false,
    content_type: "application/pdf",
    content_length: 8192
  };
  const dependencies: ProofAssetVerificationPublicationDependencies = {
    async getRecord() {
      return record;
    },
    async transition(current, next, audit) {
      assert.equal(current.record_version + 1, next.record_version);
      audits.push(audit);
      record = next;
      return record;
    },
    async setSourceLifecycle(input) {
      lifecycles.push(input.lifecycle);
    },
    async publishExact(input) {
      publications.push(input);
      return {
        object_version_id: outboundVersion,
        content_length: 8192,
        sha256: digest,
        published_at: "2026-08-01T12:00:09.000Z"
      };
    },
    async registerLocator(input) {
      locators.push(input);
      return {
        locator_id: input.locator_id,
        delivery_url: `https://go.vornan.co/a/${input.locator_id}`
      };
    },
    async verifyDirectDelivery() {
      return delivery;
    }
  };
  return {
    service: createProofAssetVerificationPublicationService(dependencies),
    record: () => record,
    audits,
    lifecycles,
    publications,
    locators,
    setDelivery(value: typeof delivery) {
      delivery = value;
    }
  };
}

test("durably classifies one exact clean GuardDuty object and replays without new transitions", async () => {
  const run = harness();
  const event = observation(run.record());
  const result = await run.service.observeScan(event);
  assert.equal(result.asset.state, "scan_pending");
  assert.equal(result.asset.verification_status, "cleared");
  assert.equal(result.asset.malware_scan_status, "no_threats_found");
  assert.deepEqual(run.lifecycles, ["retained-source"]);
  assert.deepEqual(
    run.audits.map((audit) => audit.action),
    [
      "proof.asset_verification_started",
      "proof.asset_scan_started",
      "proof.asset_scan_completed"
    ]
  );
  assert.ok(run.audits.every((audit) => audit.actor_id === "system_proof_asset_worker"));

  const auditCount = run.audits.length;
  await run.service.observeScan({
    ...event,
    event_id: "82c7d362-737a-6dce-fc78-9e27a0171419"
  });
  assert.equal(run.audits.length, auditCount);
  assert.deepEqual(run.lifecycles, ["retained-source"]);
});

test("quarantines every non-clear GuardDuty result and never starts publication", async () => {
  for (const result of ["THREATS_FOUND", "UNSUPPORTED", "ACCESS_DENIED", "FAILED"] as const) {
    const run = harness();
    const observed = await run.service.observeScan(observation(run.record(), result));
    assert.equal(observed.asset.verification_status, "quarantined");
    assert.deepEqual(run.lifecycles, ["quarantined"]);
    await assert.rejects(
      () => run.service.publishCleared({
        order_number: run.record().order_number,
        asset_id: run.record().asset_id,
        correlation_id: `publication-${result}`
      }),
      (error: unknown) =>
        error instanceof ProofAssetVerificationPublicationError &&
        error.code === "publication_failed"
    );
    assert.equal(run.publications.length, 0);
  }
});

test("fails closed on a changed source version or conflicting scan replay", async () => {
  const run = harness();
  await assert.rejects(
    () => run.service.observeScan({
      ...observation(run.record()),
      object_version_id: "3/L4kqtJlcpXroDTDmJ+differentVersion="
    }),
    (error: unknown) =>
      error instanceof ProofAssetVerificationPublicationError &&
      error.code === "cross_bound"
  );
  await run.service.observeScan(observation(run.record()));
  await assert.rejects(
    () => run.service.observeScan(observation(run.record(), "THREATS_FOUND")),
    (error: unknown) =>
      error instanceof ProofAssetVerificationPublicationError &&
      error.code === "conflict"
  );
});

test("publishes a byte-identical copy, registers one opaque locator, and records direct delivery", async () => {
  const run = harness();
  await run.service.observeScan(observation(run.record()));
  const result = await run.service.publishCleared({
    order_number: run.record().order_number,
    asset_id: run.record().asset_id,
    correlation_id: "publication-synthetic-001"
  });
  assert.equal(result.status, "ready");
  assert.equal(result.asset.state, "ready_for_lift");
  assert.equal(result.asset.publication_status, "delivery_verified");
  assert.match(result.asset.delivery_locator_id ?? "", /^plocator_[a-f0-9]{64}$/);
  assert.equal(result.asset.lift_not_before_epoch, 1_785_585_613);
  assert.equal(run.publications.length, 1);
  assert.equal(run.locators.length, 1);
  assert.equal(run.locators[0]?.outbound_key, run.record().outbound_key);
  assert.equal(JSON.stringify(result).includes("https://"), false);
  assert.deepEqual(
    run.audits.slice(-2).map((audit) => audit.action),
    ["proof.asset_published", "proof.asset_delivery_verified"]
  );

  const replay = await run.service.publishCleared({
    order_number: run.record().order_number,
    asset_id: run.record().asset_id,
    correlation_id: "publication-synthetic-001"
  });
  assert.equal(replay.status, "replay");
  assert.equal(run.publications.length, 1);
  assert.equal(run.locators.length, 1);
});

test("retains a published-but-unready record when delivery redirects", async () => {
  const run = harness();
  await run.service.observeScan(observation(run.record()));
  run.setDelivery({
    observed_at: "2026-08-01T12:00:11.000Z",
    status: 302,
    redirected: true,
    content_type: "text/html",
    content_length: 0
  });
  await assert.rejects(
    () => run.service.publishCleared({
      order_number: run.record().order_number,
      asset_id: run.record().asset_id,
      correlation_id: "publication-redirected"
    }),
    (error: unknown) =>
      error instanceof ProofAssetVerificationPublicationError &&
      error.code === "delivery_failed"
  );
  assert.equal(run.record().state, "scan_pending");
  assert.equal(run.record().publication_status, "published");
});

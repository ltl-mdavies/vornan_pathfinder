import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import type { ProofAuditEvent, ProofOrder } from "@pathfinder/proof-domain";
import type { ProofAssetUploadRecord } from "@pathfinder/proof-domain/proof-asset-upload";
import type { ProofAssetUploadRuntimeConfig } from "../src/proof/asset-upload-config.ts";
import type {
  ProofAssetScanObservation,
  ProofAssetVerificationPublicationDependencies
} from "../src/proof/asset-verification-publication.ts";
import type { ProofAssetScanWorkerConfig } from "../src/proof/asset-scan-worker.ts";

const NOW = new Date("2026-08-02T12:00:00.000Z");
const SCANNED_AT = "2026-08-02T12:00:08.000Z";
const BUCKET = "vornan-pathfinder-proof-assets-dev-744016783602";
const ORDER_NUMBER = "A0000000";
const TASK_ID = "ptask_scan_evidence_synthetic";
const ATTACHMENT_ID = "proofing-scan-evidence-synthetic";
const PROOF_VERSION_ID = "pversion-scan-evidence-synthetic";
const SOURCE_VERSION = "synthetic-source-version=1";
const ACCOUNT_ID = "744016783602";
const REGION = "us-east-1";

let testDirectory = "";
let createProofAssetUploadService: typeof import("../src/proof/asset-upload-service.ts")["createProofAssetUploadService"];
let createProofAssetVerificationPublicationService: typeof import("../src/proof/asset-verification-publication.ts")["createProofAssetVerificationPublicationService"];
let createProofAssetScanWorkerHandler: typeof import("../src/proof/asset-scan-worker.ts")["createProofAssetScanWorkerHandler"];
let getProofAssetUploadRecord: typeof import("../src/proof/asset-upload-store.ts")["getProofAssetUploadRecord"];
let transitionProofAssetUpload: typeof import("../src/proof/asset-upload-store.ts")["transitionProofAssetUpload"];
let readLocalProofStore: typeof import("../src/proof/store.ts")["readLocalProofStore"];

const previousEnvironment = {
  runtime: process.env.PATHFINDER_RUNTIME,
  storage: process.env.PATHFINDER_PROOF_STORAGE_DRIVER,
  store: process.env.PATHFINDER_PROOF_LOCAL_STORE_PATH,
  telemetry: process.env.PATHFINDER_PROOF_TELEMETRY_MODE
};

const order: ProofOrder = {
  order_number: ORDER_NUMBER,
  order_title: "Synthetic scan evidence rehearsal",
  customer_id: "1249",
  customer_name: "LTL Demo synthetic fixture",
  order_status: "Pending Art Approval",
  health: "active",
  version: 1,
  lines: [],
  tasks: [{
    task_id: TASK_ID,
    order_line_id: "line-scan-evidence-synthetic",
    line_number: "1",
    attachment_id: ATTACHMENT_ID,
    product_name: "Synthetic scan evidence panel",
    quantity: 1,
    state: "pending",
    actionable: true,
    sibling_index: 0,
    sibling_count: 1,
    version: 1,
    current_version: {
      version_id: PROOF_VERSION_ID,
      attachment_id: ATTACHMENT_ID,
      created_at: "2026-08-02T11:00:00.000Z",
      filename: "synthetic-proof.pdf",
      preview_url: null,
      download_url: null,
      approval_status: null,
      approved_by: null,
      approved_at: null,
      comments: [],
      detailed_report: null,
      feedback_fingerprint: "feedback-scan-evidence-synthetic",
      current: true,
      archived_at: null
    },
    versions: [],
    created_at: "2026-08-02T11:00:00.000Z",
    updated_at: "2026-08-02T11:00:00.000Z",
    archived_at: null
  }],
  archived_tasks: [],
  warnings: [],
  created_at: "2026-08-02T11:00:00.000Z",
  updated_at: "2026-08-02T11:00:00.000Z",
  last_synced_at: "2026-08-02T11:59:00.000Z"
};

before(async () => {
  testDirectory = await mkdtemp(join(tmpdir(), "vornan-proof-scan-evidence-"));
  process.env.PATHFINDER_RUNTIME = "lambda";
  process.env.PATHFINDER_PROOF_STORAGE_DRIVER = "local";
  process.env.PATHFINDER_PROOF_LOCAL_STORE_PATH = join(
    testDirectory,
    "proof-store.json"
  );
  process.env.PATHFINDER_PROOF_TELEMETRY_MODE = "off";

  ({ createProofAssetUploadService } = await import(
    "../src/proof/asset-upload-service.ts"
  ));
  ({ createProofAssetVerificationPublicationService } = await import(
    "../src/proof/asset-verification-publication.ts"
  ));
  ({ createProofAssetScanWorkerHandler } = await import(
    "../src/proof/asset-scan-worker.ts"
  ));
  ({ getProofAssetUploadRecord, transitionProofAssetUpload } = await import(
    "../src/proof/asset-upload-store.ts"
  ));
  ({ readLocalProofStore } = await import("../src/proof/store.ts"));
});

after(async () => {
  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  restore("PATHFINDER_RUNTIME", previousEnvironment.runtime);
  restore("PATHFINDER_PROOF_STORAGE_DRIVER", previousEnvironment.storage);
  restore("PATHFINDER_PROOF_LOCAL_STORE_PATH", previousEnvironment.store);
  restore("PATHFINDER_PROOF_TELEMETRY_MODE", previousEnvironment.telemetry);
  await rm(testDirectory, { recursive: true, force: true });
});

function uploadConfig(): ProofAssetUploadRuntimeConfig {
  return {
    enabled: true,
    bucket_name: BUCKET,
    allowed_customer_id: "1249",
    allowed_order_numbers: [ORDER_NUMBER],
    activation_expires_at: "2026-08-02T15:59:59.000Z",
    maximum_bytes: 1024 * 1024,
    upload_ticket_seconds: 600,
    allowed_content_types: ["application/pdf"]
  };
}

async function seedUploadedAsset(input: {
  idempotency_key: string;
  filename: string;
  sha256: string;
  source_version: string;
}) {
  const prepare = createProofAssetUploadService({
    runtimeConfig: uploadConfig,
    now: () => NOW,
    syncOrder: async () => ({ order, diagnostics: null }) as never,
    createPost: (async () => ({
      url: "https://synthetic.invalid",
      fields: {}
    })) as never
  });
  const prepared = await prepare.prepare({
    request: {
      order_number: ORDER_NUMBER,
      task_id: TASK_ID,
      attachment_id: ATTACHMENT_ID,
      idempotency_key: input.idempotency_key,
      original_filename: input.filename,
      content_type: "application/pdf",
      content_length: 8192,
      sha256: input.sha256
    },
    operator_uid: "operator-scan-evidence-synthetic",
    correlation_id: `prepare-${input.idempotency_key}`
  });
  let reads = 0;
  const finalize = createProofAssetUploadService({
    runtimeConfig: uploadConfig,
    now: () => NOW,
    s3: {
      async send() {
        reads += 1;
        if (reads === 1) {
          return {
            VersionId: input.source_version,
            LastModified: new Date("2026-08-02T12:00:05.000Z"),
            ContentType: "application/pdf",
            ContentLength: 8192,
            ChecksumSHA256: Buffer.from(input.sha256, "hex").toString("base64"),
            Metadata: {
              "asset-id": prepared.asset.asset_id,
              "revision-id": prepared.asset.revision_id,
              "attachment-id": ATTACHMENT_ID,
              "declared-sha256": input.sha256
            }
          };
        }
        return {
          TagSet: [{ Key: "proof-lifecycle", Value: "unfinalized" }]
        };
      }
    }
  });
  await finalize.finalize({
    request: {
      order_number: ORDER_NUMBER,
      asset_id: prepared.asset.asset_id
    },
    operator_uid: "operator-scan-evidence-synthetic",
    correlation_id: `finalize-${input.idempotency_key}`
  });
  const record = await getProofAssetUploadRecord(
    ORDER_NUMBER,
    prepared.asset.asset_id
  );
  assert.ok(record);
  assert.equal(record.state, "uploaded");
  return record;
}

function observation(
  record: ProofAssetUploadRecord,
  eventId: string,
  scanResult: ProofAssetScanObservation["scan_result"]
): ProofAssetScanObservation {
  return {
    schema_version: "1.0",
    event_id: eventId,
    occurred_at: SCANNED_AT,
    bucket_name: record.bucket_name,
    object_key: record.source_key,
    object_version_id: record.source_object_version_id!,
    scan_result: scanResult
  };
}

function queueBody(value: ProofAssetScanObservation) {
  return JSON.stringify({
    account: ACCOUNT_ID,
    region: REGION,
    observation: value
  });
}

function workerConfig(record: ProofAssetUploadRecord): ProofAssetScanWorkerConfig {
  return {
    enabled: true,
    account_id: ACCOUNT_ID,
    region: REGION,
    bucket_name: record.bucket_name,
    allowed_object_key: record.source_key,
    expires_at: "2026-08-02T15:59:59.000Z"
  };
}

function evidenceHarness(record: ProofAssetUploadRecord) {
  const lifecycles: Array<{
    asset_id: string;
    object_version_id: string;
    lifecycle: "quarantined" | "retained-source";
  }> = [];
  let publicationCalls = 0;
  const unavailable = async () => {
    publicationCalls += 1;
    throw new Error("Publication must remain unavailable in scan evidence rehearsal.");
  };
  const dependencies: ProofAssetVerificationPublicationDependencies = {
    getRecord: getProofAssetUploadRecord,
    transition: transitionProofAssetUpload,
    async setSourceLifecycle(input) {
      assert.equal(input.record.asset_id, record.asset_id);
      assert.equal(input.object_version_id, record.source_object_version_id);
      lifecycles.push({
        asset_id: input.record.asset_id,
        object_version_id: input.object_version_id,
        lifecycle: input.lifecycle
      });
    },
    publishExact: unavailable,
    registerLocator: unavailable,
    verifyDirectDelivery: unavailable
  } as ProofAssetVerificationPublicationDependencies;
  const service = createProofAssetVerificationPublicationService(dependencies);
  const handler = createProofAssetScanWorkerHandler(
    { observeScan: service.observeScan, now: () => NOW.getTime() },
    () => workerConfig(record)
  );
  return {
    handler,
    lifecycles,
    publicationCalls: () => publicationCalls
  };
}

async function assetAudits(assetId: string) {
  const store = await readLocalProofStore();
  return Object.values(store.audit_events)
    .filter((event) => event.metadata.proof_asset_id === assetId)
    .sort((left, right) => left.occurred_at.localeCompare(right.occurred_at));
}

function assertSanitizedEvidence(
  output: unknown,
  audits: ProofAuditEvent[],
  record: ProofAssetUploadRecord,
  eventId: string
) {
  const serialized = JSON.stringify({ output, audits });
  for (const forbidden of [
    record.source_key,
    record.source_object_version_id!,
    eventId,
    "https://",
    "authorization",
    "credential",
    record.declared_sha256
  ]) {
    assert.equal(serialized.toLowerCase().includes(forbidden.toLowerCase()), false);
  }
}

test("rehearses one exact clear worker observation through durable local evidence", async () => {
  const sourceSha = "a".repeat(64);
  const record = await seedUploadedAsset({
    idempotency_key: "proof-scan-evidence-clear-0001",
    filename: "Synthetic Clear Evidence.pdf",
    sha256: sourceSha,
    source_version: SOURCE_VERSION
  });
  const eventId = "scan-evidence-clear-0001";
  const observed = observation(record, eventId, "NO_THREATS_FOUND");
  const run = evidenceHarness(record);
  const output = await run.handler({
    Records: [{ messageId: "message-clear-0001", body: queueBody(observed) }]
  });
  assert.deepEqual(output, { batchItemFailures: [] });

  const cleared = await getProofAssetUploadRecord(ORDER_NUMBER, record.asset_id);
  assert.ok(cleared);
  assert.equal(cleared.state, "scan_pending");
  assert.equal(cleared.verification_status, "cleared");
  assert.equal(cleared.malware_scan_status, "no_threats_found");
  assert.equal(
    cleared.scan_evidence_sha256,
    "9acf2884dd6b9c4339af633a2928e2125bc188d4f729000c4ca5ecf25a42baf2"
  );
  assert.deepEqual(run.lifecycles, [{
    asset_id: record.asset_id,
    object_version_id: SOURCE_VERSION,
    lifecycle: "retained-source"
  }]);

  const audits = await assetAudits(record.asset_id);
  assert.deepEqual(
    audits.map((event) => event.action),
    [
      "proof.asset_upload_initialized",
      "proof.asset_upload_started",
      "proof.asset_upload_completed",
      "proof.asset_verification_started",
      "proof.asset_scan_started",
      "proof.asset_scan_completed"
    ]
  );
  assertSanitizedEvidence(output, audits, record, eventId);
  assert.equal(run.publicationCalls(), 0);

  const auditCount = audits.length;
  const replay = await run.handler({
    Records: [{
      messageId: "message-clear-replay",
      body: queueBody({ ...observed, event_id: "scan-evidence-clear-replay" })
    }]
  });
  assert.deepEqual(replay, { batchItemFailures: [] });
  assert.equal((await assetAudits(record.asset_id)).length, auditCount);
  assert.equal(run.lifecycles.length, 1);
  assert.equal(run.publicationCalls(), 0);
});

test("fails cross-bound and conflicting scan observations without new transitions", async () => {
  const record = await seedUploadedAsset({
    idempotency_key: "proof-scan-evidence-conflict-0001",
    filename: "Synthetic Conflict Evidence.pdf",
    sha256: "b".repeat(64),
    source_version: "synthetic-source-version=2"
  });
  const run = evidenceHarness(record);
  const clean = observation(record, "scan-evidence-conflict-base", "NO_THREATS_FOUND");
  assert.deepEqual(
    await run.handler({
      Records: [{ messageId: "message-conflict-base", body: queueBody(clean) }]
    }),
    { batchItemFailures: [] }
  );
  const auditCount = (await assetAudits(record.asset_id)).length;

  for (const [messageId, changed] of [
    ["message-wrong-key", { ...clean, object_key: `${clean.object_key}.changed` }],
    ["message-wrong-version", { ...clean, object_version_id: "synthetic-source-version=other" }],
    ["message-wrong-result", { ...clean, scan_result: "THREATS_FOUND" as const }]
  ] as const) {
    assert.deepEqual(
      await run.handler({
        Records: [{ messageId, body: queueBody(changed) }]
      }),
      { batchItemFailures: [{ itemIdentifier: messageId }] }
    );
  }

  assert.equal((await assetAudits(record.asset_id)).length, auditCount);
  assert.equal(run.lifecycles.length, 1);
  assert.equal(run.publicationCalls(), 0);
});

test("quarantines a threat result and never reaches publication dependencies", async () => {
  const record = await seedUploadedAsset({
    idempotency_key: "proof-scan-evidence-threat-0001",
    filename: "Synthetic Threat Evidence.pdf",
    sha256: "c".repeat(64),
    source_version: "synthetic-source-version=3"
  });
  const eventId = "scan-evidence-threat-0001";
  const run = evidenceHarness(record);
  const output = await run.handler({
    Records: [{
      messageId: "message-threat-0001",
      body: queueBody(observation(record, eventId, "THREATS_FOUND"))
    }]
  });
  assert.deepEqual(output, { batchItemFailures: [] });

  const quarantined = await getProofAssetUploadRecord(ORDER_NUMBER, record.asset_id);
  assert.ok(quarantined);
  assert.equal(quarantined.state, "scan_pending");
  assert.equal(quarantined.verification_status, "quarantined");
  assert.equal(quarantined.malware_scan_status, "threats_found");
  assert.equal(quarantined.quarantine_reason, "threats_found");
  assert.deepEqual(run.lifecycles, [{
    asset_id: record.asset_id,
    object_version_id: "synthetic-source-version=3",
    lifecycle: "quarantined"
  }]);
  const audits = await assetAudits(record.asset_id);
  assertSanitizedEvidence(output, audits, record, eventId);
  assert.equal(run.publicationCalls(), 0);
});

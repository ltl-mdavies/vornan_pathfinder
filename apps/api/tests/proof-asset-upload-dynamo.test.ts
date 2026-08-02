import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  DynamoDBClient,
  GetItemCommand,
  TransactWriteItemsCommand,
  type AttributeValue
} from "@aws-sdk/client-dynamodb";
import test, { after, before, beforeEach } from "node:test";
import type { ProofAuditEvent } from "@pathfinder/proof-domain";
import {
  beginProofAssetScan,
  beginProofAssetVerification,
  beginProofAssetUpload,
  completeProofAssetUpload,
  completeProofAssetVerification,
  createProofAssetUploadRecord,
  recordProofAssetDeliveryVerification,
  recordProofAssetPublication,
  type ProofAssetUploadRecord
} from "@pathfinder/proof-domain/proof-asset-upload";

type Command = GetItemCommand | TransactWriteItemsCommand;
const commands: Command[] = [];
let storedCore: Record<string, AttributeValue> | undefined;
const storedAudits = new Map<string, Record<string, AttributeValue>>();
const prototype = DynamoDBClient.prototype as unknown as {
  send(command: Command): Promise<unknown>;
};
const originalSend = prototype.send;
let reserve: typeof import("../src/proof/asset-upload-store.ts")["reserveProofAssetUpload"];
let transition: typeof import("../src/proof/asset-upload-store.ts")["transitionProofAssetUpload"];
let getRecord: typeof import("../src/proof/asset-upload-store.ts")["getProofAssetUploadRecord"];

const record = createProofAssetUploadRecord({
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
  declared_sha256: "d".repeat(64),
  order_completed_at: null,
  last_proof_activity_at: "2026-08-01T11:59:00.000Z",
  initialized_at: "2026-08-01T12:00:00.000Z"
});

function audit(value: ProofAssetUploadRecord): ProofAuditEvent {
  const actions = [
    "proof.asset_upload_initialized",
    "proof.asset_upload_started",
    "proof.asset_upload_completed",
    "proof.asset_verification_started",
    "proof.asset_scan_started",
    "proof.asset_scan_completed",
    "proof.asset_published",
    "proof.asset_delivery_verified"
  ] as const;
  const action = actions[value.record_version - 1];
  assert.ok(action);
  const system = value.record_version >= 4;
  return {
    event_id: `paudit_asset-${createHash("sha256")
      .update(value.asset_id)
      .update("\0")
      .update(value.state)
      .update("\0")
      .update(String(value.record_version))
      .update("\0")
      .digest("hex")}`,
    occurred_at: value.updated_at,
    action,
    outcome: "succeeded",
    order_number: value.order_number,
    task_id: value.task_id,
    order_line_id: null,
    attachment_id: value.attachment_id,
    grant_id: null,
    participant_id: null,
    actor_type: system ? "system" : "operator",
    actor_id: system ? "system_proof_asset_worker" : `operator_${"d".repeat(64)}`,
    correlation_id: `pcorr_asset_${"f".repeat(64)}`,
    metadata: {
      source: system ? "system" : "operator",
      proof_asset_id: value.asset_id,
      proof_asset_state: value.state
    }
  };
}

before(async () => {
  process.env.PATHFINDER_RUNTIME = "lambda";
  process.env.PATHFINDER_PROOF_STORAGE_DRIVER = "dynamodb";
  process.env.PATHFINDER_PROOF_CORE_TABLE = "Pathfinder-ProofCore-assets";
  process.env.PATHFINDER_PROOF_AUDIT_TABLE = "Pathfinder-ProofAudit-assets";
  prototype.send = async (command) => {
    commands.push(command);
    if (command instanceof GetItemCommand) {
      return {
        Item:
          command.input.TableName === "Pathfinder-ProofAudit-assets"
            ? storedAudits.get(command.input.Key?.sk?.S ?? "")
            : storedCore
      };
    }
    const firstPut = command.input.TransactItems?.[0]?.Put;
    if (
      firstPut?.ConditionExpression?.includes("attribute_not_exists") &&
      storedCore
    ) {
      const error = new Error("synthetic transaction cancellation");
      error.name = "TransactionCanceledException";
      throw error;
    }
    storedCore = command.input.TransactItems?.[0]?.Put?.Item;
    const auditItem = command.input.TransactItems?.[1]?.Put?.Item;
    if (auditItem?.sk?.S) storedAudits.set(auditItem.sk.S, auditItem);
    return {};
  };
  const module = await import("../src/proof/asset-upload-store.ts");
  reserve = module.reserveProofAssetUpload;
  transition = module.transitionProofAssetUpload;
  getRecord = module.getProofAssetUploadRecord;
});

beforeEach(() => {
  commands.length = 0;
  storedCore = undefined;
  storedAudits.clear();
});

after(() => {
  prototype.send = originalSend;
});

test("atomically reserves exactly one ProofCore asset and one retained audit", async () => {
  await reserve(record, audit(record));
  const transaction = (commands[0] as TransactWriteItemsCommand).input;
  assert.equal(transaction.TransactItems?.length, 2);
  const core = transaction.TransactItems?.[0]?.Put;
  const auditPut = transaction.TransactItems?.[1]?.Put;
  assert.equal(core?.TableName, "Pathfinder-ProofCore-assets");
  assert.equal(core?.Item?.pk?.S, "ORDER#A0226753");
  assert.equal(core?.Item?.sk?.S, `PROOF_ASSET#${record.asset_id}`);
  assert.equal(core?.Item?.asset_state?.S, "initialized");
  assert.equal(core?.Item?.record_version?.N, "1");
  assert.equal(auditPut?.TableName, "Pathfinder-ProofAudit-assets");
  assert.equal("ttl_epoch" in (core?.Item ?? {}), false);
  assert.equal("ttl_epoch" in (auditPut?.Item ?? {}), false);
});

test("conditionally records upload start before a presigned ticket can be returned", async () => {
  await reserve(record, audit(record));
  commands.length = 0;
  const started = beginProofAssetUpload({
    record,
    expected_record_version: 1,
    upload_started_at: "2026-08-01T12:00:01.000Z"
  }).record;
  await transition(record, started, audit(started));
  const transaction = (commands[0] as TransactWriteItemsCommand).input;
  const core = transaction.TransactItems?.[0]?.Put;
  assert.equal(core?.ConditionExpression, "asset_state = :state AND record_version = :version");
  assert.equal(core?.ExpressionAttributeValues?.[":state"]?.S, "initialized");
  assert.equal(core?.ExpressionAttributeValues?.[":version"]?.N, "1");
  assert.equal(core?.Item?.asset_state?.S, "uploading");
  assert.equal(core?.Item?.record_version?.N, "2");
});

test("replays only when the retained initialization audit is present and exact", async () => {
  await reserve(record, audit(record));
  const replay = await reserve(record, audit(record));
  assert.equal(replay.status, "replay");
  assert.ok(commands.filter((command) => command instanceof GetItemCommand).length >= 2);

  storedAudits.clear();
  await assert.rejects(
    () => reserve(record, audit(record)),
    (error: unknown) =>
      error instanceof Error &&
      error.name === "ProofAssetUploadStoreError" &&
      error.message.includes("retained audit trail")
  );
});

test("requires the complete retained milestone audit trail on reads", async () => {
  await reserve(record, audit(record));
  const started = beginProofAssetUpload({
    record,
    expected_record_version: 1,
    upload_started_at: "2026-08-01T12:00:01.000Z"
  }).record;
  await transition(record, started, audit(started));
  const valid = await getRecord(record.order_number, record.asset_id);
  assert.equal(valid?.state, "uploading");

  const startedAudit = audit(started);
  storedAudits.delete(`${startedAudit.occurred_at}#${startedAudit.event_id}`);
  await assert.rejects(
    () => getRecord(record.order_number, record.asset_id),
    (error: unknown) =>
      error instanceof Error &&
      error.name === "ProofAssetUploadStoreError" &&
      error.message.includes("retained audit trail")
  );
});

test("atomically retains every verification, publication, and delivery milestone", async () => {
  await reserve(record, audit(record));
  let current = beginProofAssetUpload({
    record,
    expected_record_version: 1,
    upload_started_at: "2026-08-01T12:00:01.000Z"
  }).record;
  await transition(record, current, audit(current));

  let next = completeProofAssetUpload({
    record: current,
    expected_record_version: 2,
    upload_completed_at: "2026-08-01T12:00:02.000Z",
    source_object_version_id: "3/L4kqtJlcpXroDTDmJ+sourceVersion=",
    source_content_type: "application/pdf",
    source_content_length: 8192,
    source_sha256: "d".repeat(64)
  }).record;
  await transition(current, next, audit(next));
  current = next;

  next = beginProofAssetVerification({
    record: current,
    expected_record_version: 3,
    verification_started_at: "2026-08-01T12:00:08.000Z"
  }).record;
  await transition(current, next, audit(next));
  current = next;

  next = beginProofAssetScan({
    record: current,
    expected_record_version: 4,
    scan_started_at: "2026-08-01T12:00:08.000Z"
  }).record;
  await transition(current, next, audit(next));
  current = next;

  next = completeProofAssetVerification({
    record: current,
    expected_record_version: 5,
    scan_completed_at: "2026-08-01T12:00:08.000Z",
    scan_status: "no_threats_found",
    scan_evidence_sha256: "1".repeat(64)
  }).record;
  await transition(current, next, audit(next));
  current = next;

  next = recordProofAssetPublication({
    record: current,
    expected_record_version: 6,
    published_at: "2026-08-01T12:00:09.000Z",
    outbound_object_version_id: "3/L4kqtJlcpXroDTDmJ+outboundVersion=",
    outbound_content_length: 8192,
    outbound_sha256: "d".repeat(64)
  }).record;
  await transition(current, next, audit(next));
  current = next;

  next = recordProofAssetDeliveryVerification({
    record: current,
    expected_record_version: 7,
    delivery_verified_at: "2026-08-01T12:00:11.000Z",
    delivery_locator_id: `plocator_${"e".repeat(64)}`,
    delivery_host: "go.vornan.co",
    delivery_url_sha256: "f".repeat(64),
    direct_http_status: 200,
    redirected: false,
    observed_content_type: "application/pdf",
    observed_content_length: 8192,
    settle_delay_seconds: 2
  }).record;
  await transition(current, next, audit(next));

  const persisted = await getRecord(record.order_number, record.asset_id);
  assert.equal(persisted?.state, "ready_for_lift");
  assert.equal(persisted?.record_version, 8);
  assert.equal(storedAudits.size, 8);
  assert.equal(
    commands.filter((command) => command instanceof TransactWriteItemsCommand).length,
    8
  );
});

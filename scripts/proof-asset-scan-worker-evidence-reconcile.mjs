import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  SCAN_WORKER_QA,
  evaluateMode
} from "./proof-asset-scan-worker-activation-qa.mjs";

const SOURCE_KEY =
  /^orders\/(A[0-9]{7,8})\/tasks\/([A-Za-z0-9][A-Za-z0-9._:-]{0,255})\/revisions\/(prevision_[a-f0-9]{64})\/source\/(passet_[a-f0-9]{64})\/([A-Za-z0-9][A-Za-z0-9._() -]{0,239})$/;
const VERSION_ID = /^[A-Za-z0-9._~+/=-]{1,1024}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const UTC =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z$/;
const CONTENT_TYPE =
  /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i;
const AUDIT_CORRELATION = /^pcorr_asset_[a-f0-9]{64}$/;
const OPERATOR_ACTOR = /^operator_[a-f0-9]{64}$/;
const SYSTEM_ACTOR = "system_proof_asset_worker";
const ALLOWED_CUSTOMER_ID = "1249";
const PROOF_CORE_TABLE = "Pathfinder-ProofCore-dev";
const PROOF_AUDIT_TABLE = "Pathfinder-ProofAudit-dev";
const REQUIRED_AUDITS = Object.freeze([
  {
    action: "proof.asset_upload_initialized",
    state: "initialized",
    version: 1,
    timestamp: "initialized_at",
    actor_type: "operator"
  },
  {
    action: "proof.asset_upload_started",
    state: "uploading",
    version: 2,
    timestamp: "upload_started_at",
    actor_type: "operator"
  },
  {
    action: "proof.asset_upload_completed",
    state: "uploaded",
    version: 3,
    timestamp: "upload_completed_at",
    actor_type: "operator"
  },
  {
    action: "proof.asset_verification_started",
    state: "verifying",
    version: 4,
    timestamp: "verification_started_at",
    actor_type: "system"
  },
  {
    action: "proof.asset_scan_started",
    state: "scan_pending",
    version: 5,
    timestamp: "scan_started_at",
    actor_type: "system"
  },
  {
    action: "proof.asset_scan_completed",
    state: "scan_pending",
    version: 6,
    timestamp: "scan_completed_at",
    actor_type: "system"
  }
]);

function array(value) {
  return Array.isArray(value) ? value : [];
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function auditEventId(assetId, state, recordVersion) {
  return `paudit_asset-${createHash("sha256")
    .update(assetId)
    .update("\0")
    .update(state)
    .update("\0")
    .update(String(recordVersion))
    .update("\0")
    .digest("hex")}`;
}

function strictUtc(value, label) {
  const parsed = Date.parse(value ?? "");
  if (
    !UTC.test(value ?? "") ||
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString() !== value
  ) {
    throw new Error(`${label} is not an exact UTC timestamp.`);
  }
  return value;
}

function expectedBoundary(input) {
  const match = input?.object_key?.match(SOURCE_KEY);
  if (
    !match ||
    !VERSION_ID.test(input?.object_version_id ?? "") ||
    !SHA256.test(input?.sha256 ?? "")
  ) {
    throw new Error("Exact Proof source key, object version, and SHA-256 are required.");
  }
  strictUtc(input.expires_at, "The worker activation expiry");
  return {
    object_key: input.object_key,
    object_version_id: input.object_version_id,
    sha256: input.sha256,
    expires_at: input.expires_at,
    order_number: match[1],
    task_id: match[2],
    revision_id: match[3],
    asset_id: match[4],
    filename: match[5]
  };
}

function requireEmptyCounts(counts, label) {
  if (
    !counts ||
    ![counts.visible, counts.in_flight, counts.delayed].every(
      (count) => Number.isInteger(count) && count === 0
    )
  ) {
    throw new Error(`${label} must be empty.`);
  }
}

function requireActive(active, expected) {
  if (
    active?.mode !== "active" ||
    active?.status !== "active_verified" ||
    active?.worker_enabled !== true ||
    active?.approved_object_key_sha256 !== sha256(expected.object_key) ||
    active?.expires_at !== expected.expires_at ||
    active?.event_source_mapping_count !== 1 ||
    active?.pathfinder_rule_count !== 1 ||
    active?.customer_capabilities_enabled !== false ||
    active?.upload_enabled !== false ||
    active?.publication_enabled !== false ||
    active?.wrike_write_enabled !== false ||
    active?.live_customer_submit_enabled !== false ||
    active?.lift_called !== false ||
    active?.mutation_performed !== false
  ) {
    throw new Error("The merged scan-worker active boundary is not exact and read-only.");
  }
  requireEmptyCounts(active.queue, "The scan-worker queue");
  requireEmptyCounts(active.dead_letter_queue, "The scan-worker dead-letter queue");
}

function dataItem(value, label) {
  const encoded = value?.Item?.data?.S;
  if (typeof encoded !== "string") {
    throw new Error(`${label} was not found as one exact DynamoDB data item.`);
  }
  let parsed;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    throw new Error(`${label} contains malformed durable JSON.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} contains malformed durable data.`);
  }
  return parsed;
}

function requireRecord(record, expected) {
  const nullablePublicationFields = [
    "outbound_object_version_id",
    "outbound_content_length",
    "outbound_sha256",
    "published_at",
    "delivery_locator_id",
    "delivery_host",
    "delivery_url_sha256",
    "delivery_verified_at",
    "settle_delay_seconds",
    "lift_not_before_epoch"
  ];
  if (
    record.schema_version !== 1 ||
    record.source_kind !== "proof_upload" ||
    record.storage_boundary !== "proof_assets" ||
    record.bucket_name !== SCAN_WORKER_QA.bucket_name ||
    record.order_number !== expected.order_number ||
    record.task_id !== expected.task_id ||
    record.revision_id !== expected.revision_id ||
    record.asset_id !== expected.asset_id ||
    !IDENTIFIER.test(record.attachment_id ?? "") ||
    record.source_key !== expected.object_key ||
    record.source_object_version_id !== expected.object_version_id ||
    record.declared_sha256 !== expected.sha256 ||
    record.source_sha256 !== expected.sha256 ||
    record.state !== "scan_pending" ||
    record.storage_class !== "retained_source" ||
    record.record_version !== 6 ||
    record.verification_status !== "cleared" ||
    record.malware_scan_status !== "no_threats_found" ||
    record.quarantine_reason !== null ||
    !SHA256.test(record.scan_evidence_sha256 ?? "") ||
    record.publication_status !== "not_started" ||
    nullablePublicationFields.some((field) => record[field] !== null) ||
    record.source_content_type !== record.declared_content_type ||
    !CONTENT_TYPE.test(record.source_content_type ?? "") ||
    record.source_content_length !== record.declared_content_length ||
    !Number.isInteger(record.source_content_length) ||
    record.source_content_length < 1 ||
    record.original_filename !== expected.filename ||
    !/^ppublication_[a-f0-9]{64}$/.test(record.publication_id ?? "") ||
    record.outbound_key !==
      `orders/${record.order_number}/tasks/${record.task_id}/revisions/` +
        `${record.revision_id}/outbound/${record.publication_id}/` +
        `${record.original_filename}` ||
    record.packet_memberships?.length !== 0
  ) {
    throw new Error("The durable Proof asset is not the exact cleared pre-publication record.");
  }
  const timestamps = [
    "initialized_at",
    "upload_started_at",
    "upload_completed_at",
    "verification_started_at",
    "scan_started_at",
    "scan_completed_at",
    "cleared_at"
  ];
  for (const field of timestamps) strictUtc(record[field], `Proof asset ${field}`);
  if (record.cleared_at !== record.scan_completed_at) {
    throw new Error("The cleared Proof timestamp does not match scan completion.");
  }
  for (let index = 1; index < timestamps.length - 1; index += 1) {
    if (Date.parse(record[timestamps[index]]) < Date.parse(record[timestamps[index - 1]])) {
      throw new Error("The durable Proof asset lifecycle timestamps are out of order.");
    }
  }
  return record;
}

function requireOrderProfile(profile, record, expected) {
  const matchingTasks = array(profile.tasks).filter(
    (candidate) => candidate?.task_id === expected.task_id
  );
  const task = matchingTasks[0];
  if (
    !Array.isArray(profile.tasks) ||
    !Array.isArray(profile.archived_tasks) ||
    matchingTasks.length !== 1 ||
    profile.order_number !== expected.order_number ||
    profile.customer_id !== ALLOWED_CUSTOMER_ID ||
    !task ||
    task.actionable !== true ||
    task.archived_at !== null ||
    task.attachment_id !== record.attachment_id ||
    task.current_version?.version_id !== record.replaces_proof_version_id ||
    task.current_version?.attachment_id !== record.attachment_id ||
    task.current_version?.current !== true ||
    task.current_version?.archived_at !== null ||
    profile.archived_tasks.some(
      (candidate) => candidate?.task_id === expected.task_id
    )
  ) {
    throw new Error(
      "The Proof order profile is not the exact current LTL Demo attachment boundary."
    );
  }
  return profile;
}

function requireSourceObject(head, tags, record, expected) {
  const metadata = head?.Metadata ?? {};
  const exactMetadataKeys = [
    "asset-id",
    "attachment-id",
    "declared-sha256",
    "revision-id"
  ];
  const tagMap = new Map(
    array(tags?.TagSet).map((tag) => [tag?.Key, tag?.Value])
  );
  if (
    head?.VersionId !== expected.object_version_id ||
    head?.ServerSideEncryption !== "AES256" ||
    head?.ContentType !== record.source_content_type ||
    head?.ContentLength !== record.source_content_length ||
    head?.ChecksumSHA256 !==
      Buffer.from(expected.sha256, "hex").toString("base64") ||
    JSON.stringify(Object.keys(metadata).sort()) !== JSON.stringify(exactMetadataKeys) ||
    metadata["asset-id"] !== record.asset_id ||
    metadata["revision-id"] !== record.revision_id ||
    metadata["attachment-id"] !== record.attachment_id ||
    metadata["declared-sha256"] !== expected.sha256 ||
    tagMap.size !== 2 ||
    tagMap.get("GuardDutyMalwareScanStatus") !== "NO_THREATS_FOUND" ||
    tagMap.get("proof-lifecycle") !== "retained-source"
  ) {
    throw new Error("The exact S3 source version does not match cleared durable evidence.");
  }
}

function requireAudit(audit, milestone, record) {
  const timestamp = record[milestone.timestamp];
  const expectedEventId = auditEventId(
    record.asset_id,
    milestone.state,
    milestone.version
  );
  const validActor =
    milestone.actor_type === "operator"
      ? audit.actor_type === "operator" && OPERATOR_ACTOR.test(audit.actor_id ?? "")
      : audit.actor_type === "system" && audit.actor_id === SYSTEM_ACTOR;
  if (
    audit.event_id !== expectedEventId ||
    audit.occurred_at !== timestamp ||
    audit.action !== milestone.action ||
    audit.outcome !== "succeeded" ||
    audit.order_number !== record.order_number ||
    audit.task_id !== record.task_id ||
    audit.order_line_id !== null ||
    audit.attachment_id !== record.attachment_id ||
    audit.grant_id !== null ||
    audit.participant_id !== null ||
    !validActor ||
    !AUDIT_CORRELATION.test(audit.correlation_id ?? "") ||
    JSON.stringify(Object.keys(audit.metadata ?? {}).sort()) !==
      JSON.stringify(["proof_asset_id", "proof_asset_state", "source"]) ||
    audit.metadata.proof_asset_id !== record.asset_id ||
    audit.metadata.proof_asset_state !== milestone.state ||
    audit.metadata.source !== milestone.actor_type
  ) {
    throw new Error(`The ${milestone.action} audit milestone is malformed or cross-bound.`);
  }
  return audit;
}

function requireAudits(values, record) {
  if (!Array.isArray(values) || values.length !== REQUIRED_AUDITS.length) {
    throw new Error("Exactly six deterministic Proof asset audit milestones are required.");
  }
  const audits = values.map((value, index) =>
    requireAudit(
      dataItem(value, `Proof audit milestone ${index + 1}`),
      REQUIRED_AUDITS[index],
      record
    )
  );
  if (
    new Set(audits.map((audit) => audit.event_id)).size !== audits.length ||
    new Set(audits.map((audit) => audit.action)).size !== audits.length ||
    new Set(audits.slice(3).map((audit) => audit.correlation_id)).size !== 1
  ) {
    throw new Error("The durable Proof asset audit milestones are duplicated or uncorrelated.");
  }
  return audits;
}

export function validateEvidenceSnapshot(snapshot, expectedInput) {
  const expected = expectedBoundary(expectedInput);
  requireActive(snapshot.active, expected);
  const record = requireRecord(
    dataItem(snapshot.core_record, "The Proof core asset record"),
    expected
  );
  requireOrderProfile(
    dataItem(snapshot.order_profile, "The Proof order profile"),
    record,
    expected
  );
  requireAudits(snapshot.audit_records, record);
  requireSourceObject(snapshot.source_head, snapshot.source_tags, record, expected);
  const outboundVersions = array(snapshot.outbound_versions?.Versions);
  const outboundDeleteMarkers = array(snapshot.outbound_versions?.DeleteMarkers);
  if (
    snapshot.outbound_versions?.IsTruncated !== false ||
    snapshot.outbound_versions?.NextToken !== undefined ||
    snapshot.outbound_versions?.NextKeyMarker !== undefined ||
    snapshot.outbound_versions?.NextVersionIdMarker !== undefined ||
    outboundVersions.some((version) => version?.Key === record.outbound_key) ||
    outboundDeleteMarkers.some((marker) => marker?.Key === record.outbound_key)
  ) {
    throw new Error("The exact outbound publication object must remain absent.");
  }
  requireActive(snapshot.active_after, expected);
  if (JSON.stringify(snapshot.active_after) !== JSON.stringify(snapshot.active)) {
    throw new Error("The scan-worker active boundary changed during reconciliation.");
  }
  return {
    schema_version: 1,
    mode: "reconcile",
    status: "scan_evidence_reconciled",
    worker_active: true,
    approved_object_key_sha256: sha256(expected.object_key),
    object_version_id_sha256: sha256(expected.object_version_id),
    source_sha256: expected.sha256,
    scan_evidence_sha256: record.scan_evidence_sha256,
    asset_identity_sha256: sha256(record.asset_id),
    initialized_at: record.initialized_at,
    scan_completed_at: record.scan_completed_at,
    expires_at: expected.expires_at,
    audit_milestone_count: REQUIRED_AUDITS.length,
    source_version_verified: true,
    source_tags_verified: true,
    outbound_object_absent: true,
    scan_evidence_recomputed: false,
    queue: snapshot.active.queue,
    dead_letter_queue: snapshot.active.dead_letter_queue,
    customer_capabilities_enabled: false,
    upload_enabled: false,
    publication_enabled: false,
    wrike_write_enabled: false,
    live_customer_submit_enabled: false,
    lift_called: false,
    mutation_performed: false
  };
}

function awsJson(args) {
  const result = spawnSync(
    "aws",
    [...args, "--region", SCAN_WORKER_QA.region, "--output", "json"],
    {
      encoding: "utf8",
      env: { ...process.env, AWS_MAX_ATTEMPTS: "1", AWS_RETRY_MODE: "standard" }
    }
  );
  if (result.status !== 0) {
    throw new Error(`AWS read failed for ${args[0]} ${args[1] ?? ""}.`);
  }
  const output = result.stdout.trim();
  return output ? JSON.parse(output) : {};
}

function stackParameters() {
  const result = awsJson([
    "cloudformation",
    "describe-stacks",
    "--stack-name",
    SCAN_WORKER_QA.api_stack
  ]);
  const stack = result?.Stacks?.[0];
  if (
    stack?.StackName !== SCAN_WORKER_QA.api_stack ||
    stack?.StackStatus !== "UPDATE_COMPLETE"
  ) {
    throw new Error("The API stack is not settled for evidence reconciliation.");
  }
  const parameters = new Map(
    array(stack.Parameters).map((parameter) => [
      parameter.ParameterKey,
      parameter.ParameterValue
    ])
  );
  if (
    parameters.get("ProofCoreTableName") !== PROOF_CORE_TABLE ||
    parameters.get("ProofAuditTableName") !== PROOF_AUDIT_TABLE
  ) {
    throw new Error("The API stack is not bound to the exact Proof QA tables.");
  }
  return parameters;
}

function dynamoGet(tableName, pk, sk) {
  if (!/^[A-Za-z0-9_.-]{3,255}$/.test(tableName ?? "")) {
    throw new Error("The Proof table name is invalid.");
  }
  return awsJson([
    "dynamodb",
    "get-item",
    "--table-name",
    tableName,
    "--consistent-read",
    "--key",
    JSON.stringify({ pk: { S: pk }, sk: { S: sk } })
  ]);
}

function environmentExpected(env) {
  return {
    object_key:
      env.PATHFINDER_PROOF_SCAN_WORKER_ALLOWED_OBJECT_KEY?.trim() ?? "",
    expires_at: env.PATHFINDER_PROOF_SCAN_WORKER_EXPIRES_AT?.trim() ?? "",
    object_version_id:
      env.PATHFINDER_PROOF_SCAN_EVIDENCE_OBJECT_VERSION_ID?.trim() ?? "",
    sha256: env.PATHFINDER_PROOF_SCAN_EVIDENCE_SHA256?.trim().toLowerCase() ?? ""
  };
}

export function collectEvidenceSnapshot(expectedInput, env = process.env) {
  const expected = expectedBoundary(expectedInput);
  const active = evaluateMode("active", { env });
  const parameters = stackParameters();
  const coreTable = parameters.get("ProofCoreTableName");
  const auditTable = parameters.get("ProofAuditTableName");
  const orderProfile = dynamoGet(
    coreTable,
    `ORDER#${expected.order_number}`,
    "PROFILE"
  );
  const coreRecord = dynamoGet(
    coreTable,
    `ORDER#${expected.order_number}`,
    `PROOF_ASSET#${expected.asset_id}`
  );
  const record = requireRecord(
    dataItem(coreRecord, "The Proof core asset record"),
    expected
  );
  requireOrderProfile(
    dataItem(orderProfile, "The Proof order profile"),
    record,
    expected
  );
  const auditRecords = REQUIRED_AUDITS.map((milestone) =>
    dynamoGet(
      auditTable,
      `ORDER#${record.order_number}`,
      `${record[milestone.timestamp]}#${auditEventId(
        record.asset_id,
        milestone.state,
        milestone.version
      )}`
    )
  );
  return {
    active,
    order_profile: orderProfile,
    core_record: coreRecord,
    audit_records: auditRecords,
    source_head: awsJson([
      "s3api",
      "head-object",
      "--bucket",
      record.bucket_name,
      "--key",
      record.source_key,
      "--version-id",
      expected.object_version_id,
      "--checksum-mode",
      "ENABLED",
      "--expected-bucket-owner",
      SCAN_WORKER_QA.account_id
    ]),
    source_tags: awsJson([
      "s3api",
      "get-object-tagging",
      "--bucket",
      record.bucket_name,
      "--key",
      record.source_key,
      "--version-id",
      expected.object_version_id,
      "--expected-bucket-owner",
      SCAN_WORKER_QA.account_id
    ]),
    outbound_versions: awsJson([
      "s3api",
      "list-object-versions",
      "--bucket",
      record.bucket_name,
      "--prefix",
      record.outbound_key,
      "--expected-bucket-owner",
      SCAN_WORKER_QA.account_id
    ]),
    active_after: evaluateMode("active", { env })
  };
}

export function evaluateEvidence(options = {}) {
  const env = options.env ?? process.env;
  const expected = environmentExpected(env);
  return validateEvidenceSnapshot(
    options.snapshot ?? collectEvidenceSnapshot(expected, env),
    expected
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(evaluateEvidence(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `Proof scan evidence reconciliation failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }\n`
    );
    process.exitCode = 1;
  }
}

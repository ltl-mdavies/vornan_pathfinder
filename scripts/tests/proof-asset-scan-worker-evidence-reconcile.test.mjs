import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  SCAN_WORKER_QA
} from "../proof-asset-scan-worker-activation-qa.mjs";
import {
  validateEvidenceSnapshot
} from "../proof-asset-scan-worker-evidence-reconcile.mjs";

const EXPIRY = "2026-08-02T18:00:00.000Z";
const ORDER = "A0000000";
const TASK = "ptask_scan_evidence_qa";
const ATTACHMENT = "proofing-scan-evidence-qa";
const REVISION = `prevision_${"a".repeat(64)}`;
const ASSET = `passet_${"b".repeat(64)}`;
const PUBLICATION = `ppublication_${"c".repeat(64)}`;
const FILENAME = "Synthetic Scan Evidence.pdf";
const KEY =
  `orders/${ORDER}/tasks/${TASK}/revisions/${REVISION}` +
  `/source/${ASSET}/${FILENAME}`;
const OUTBOUND_KEY =
  `orders/${ORDER}/tasks/${TASK}/revisions/${REVISION}` +
  `/outbound/${PUBLICATION}/${FILENAME}`;
const VERSION = "synthetic-source-version=1";
const SOURCE_SHA = "d".repeat(64);
const SCAN_EVIDENCE = "e".repeat(64);
const TIMESTAMPS = {
  initialized_at: "2026-08-02T12:00:00.000Z",
  upload_started_at: "2026-08-02T12:00:01.000Z",
  upload_completed_at: "2026-08-02T12:00:05.000Z",
  verification_started_at: "2026-08-02T12:00:08.000Z",
  scan_started_at: "2026-08-02T12:00:08.000Z",
  scan_completed_at: "2026-08-02T12:00:09.000Z"
};

const MILESTONES = [
  ["proof.asset_upload_initialized", "initialized", 1, "initialized_at", "operator"],
  ["proof.asset_upload_started", "uploading", 2, "upload_started_at", "operator"],
  ["proof.asset_upload_completed", "uploaded", 3, "upload_completed_at", "operator"],
  ["proof.asset_verification_started", "verifying", 4, "verification_started_at", "system"],
  ["proof.asset_scan_started", "scan_pending", 5, "scan_started_at", "system"],
  ["proof.asset_scan_completed", "scan_pending", 6, "scan_completed_at", "system"]
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function eventId(assetId, state, version) {
  return `paudit_asset-${createHash("sha256")
    .update(assetId)
    .update("\0")
    .update(state)
    .update("\0")
    .update(String(version))
    .update("\0")
    .digest("hex")}`;
}

function item(value) {
  return { Item: { data: { S: JSON.stringify(value) } } };
}

function record() {
  return {
    schema_version: 1,
    asset_id: ASSET,
    revision_id: REVISION,
    publication_id: PUBLICATION,
    source_kind: "proof_upload",
    storage_boundary: "proof_assets",
    bucket_name: SCAN_WORKER_QA.bucket_name,
    order_number: ORDER,
    task_id: TASK,
    attachment_id: ATTACHMENT,
    replaces_proof_version_id: "pversion-scan-evidence-qa",
    original_filename: FILENAME,
    content_policy_id: "proof-revised-art-operator-v1",
    content_policy_max_bytes: 1024 * 1024,
    declared_content_type: "application/pdf",
    declared_content_length: 8192,
    declared_sha256: SOURCE_SHA,
    source_key: KEY,
    outbound_key: OUTBOUND_KEY,
    state: "scan_pending",
    storage_class: "retained_source",
    record_version: 6,
    ...TIMESTAMPS,
    updated_at: TIMESTAMPS.scan_completed_at,
    source_object_version_id: VERSION,
    source_content_type: "application/pdf",
    source_content_length: 8192,
    source_sha256: SOURCE_SHA,
    verification_status: "cleared",
    malware_scan_status: "no_threats_found",
    scan_evidence_sha256: SCAN_EVIDENCE,
    quarantine_reason: null,
    cleared_at: TIMESTAMPS.scan_completed_at,
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
    retention_days: 90,
    order_completed_at: null,
    last_proof_activity_at: "2026-08-02T11:59:00.000Z",
    retention_anchor_at: "2026-08-02T11:59:00.000Z",
    cleanup_eligible_at_epoch: 1_793_616_740,
    legal_hold: false,
    packet_memberships: []
  };
}

function orderProfile() {
  return {
    order_number: ORDER,
    customer_id: "1249",
    tasks: [{
      task_id: TASK,
      actionable: true,
      archived_at: null,
      attachment_id: ATTACHMENT,
      current_version: {
        version_id: "pversion-scan-evidence-qa",
        attachment_id: ATTACHMENT,
        current: true,
        archived_at: null
      }
    }],
    archived_tasks: []
  };
}

function audit(milestone) {
  const [action, state, version, timestampField, actorType] = milestone;
  return {
    event_id: eventId(ASSET, state, version),
    occurred_at: TIMESTAMPS[timestampField],
    action,
    outcome: "succeeded",
    order_number: ORDER,
    task_id: TASK,
    order_line_id: null,
    attachment_id: ATTACHMENT,
    grant_id: null,
    participant_id: null,
    actor_type: actorType,
    actor_id:
      actorType === "operator"
        ? `operator_${"f".repeat(64)}`
        : "system_proof_asset_worker",
    correlation_id:
      actorType === "operator"
        ? `pcorr_asset_${String(version).repeat(64)}`
        : `pcorr_asset_${"9".repeat(64)}`,
    metadata: {
      source: actorType,
      proof_asset_id: ASSET,
      proof_asset_state: state
    }
  };
}

function active() {
  return {
    schema_version: 1,
    mode: "active",
    status: "active_verified",
    worker_enabled: true,
    approved_object_key_sha256: sha256(KEY),
    expires_at: EXPIRY,
    queue: { visible: 0, in_flight: 0, delayed: 0 },
    dead_letter_queue: { visible: 0, in_flight: 0, delayed: 0 },
    customer_capabilities_enabled: false,
    upload_enabled: false,
    publication_enabled: false,
    wrike_write_enabled: false,
    live_customer_submit_enabled: false,
    lift_called: false,
    mutation_performed: false,
    event_source_mapping_count: 1,
    pathfinder_rule_count: 1
  };
}

function snapshot() {
  return {
    active: active(),
    active_after: active(),
    order_profile: item(orderProfile()),
    core_record: item(record()),
    audit_records: MILESTONES.map((milestone) => item(audit(milestone))),
    source_head: {
      VersionId: VERSION,
      ServerSideEncryption: "AES256",
      ContentType: "application/pdf",
      ContentLength: 8192,
      ChecksumSHA256: Buffer.from(SOURCE_SHA, "hex").toString("base64"),
      Metadata: {
        "asset-id": ASSET,
        "attachment-id": ATTACHMENT,
        "declared-sha256": SOURCE_SHA,
        "revision-id": REVISION
      }
    },
    source_tags: {
      TagSet: [
        { Key: "GuardDutyMalwareScanStatus", Value: "NO_THREATS_FOUND" },
        { Key: "proof-lifecycle", Value: "retained-source" }
      ]
    },
    outbound_versions: {
      IsTruncated: false,
      Versions: [],
      DeleteMarkers: []
    }
  };
}

const expected = {
  object_key: KEY,
  object_version_id: VERSION,
  sha256: SOURCE_SHA,
  expires_at: EXPIRY
};

test("reconciles one exact cleared scan without exposing durable identities", () => {
  const result = validateEvidenceSnapshot(snapshot(), expected);
  assert.deepEqual(result, {
    schema_version: 1,
    mode: "reconcile",
    status: "scan_evidence_reconciled",
    worker_active: true,
    approved_object_key_sha256: sha256(KEY),
    object_version_id_sha256: sha256(VERSION),
    source_sha256: SOURCE_SHA,
    scan_evidence_sha256: SCAN_EVIDENCE,
    asset_identity_sha256: sha256(ASSET),
    initialized_at: TIMESTAMPS.initialized_at,
    scan_completed_at: TIMESTAMPS.scan_completed_at,
    expires_at: EXPIRY,
    audit_milestone_count: 6,
    source_version_verified: true,
    source_tags_verified: true,
    outbound_object_absent: true,
    scan_evidence_recomputed: false,
    queue: { visible: 0, in_flight: 0, delayed: 0 },
    dead_letter_queue: { visible: 0, in_flight: 0, delayed: 0 },
    customer_capabilities_enabled: false,
    upload_enabled: false,
    publication_enabled: false,
    wrike_write_enabled: false,
    live_customer_submit_enabled: false,
    lift_called: false,
    mutation_performed: false
  });
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    KEY,
    VERSION,
    FILENAME,
    ORDER,
    TASK,
    ATTACHMENT,
    eventId(ASSET, "scan_pending", 6),
    "https://",
    "metadata"
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("requires all six exact nonduplicated audit milestones", () => {
  const missing = snapshot();
  missing.audit_records.pop();
  assert.throws(
    () => validateEvidenceSnapshot(missing, expected),
    /Exactly six/
  );

  const malformed = snapshot();
  const event = JSON.parse(malformed.audit_records[4].Item.data.S);
  event.actor_id = "system_other";
  malformed.audit_records[4] = item(event);
  assert.throws(
    () => validateEvidenceSnapshot(malformed, expected),
    /malformed or cross-bound/
  );

  const duplicate = snapshot();
  duplicate.audit_records[5] = duplicate.audit_records[4];
  assert.throws(
    () => validateEvidenceSnapshot(duplicate, expected),
    /malformed or cross-bound|duplicated/
  );
});

test("fails closed on substituted source identities, bytes, or stale durable state", () => {
  for (const mutate of [
    (value) => { value.core_record = {}; },
    (value) => { value.source_head.VersionId = "substituted-version"; },
    (value) => { value.source_head.ChecksumSHA256 = Buffer.from("0".repeat(64), "hex").toString("base64"); },
    (value) => {
      const changed = JSON.parse(value.core_record.Item.data.S);
      changed.source_key = `${KEY}.substituted`;
      value.core_record = item(changed);
    },
    (value) => {
      const changed = JSON.parse(value.core_record.Item.data.S);
      changed.record_version = 5;
      value.core_record = item(changed);
    }
  ]) {
    const changed = snapshot();
    mutate(changed);
    assert.throws(() => validateEvidenceSnapshot(changed, expected));
  }
  assert.throws(() => validateEvidenceSnapshot(snapshot(), {
    ...expected,
    object_version_id: "caller-substituted-version"
  }));
  assert.throws(() => validateEvidenceSnapshot(snapshot(), {
    ...expected,
    sha256: "0".repeat(64)
  }));

  for (const mutate of [
    (value) => { value.order_profile = {}; },
    (value) => {
      const changed = orderProfile();
      changed.customer_id = "other-customer";
      value.order_profile = item(changed);
    },
    (value) => {
      const changed = orderProfile();
      changed.tasks[0].current_version.version_id = "stale-version";
      value.order_profile = item(changed);
    },
    (value) => {
      const changed = orderProfile();
      changed.tasks[0].archived_at = "2026-08-02T12:00:10.000Z";
      value.order_profile = item(changed);
    },
    (value) => {
      const changed = orderProfile();
      changed.tasks.push(structuredClone(changed.tasks[0]));
      value.order_profile = item(changed);
    },
    (value) => {
      const changed = orderProfile();
      delete changed.archived_tasks;
      value.order_profile = item(changed);
    },
    (value) => {
      const changed = orderProfile();
      changed.tasks[0].current_version.current = false;
      value.order_profile = item(changed);
    },
    (value) => {
      const changed = orderProfile();
      changed.tasks[0].current_version.archived_at =
        "2026-08-02T12:00:10.000Z";
      value.order_profile = item(changed);
    }
  ]) {
    const changed = snapshot();
    mutate(changed);
    assert.throws(
      () => validateEvidenceSnapshot(changed, expected),
      /order profile|LTL Demo/
    );
  }
});

test("rejects tag, publication, outbound, or queue drift", () => {
  const tagDrift = snapshot();
  tagDrift.source_tags.TagSet[0].Value = "THREATS_FOUND";
  assert.throws(
    () => validateEvidenceSnapshot(tagDrift, expected),
    /S3 source version/
  );

  const publicationDrift = snapshot();
  const published = JSON.parse(publicationDrift.core_record.Item.data.S);
  published.publication_status = "published";
  publicationDrift.core_record = item(published);
  assert.throws(
    () => validateEvidenceSnapshot(publicationDrift, expected),
    /pre-publication/
  );

  const outboundPresent = snapshot();
  outboundPresent.outbound_versions.Versions.push({
    Key: OUTBOUND_KEY,
    VersionId: "unexpected-outbound-version"
  });
  assert.throws(
    () => validateEvidenceSnapshot(outboundPresent, expected),
    /outbound publication object/
  );

  const outboundDeleteMarker = snapshot();
  outboundDeleteMarker.outbound_versions.DeleteMarkers.push({
    Key: OUTBOUND_KEY,
    VersionId: "unexpected-delete-marker"
  });
  assert.throws(
    () => validateEvidenceSnapshot(outboundDeleteMarker, expected),
    /outbound publication object/
  );

  const truncated = snapshot();
  truncated.outbound_versions.IsTruncated = true;
  truncated.outbound_versions.NextKeyMarker = OUTBOUND_KEY;
  assert.throws(
    () => validateEvidenceSnapshot(truncated, expected),
    /outbound publication object/
  );

  const outboundKeyDrift = snapshot();
  const changed = JSON.parse(outboundKeyDrift.core_record.Item.data.S);
  changed.outbound_key = `${OUTBOUND_KEY}.other`;
  outboundKeyDrift.core_record = item(changed);
  assert.throws(
    () => validateEvidenceSnapshot(outboundKeyDrift, expected),
    /pre-publication/
  );

  const queued = snapshot();
  queued.active.queue.visible = 1;
  assert.throws(
    () => validateEvidenceSnapshot(queued, expected),
    /queue must be empty/
  );

  const postureDrift = snapshot();
  postureDrift.active_after.queue.visible = 1;
  assert.throws(
    () => validateEvidenceSnapshot(postureDrift, expected),
    /queue must be empty|changed during reconciliation/
  );
});

test("keeps the reconciler source limited to read-only AWS operations", () => {
  const source = readFileSync(
    new URL("../proof-asset-scan-worker-evidence-reconcile.mjs", import.meta.url),
    "utf8"
  );
  for (const forbidden of [
    /\bput-item\b/,
    /\bupdate-item\b/,
    /\bdelete-item\b/,
    /\btransact-write-items\b/,
    /\bquery\b/,
    /\bscan\b.*--table-name/,
    /\bput-object\b/,
    /\bdelete-object\b/,
    /\bcopy-object\b/,
    /\bget-object\b(?!-tagging)/,
    /secretsmanager/i,
    /filter-log-events|start-query|execute-change-set/i,
    /fetch\s*\(/
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
  assert.match(source, /"dynamodb",\s*\n\s*"get-item"/);
  assert.match(source, /"s3api",\s*\n\s*"head-object"/);
  assert.match(source, /"s3api",\s*\n\s*"get-object-tagging"/);
  assert.match(source, /"s3api",\s*\n\s*"list-object-versions"/);
  assert.equal(
    [...source.matchAll(/"--expected-bucket-owner"/g)].length,
    3
  );
});

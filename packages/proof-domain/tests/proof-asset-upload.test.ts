import assert from "node:assert/strict";
import test from "node:test";
import {
  addProofAssetPacketMembership,
  beginProofAssetScan,
  beginProofAssetUpload,
  beginProofAssetVerification,
  completeProofAssetUpload,
  completeProofAssetVerification,
  createProofAssetUploadRecord,
  ProofAssetUploadError,
  recordProofAssetDeliveryVerification,
  recordProofAssetPublication,
  updateProofAssetRetentionActivity,
  validateProofAssetUploadRecord,
  type ProofAssetUploadRecord
} from "../src/proof-asset-upload.ts";

const assetId = `passet_${"a".repeat(64)}`;
const revisionId = `prevision_${"b".repeat(64)}`;
const publicationId = `ppublication_${"c".repeat(64)}`;
const packetId = `ppacket_${"d".repeat(64)}`;
const locatorId = `plocator_${"e".repeat(64)}`;
const sourceSha256 = "f".repeat(64);
const scanEvidenceSha256 = "1".repeat(64);
const deliveryUrlSha256 = "2".repeat(64);
const sourceObjectVersion = "3/L4kqtJlcpXroDTDmJ+sourceVersion=";
const outboundObjectVersion = "3/L4kqtJlcpXroDTDmJ+outboundVersion=";

function initialized(
  overrides: Partial<Parameters<typeof createProofAssetUploadRecord>[0]> = {}
) {
  return createProofAssetUploadRecord({
    asset_id: assetId,
    revision_id: revisionId,
    publication_id: publicationId,
    bucket_name: "vornan-pathfinder-proof-assets-dev-744016783602",
    order_number: "A0226753",
    task_id: "ptask_synthetic_001",
    attachment_id: "proofing-synthetic-0001",
    replaces_proof_version_id: "pversion-synthetic-001",
    original_filename: "Revised Artwork.pdf",
    content_policy_id: "proof-policy-synthetic-v1",
    content_policy_max_bytes: 1024 * 1024 * 1024,
    allowed_content_types: ["application/pdf"],
    declared_content_type: "application/pdf",
    declared_content_length: 8_192,
    declared_sha256: sourceSha256,
    retention_days: 90,
    order_completed_at: null,
    last_proof_activity_at: "2026-07-28T11:59:00.000Z",
    initialized_at: "2026-07-28T12:00:00.000Z",
    ...overrides
  });
}

function uploading(record = initialized()) {
  return beginProofAssetUpload({
    record,
    expected_record_version: record.record_version,
    upload_started_at: "2026-07-28T12:00:01.000Z"
  }).record;
}

function uploaded(record = uploading()) {
  return completeProofAssetUpload({
    record,
    expected_record_version: record.record_version,
    upload_completed_at: "2026-07-28T12:00:05.000Z",
    source_object_version_id: sourceObjectVersion,
    source_content_type: "application/pdf",
    source_content_length: 8_192,
    source_sha256: sourceSha256
  }).record;
}

function verifying(record = uploaded()) {
  return beginProofAssetVerification({
    record,
    expected_record_version: record.record_version,
    verification_started_at: "2026-07-28T12:00:06.000Z"
  }).record;
}

function scanning(record = verifying()) {
  return beginProofAssetScan({
    record,
    expected_record_version: record.record_version,
    scan_started_at: "2026-07-28T12:00:07.000Z"
  }).record;
}

function cleared(record = scanning()) {
  return completeProofAssetVerification({
    record,
    expected_record_version: record.record_version,
    scan_completed_at: "2026-07-28T12:00:08.000Z",
    scan_status: "no_threats_found",
    scan_evidence_sha256: scanEvidenceSha256
  }).record;
}

function published(record = cleared()) {
  return recordProofAssetPublication({
    record,
    expected_record_version: record.record_version,
    published_at: "2026-07-28T12:00:10.000Z",
    outbound_object_version_id: outboundObjectVersion,
    outbound_content_length: 8_192,
    outbound_sha256: sourceSha256
  }).record;
}

function readyForLift(record = published()) {
  return recordProofAssetDeliveryVerification({
    record,
    expected_record_version: record.record_version,
    delivery_verified_at: "2026-07-28T12:00:12.000Z",
    delivery_locator_id: locatorId,
    delivery_host: "go.vornan.co",
    delivery_url_sha256: deliveryUrlSha256,
    direct_http_status: 200,
    redirected: false,
    observed_content_type: "application/pdf",
    observed_content_length: 8_192,
    settle_delay_seconds: 2
  }).record;
}

function expectCode(code: ProofAssetUploadError["code"]) {
  return (error: unknown) =>
    error instanceof ProofAssetUploadError && error.code === code;
}

test("initializes one exact Proof-owned asset without runtime delivery or secret fields", () => {
  const record = initialized();
  assert.equal(record.state, "initialized");
  assert.equal(record.storage_class, "unfinalized");
  assert.equal(record.record_version, 1);
  assert.equal(
    record.source_key,
    `orders/A0226753/tasks/ptask_synthetic_001/revisions/${revisionId}/source/${assetId}/Revised Artwork.pdf`
  );
  assert.equal(
    record.outbound_key,
    `orders/A0226753/tasks/ptask_synthetic_001/revisions/${revisionId}/outbound/${publicationId}/Revised Artwork.pdf`
  );
  assert.equal(record.retention_anchor_at, "2026-07-28T11:59:00.000Z");
  assert.equal(
    record.cleanup_eligible_at_epoch,
    Math.floor(Date.parse(record.retention_anchor_at) / 1_000) +
      90 * 24 * 60 * 60
  );
  assert.equal(record.delivery_locator_id, null);
  assert.equal(record.delivery_url_sha256, null);
  const serialized = JSON.stringify(record).toLowerCase();
  for (const forbidden of [
    "authorization",
    "bearer ",
    "client_secret",
    "signed_url",
    "sharepoint",
    "dropbox",
    "wrike",
    "https://"
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("derives the initial later-of-order-completion/last-activity retention anchor", () => {
  const record = initialized({
    order_completed_at: "2026-07-28T11:58:00.000Z",
    last_proof_activity_at: "2026-07-28T11:59:30.000Z",
    retention_days: 60
  });
  assert.equal(record.retention_anchor_at, "2026-07-28T11:59:30.000Z");
  assert.equal(
    record.cleanup_eligible_at_epoch,
    Math.floor(Date.parse(record.retention_anchor_at) / 1_000) +
      60 * 24 * 60 * 60
  );
  assert.throws(
    () =>
      initialized({
        last_proof_activity_at: "2026-07-28T12:00:01.000Z"
      }),
    expectCode("invalid")
  );
  assert.throws(
    () => initialized({ retention_days: 59 }),
    /between 60 and 90/
  );
});

test("advances cleanup only for later server-authored lifecycle activity", () => {
  const record = initialized();
  const result = updateProofAssetRetentionActivity({
    record,
    expected_record_version: record.record_version,
    updated_at: "2026-07-29T12:00:00.000Z",
    order_completed_at: "2026-07-29T11:00:00.000Z",
    last_proof_activity_at: "2026-07-29T11:30:00.000Z"
  });
  assert.equal(result.status, "updated");
  assert.equal(
    result.record.retention_anchor_at,
    "2026-07-29T11:30:00.000Z"
  );
  assert.equal(
    result.record.cleanup_eligible_at_epoch,
    Math.floor(Date.parse("2026-07-29T11:30:00.000Z") / 1_000) +
      90 * 24 * 60 * 60
  );

  const replay = updateProofAssetRetentionActivity({
    record: result.record,
    expected_record_version: record.record_version,
    updated_at: "2026-07-30T12:00:00.000Z",
    order_completed_at: result.record.order_completed_at,
    last_proof_activity_at: result.record.last_proof_activity_at
  });
  assert.equal(replay.status, "replay");
  assert.equal(replay.record, result.record);

  assert.throws(
    () =>
      updateProofAssetRetentionActivity({
        record: result.record,
        expected_record_version: result.record.record_version,
        updated_at: "2026-07-30T12:00:00.000Z",
        order_completed_at: "2026-07-29T10:00:00.000Z",
        last_proof_activity_at: result.record.last_proof_activity_at
      }),
    expectCode("conflict")
  );
  assert.throws(
    () =>
      updateProofAssetRetentionActivity({
        record: result.record,
        expected_record_version: result.record.record_version,
        updated_at: "2026-07-30T12:00:00.000Z",
        order_completed_at: result.record.order_completed_at,
        last_proof_activity_at: "2026-07-30T12:00:01.000Z"
      }),
    expectCode("invalid")
  );
});

test("keeps file-size policy injected while supporting an 800 MiB revised-art contract", () => {
  const eightHundredMiB = 800 * 1024 * 1024;
  const record = initialized({
    content_policy_id: "proof-policy-large-art-synthetic-v1",
    content_policy_max_bytes: 1024 * 1024 * 1024,
    declared_content_length: eightHundredMiB
  });
  assert.equal(record.declared_content_length, eightHundredMiB);
  assert.equal(record.content_policy_max_bytes, 1024 * 1024 * 1024);
  assert.throws(
    () =>
      initialized({
        content_policy_id: "proof-policy-small-synthetic-v1",
        content_policy_max_bytes: 500 * 1024 * 1024,
        declared_content_length: eightHundredMiB
      }),
    expectCode("invalid")
  );
  assert.throws(
    () =>
      initialized({
        declared_content_type: "application/zip",
        allowed_content_types: ["application/pdf", "image/tiff"]
      }),
    /not allowed/
  );
});

test("progresses through immutable upload completion and exact replays", () => {
  const started = uploading();
  assert.equal(started.state, "uploading");
  assert.equal(started.record_version, 2);
  const startReplay = beginProofAssetUpload({
    record: started,
    expected_record_version: 1,
    upload_started_at: started.upload_started_at!
  });
  assert.equal(startReplay.status, "replay");
  assert.equal(startReplay.record, started);

  const completed = uploaded(started);
  assert.equal(completed.state, "uploaded");
  assert.equal(completed.source_object_version_id, sourceObjectVersion);
  assert.equal(completed.source_sha256, sourceSha256);
  const replay = completeProofAssetUpload({
    record: completed,
    expected_record_version: started.record_version,
    upload_completed_at: completed.upload_completed_at!,
    source_object_version_id: completed.source_object_version_id!,
    source_content_type: completed.source_content_type!,
    source_content_length: completed.source_content_length!,
    source_sha256: completed.source_sha256!
  });
  assert.equal(replay.status, "replay");
  assert.equal(replay.record, completed);
});

test("fails closed for stale versions and changed upload identity", () => {
  const record = initialized();
  assert.throws(
    () =>
      beginProofAssetUpload({
        record,
        expected_record_version: 2,
        upload_started_at: "2026-07-28T12:00:01.000Z"
      }),
    expectCode("stale")
  );
  const started = uploading(record);
  for (const change of [
    { source_content_type: "image/png" },
    { source_content_length: 8_193 },
    { source_sha256: "0".repeat(64) }
  ]) {
    assert.throws(
      () =>
        completeProofAssetUpload({
          record: started,
          expected_record_version: started.record_version,
          upload_completed_at: "2026-07-28T12:00:05.000Z",
          source_object_version_id: sourceObjectVersion,
          source_content_type: "application/pdf",
          source_content_length: 8_192,
          source_sha256: sourceSha256,
          ...change
        }),
      expectCode("cross_bound")
    );
  }
  const completed = uploaded(started);
  assert.throws(
    () =>
      completeProofAssetUpload({
        record: completed,
        expected_record_version: completed.record_version,
        upload_completed_at: completed.upload_completed_at!,
        source_object_version_id: `${sourceObjectVersion}changed`,
        source_content_type: completed.source_content_type!,
        source_content_length: completed.source_content_length!,
        source_sha256: completed.source_sha256!
      }),
    expectCode("conflict")
  );
});

test("requires ordered verification and records a clean immutable source", () => {
  const record = verifying();
  const result = completeProofAssetVerification({
    record: scanning(record),
    expected_record_version: record.record_version + 1,
    scan_completed_at: "2026-07-28T12:00:08.000Z",
    scan_status: "no_threats_found",
    scan_evidence_sha256: scanEvidenceSha256
  });
  assert.equal(result.status, "updated");
  assert.equal(result.record.state, "scan_pending");
  assert.equal(result.record.verification_status, "cleared");
  assert.equal(result.record.storage_class, "retained_source");
  assert.equal(result.record.malware_scan_status, "no_threats_found");
  assert.equal(result.record.cleared_at, "2026-07-28T12:00:08.000Z");
  const replay = completeProofAssetVerification({
    record: result.record,
    expected_record_version: record.record_version,
    scan_completed_at: result.record.scan_completed_at!,
    scan_status: "no_threats_found",
    scan_evidence_sha256: result.record.scan_evidence_sha256!
  });
  assert.equal(replay.status, "replay");
});

test("quarantines every non-clear scan result and never permits publication", () => {
  const cases = [
    ["threats_found", "threats_found"],
    ["unsupported", "unsupported"],
    ["access_denied", "access_denied"],
    ["failed", "scan_failed"]
  ] as const;
  for (const [scanStatus, reason] of cases) {
    const record = scanning();
    const result = completeProofAssetVerification({
      record,
      expected_record_version: record.record_version,
      scan_completed_at: "2026-07-28T12:00:08.000Z",
      scan_status: scanStatus,
      scan_evidence_sha256: scanEvidenceSha256
    });
    assert.equal(result.record.state, "scan_pending");
    assert.equal(result.record.verification_status, "quarantined");
    assert.equal(result.record.storage_class, "quarantined");
    assert.equal(result.record.quarantine_reason, reason);
    assert.throws(
      () =>
        recordProofAssetPublication({
          record: result.record,
          expected_record_version: result.record.record_version,
          published_at: "2026-07-28T12:00:10.000Z",
          outbound_object_version_id: outboundObjectVersion,
          outbound_content_length: 8_192,
          outbound_sha256: sourceSha256
        }),
      expectCode("invalid_transition")
    );
  }
});

test("publishes only a byte-identical outbound object and preserves exact replay", () => {
  const record = cleared();
  assert.throws(
    () =>
      recordProofAssetPublication({
        record,
        expected_record_version: record.record_version,
        published_at: "2026-07-28T12:00:10.000Z",
        outbound_object_version_id: outboundObjectVersion,
        outbound_content_length: 8_192,
        outbound_sha256: "0".repeat(64)
      }),
    expectCode("cross_bound")
  );
  const result = recordProofAssetPublication({
    record,
    expected_record_version: record.record_version,
    published_at: "2026-07-28T12:00:10.000Z",
    outbound_object_version_id: outboundObjectVersion,
    outbound_content_length: 8_192,
    outbound_sha256: sourceSha256
  });
  assert.equal(result.record.state, "scan_pending");
  assert.equal(result.record.publication_status, "published");
  assert.equal(result.record.outbound_sha256, result.record.source_sha256);
  const replay = recordProofAssetPublication({
    record: result.record,
    expected_record_version: record.record_version,
    published_at: result.record.published_at!,
    outbound_object_version_id: result.record.outbound_object_version_id!,
    outbound_content_length: result.record.outbound_content_length!,
    outbound_sha256: result.record.outbound_sha256!
  });
  assert.equal(replay.status, "replay");
});

test("records readiness only after direct matching delivery and a durable settle barrier", () => {
  const record = published();
  for (const change of [
    { observed_content_type: "text/html" },
    { observed_content_length: 8_193 },
    { redirected: true }
  ]) {
    assert.throws(
      () =>
        recordProofAssetDeliveryVerification({
          record,
          expected_record_version: record.record_version,
          delivery_verified_at: "2026-07-28T12:00:12.000Z",
          delivery_locator_id: locatorId,
          delivery_host: "go.vornan.co",
          delivery_url_sha256: deliveryUrlSha256,
          direct_http_status: 200,
          redirected: false,
          observed_content_type: "application/pdf",
          observed_content_length: 8_192,
          settle_delay_seconds: 2,
          ...change
        } as Parameters<typeof recordProofAssetDeliveryVerification>[0]),
      expectCode("cross_bound")
    );
  }
  const result = recordProofAssetDeliveryVerification({
    record,
    expected_record_version: record.record_version,
    delivery_verified_at: "2026-07-28T12:00:12.000Z",
    delivery_locator_id: locatorId,
    delivery_host: "go.vornan.co",
    delivery_url_sha256: deliveryUrlSha256,
    direct_http_status: 200,
    redirected: false,
    observed_content_type: "application/pdf",
    observed_content_length: 8_192,
    settle_delay_seconds: 2
  });
  assert.equal(result.record.state, "ready_for_lift");
  assert.equal(
    result.record.lift_not_before_epoch,
    Math.floor(Date.parse(result.record.delivery_verified_at!) / 1_000) + 2
  );
  assert.equal(
    JSON.stringify(result.record).includes("https://go.vornan.co"),
    false
  );
});

test("binds packet membership to the exact cleared source version and checksum", () => {
  const record = cleared();
  const result = addProofAssetPacketMembership({
    record,
    expected_record_version: record.record_version,
    packet_id: packetId,
    packet_kind: "client_current",
    included_at: "2026-07-28T12:00:09.000Z"
  });
  assert.equal(result.record.packet_memberships.length, 1);
  assert.deepEqual(result.record.packet_memberships[0], {
    packet_id: packetId,
    packet_kind: "client_current",
    source_object_version_id: sourceObjectVersion,
    source_sha256: sourceSha256,
    included_at: "2026-07-28T12:00:09.000Z"
  });
  const replay = addProofAssetPacketMembership({
    record: result.record,
    expected_record_version: record.record_version,
    packet_id: packetId,
    packet_kind: "client_current",
    included_at: "2026-07-28T12:00:09.000Z"
  });
  assert.equal(replay.status, "replay");
  assert.throws(
    () =>
      addProofAssetPacketMembership({
        record: result.record,
        expected_record_version: result.record.record_version,
        packet_id: packetId,
        packet_kind: "internal_source_complete",
        included_at: "2026-07-28T12:00:09.000Z"
      }),
    expectCode("conflict")
  );
});

test("rejects packet membership before clearance and tampered source bindings", () => {
  const record = uploaded();
  assert.throws(
    () =>
      addProofAssetPacketMembership({
        record,
        expected_record_version: record.record_version,
        packet_id: packetId,
        packet_kind: "client_current",
        included_at: "2026-07-28T12:00:09.000Z"
      }),
    expectCode("invalid_transition")
  );
  const valid = addProofAssetPacketMembership({
    record: cleared(),
    expected_record_version: 6,
    packet_id: packetId,
    packet_kind: "client_current",
    included_at: "2026-07-28T12:00:09.000Z"
  }).record;
  assert.throws(
    () =>
      validateProofAssetUploadRecord({
        ...valid,
        packet_memberships: valid.packet_memberships.map((membership) => ({
          ...membership,
          source_sha256: "0".repeat(64)
        }))
      }),
    expectCode("cross_bound")
  );
});

test("rejects external sources, cross-bound keys, sensitive extras, and malformed records", () => {
  const record = readyForLift();
  assert.throws(
    () =>
      validateProofAssetUploadRecord({
        ...record,
        source_kind: "sharepoint"
      }),
    expectCode("invalid")
  );
  assert.throws(
    () =>
      validateProofAssetUploadRecord({
        ...record,
        source_key: record.source_key.replace("A0226753", "A0999999")
      }),
    expectCode("cross_bound")
  );
  assert.throws(
    () =>
      validateProofAssetUploadRecord({
        ...record,
        authorization: "Bearer synthetic-forbidden"
      }),
    expectCode("invalid")
  );
  assert.throws(
    () =>
      validateProofAssetUploadRecord({
        ...record,
        cleanup_eligible_at_epoch: record.cleanup_eligible_at_epoch + 1
      }),
    expectCode("invalid")
  );
});

test("does not allow arbitrary state jumps or future/misaligned timestamps", () => {
  const record = initialized();
  assert.throws(
    () =>
      beginProofAssetVerification({
        record,
        expected_record_version: record.record_version,
        verification_started_at: "2026-07-28T12:00:06.000Z"
      }),
    expectCode("invalid_transition")
  );
  assert.throws(
    () =>
      validateProofAssetUploadRecord({
        ...record,
        state: "ready_for_lift"
      }),
    expectCode("invalid")
  );
  assert.throws(
    () =>
      beginProofAssetUpload({
        record,
        expected_record_version: record.record_version,
        upload_started_at: "2026-07-28T11:59:59.000Z"
      }),
    expectCode("invalid")
  );
});

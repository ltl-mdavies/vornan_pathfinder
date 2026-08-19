import assert from "node:assert/strict";
import test from "node:test";
import {
  assertProofRevisionAssetReadyForLift,
  buildProofRevisionAssetKeys,
  computeProofAssetCleanupEligibleAtEpoch,
  computeProofAssetLiftNotBeforeEpoch,
  ProofAssetLifecycleError,
  type ProofRevisionAssetReadiness
} from "../src/proof-asset-lifecycle.ts";

const assetId = `passet_${"a".repeat(64)}`;
const publicationId = `ppublication_${"d".repeat(64)}`;
const revisionId = `prevision_${"b".repeat(64)}`;
const deliveryVerifiedAt = "2026-07-27T12:00:00.000Z";
const retentionAnchorAt = "2026-07-27T12:00:00.000Z";
const keys = buildProofRevisionAssetKeys({
  order_number: "A0226753",
  task_id: "ptask_synthetic_001",
  revision_id: revisionId,
  asset_id: assetId,
  publication_id: publicationId,
  filename: "Revised Artwork.pdf"
});

const readyAsset: ProofRevisionAssetReadiness = {
  asset_id: assetId,
  publication_id: publicationId,
  revision_id: revisionId,
  source_kind: "proof_upload",
  order_number: "A0226753",
  task_id: "ptask_synthetic_001",
  attachment_id: "proofing-synthetic-0001",
  replaces_proof_version_id: "pversion-synthetic-001",
  original_filename: "Revised Artwork.pdf",
  content_type: "application/pdf",
  content_length: 8_192,
  sha256: "c".repeat(64),
  source_object_version_id: "3/L4kqtJlcpXroDTDmJ+sourceVersion=",
  source_key: keys.source_key,
  outbound_object_version_id: "3/L4kqtJlcpXroDTDmJ+outboundVersion=",
  outbound_sha256: "c".repeat(64),
  outbound_key: keys.outbound_key,
  delivery_host: "go.vornan.co",
  delivery_url: "https://go.vornan.co/a/synthetic-proof-asset?Policy=synthetic",
  delivery_url_sha256:
    "40ff0ca92141b3803b35dd2275fc053b0860b73ede7d26b39b9178e3b7170388",
  state: "ready_for_lift",
  malware_scan_status: "no_threats_found",
  outbound_status: "published",
  delivery_status: "verified_direct_200",
  upload_completed_at: "2026-07-27T11:59:55.000Z",
  verified_at: "2026-07-27T11:59:57.000Z",
  published_at: "2026-07-27T11:59:59.000Z",
  delivery_verified_at: deliveryVerifiedAt,
  settle_delay_seconds: 2,
  lift_not_before_epoch: computeProofAssetLiftNotBeforeEpoch({
    delivery_verified_at: deliveryVerifiedAt,
    settle_delay_seconds: 2
  }),
  retention_days: 90,
  order_completed_at: null,
  last_proof_activity_at: retentionAnchorAt,
  retention_anchor_at: retentionAnchorAt,
  cleanup_eligible_at_epoch: computeProofAssetCleanupEligibleAtEpoch({
    retention_anchor_at: retentionAnchorAt,
    retention_days: 90
  }),
  legal_hold: false
};

const binding = {
  order_number: readyAsset.order_number,
  task_id: readyAsset.task_id,
  attachment_id: readyAsset.attachment_id,
  expected_proof_version_id: readyAsset.replaces_proof_version_id,
  expected_revision_id: readyAsset.revision_id,
  expected_source_object_version_id: readyAsset.source_object_version_id,
  expected_outbound_object_version_id: readyAsset.outbound_object_version_id,
  expected_delivery_url_sha256: readyAsset.delivery_url_sha256,
  asset_id: readyAsset.asset_id
};

test("organizes proof-only source and outbound objects under order/task/revision prefixes", () => {
  assert.equal(
    keys.source_key,
    `orders/A0226753/tasks/ptask_synthetic_001/revisions/${revisionId}/source/${assetId}/Revised Artwork.pdf`
  );
  assert.equal(
    keys.outbound_key,
    `orders/A0226753/tasks/ptask_synthetic_001/revisions/${revisionId}/outbound/${publicationId}/Revised Artwork.pdf`
  );
  assert.equal(keys.packet_prefix, "orders/A0226753/packets/");
  assert.throws(
    () =>
      buildProofRevisionAssetKeys({
        order_number: "A0226753",
        task_id: "ptask_synthetic_001",
        revision_id: revisionId,
        asset_id: assetId,
        publication_id: publicationId,
        filename: "../../external-share.zip"
      }),
    ProofAssetLifecycleError
  );
});

test("pins configurable proof retention to the documented 60-90 day range", () => {
  const sixty = computeProofAssetCleanupEligibleAtEpoch({
    retention_anchor_at: retentionAnchorAt,
    retention_days: 60
  });
  const ninety = computeProofAssetCleanupEligibleAtEpoch({
    retention_anchor_at: retentionAnchorAt
  });
  assert.equal(ninety - sixty, 30 * 24 * 60 * 60);
  assert.throws(
    () =>
      computeProofAssetCleanupEligibleAtEpoch({
        retention_anchor_at: retentionAnchorAt,
        retention_days: 91
      }),
    /between 60 and 90/
  );
});

test("allows Lift only after verification, clean scan, direct delivery, and settling", () => {
  assert.throws(
    () =>
      assertProofRevisionAssetReadyForLift({
        asset: readyAsset,
        binding,
        now: new Date("2026-07-27T12:00:01.999Z")
      }),
    (error: unknown) =>
      error instanceof ProofAssetLifecycleError && error.code === "settling"
  );
  const validated = assertProofRevisionAssetReadyForLift({
    asset: readyAsset,
    binding,
    now: new Date("2026-07-27T12:00:02.000Z")
  });
  assert.equal(validated.delivery_url, readyAsset.delivery_url);
  for (const tampered of [
    { ...readyAsset, revision_id: `prevision_${"f".repeat(64)}` },
    {
      ...readyAsset,
      source_object_version_id: "3/L4kqtJlcpXroDTDmJ+differentSource="
    },
    {
      ...readyAsset,
      outbound_object_version_id: "3/L4kqtJlcpXroDTDmJ+differentOutbound="
    },
    { ...readyAsset, outbound_sha256: "f".repeat(64) }
  ]) {
    assert.throws(
      () =>
        assertProofRevisionAssetReadyForLift({
          asset: tampered,
          binding,
          now: new Date("2026-07-27T12:00:02.000Z")
        }),
      ProofAssetLifecycleError
    );
  }
  assert.throws(
    () =>
      assertProofRevisionAssetReadyForLift({
        asset: readyAsset,
        binding: {
          ...binding,
          expected_delivery_url_sha256: "f".repeat(64)
        },
        now: new Date("2026-07-27T12:00:02.000Z")
      }),
    ProofAssetLifecycleError
  );
});

test("accepts an initialized retention anchor that predates upload completion", () => {
  const initializedAnchor = "2026-07-27T11:59:54.000Z";
  const legacyReadyAsset = {
    ...readyAsset,
    last_proof_activity_at: initializedAnchor,
    retention_anchor_at: initializedAnchor,
    cleanup_eligible_at_epoch: computeProofAssetCleanupEligibleAtEpoch({
      retention_anchor_at: initializedAnchor,
      retention_days: readyAsset.retention_days
    })
  };
  const validated = assertProofRevisionAssetReadyForLift({
    asset: legacyReadyAsset,
    binding,
    now: new Date("2026-07-27T12:00:02.000Z")
  });
  assert.equal(validated.retention_anchor_at, initializedAnchor);
});

test("fails closed for external sources, cross-bound assets, scan failures, and cleanup eligibility", () => {
  assert.throws(
    () =>
      assertProofRevisionAssetReadyForLift({
        asset: { ...readyAsset, source_kind: "sharepoint" },
        binding,
        now: new Date("2026-07-27T12:00:02.000Z")
      }),
    /record is invalid/
  );
  assert.throws(
    () =>
      assertProofRevisionAssetReadyForLift({
        asset: readyAsset,
        binding: { ...binding, order_number: "A0999999" },
        now: new Date("2026-07-27T12:00:02.000Z")
      }),
    (error: unknown) =>
      error instanceof ProofAssetLifecycleError && error.code === "cross_bound"
  );
  assert.throws(
    () =>
      assertProofRevisionAssetReadyForLift({
        asset: { ...readyAsset, malware_scan_status: "threats_found" },
        binding,
        now: new Date("2026-07-27T12:00:02.000Z")
      }),
    (error: unknown) =>
      error instanceof ProofAssetLifecycleError && error.code === "scan_not_clear"
  );
  assert.throws(
    () =>
      assertProofRevisionAssetReadyForLift({
        asset: readyAsset,
        binding,
        now: new Date((readyAsset.cleanup_eligible_at_epoch + 1) * 1_000)
      }),
    (error: unknown) =>
      error instanceof ProofAssetLifecycleError && error.code === "cleanup_eligible"
  );
  const futureAnchor = "2026-07-27T12:00:03.000Z";
  assert.throws(
    () =>
      assertProofRevisionAssetReadyForLift({
        asset: {
          ...readyAsset,
          last_proof_activity_at: futureAnchor,
          retention_anchor_at: futureAnchor,
          cleanup_eligible_at_epoch: computeProofAssetCleanupEligibleAtEpoch({
            retention_anchor_at: futureAnchor,
            retention_days: readyAsset.retention_days
          })
        },
        binding,
        now: new Date("2026-07-27T12:00:02.000Z")
      }),
    /cannot be in the future/
  );
});

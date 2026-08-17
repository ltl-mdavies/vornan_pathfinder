import assert from "node:assert/strict";
import test from "node:test";
import type { InspectionObservation } from "@pathfinder/artwork-inspection-contracts";
import {
  appendArtworkInspectionRerun,
  ArtworkCatalogDomainError,
  createArtworkAsset,
  createArtworkInspection,
  createArtworkVersion,
  createCatalogProduct,
  createCatalogProductRevision,
  createCustomerCatalog,
  createInspectionPolicyRevision,
  createProductSpecificationRevision,
  evaluateArtworkReadiness,
  recordArtworkInspectionObservation,
  transitionArtworkVersion
} from "../src/index.ts";

const timestamp = "2026-08-17T12:00:00.000Z";

function fixture() {
  const catalog = createCustomerCatalog({
    customer_id: "customer_1249",
    catalog_id: "catalog_001",
    created_at: timestamp
  });
  const specification = createProductSpecificationRevision({
    customer_id: catalog.customer_id,
    specification_revision_id: "specification_001",
    width: 144,
    height: 30,
    units: "in",
    artwork_scale: { numerator: 1, denominator: 1 },
    target_dpi: 150,
    created_at: timestamp
  });
  const product = createCatalogProduct({
    catalog,
    catalog_product_id: "product_001",
    created_at: timestamp
  });
  const productRevision = createCatalogProductRevision({
    product,
    specification,
    catalog_product_revision_id: "product_revision_001",
    created_at: timestamp
  });
  const asset = createArtworkAsset({
    product,
    artwork_asset_id: "asset_001",
    created_at: timestamp
  });
  const initialized = createArtworkVersion({
    asset,
    specification,
    artwork_version_id: "version_001",
    object_version_id: "object_version_001",
    sha256: "a".repeat(64),
    content_type: "application/pdf",
    content_length: 100_000,
    original_filename: "display-name.pdf",
    created_at: timestamp
  });
  const uploading = transitionArtworkVersion(initialized, "uploading", "2026-08-17T12:00:01.000Z");
  const uploaded = transitionArtworkVersion(uploading, "uploaded", "2026-08-17T12:00:02.000Z");
  const verified = transitionArtworkVersion(uploaded, "content_verified", "2026-08-17T12:00:03.000Z");
  const scanPending = transitionArtworkVersion(verified, "scan_pending", "2026-08-17T12:00:04.000Z");
  const usable = transitionArtworkVersion(scanPending, "usable", "2026-08-17T12:00:05.000Z");
  return { catalog, specification, product, productRevision, asset, initialized, usable };
}

test("creates immutable customer, product, specification, asset, and version identities", () => {
  const value = fixture();
  assert.equal(value.productRevision.specification_revision_id, value.specification.specification_revision_id);
  assert.equal(value.usable.artwork_asset_id, value.asset.artwork_asset_id);
  assert.equal(value.usable.specification_revision_id, value.specification.specification_revision_id);
  assert.equal(value.usable.object_version_id, "object_version_001");
  assert.equal(value.usable.sha256, "a".repeat(64));
  for (const entity of [value.catalog, value.specification, value.product, value.productRevision, value.asset, value.usable]) {
    assert.equal(Object.isFrozen(entity), true);
  }
  assert.equal(Object.isFrozen(value.specification.artwork_scale), true);
});

test("allows only explicit artwork version transitions", () => {
  const { initialized, usable } = fixture();
  assert.throws(
    () => transitionArtworkVersion(initialized, "usable", "2026-08-17T12:00:01.000Z"),
    (error: unknown) =>
      error instanceof ArtworkCatalogDomainError && error.code === "invalid_transition"
  );
  assert.throws(
    () => transitionArtworkVersion(usable, "blocked", "2026-08-17T12:00:06.000Z"),
    (error: unknown) =>
      error instanceof ArtworkCatalogDomainError && error.code === "invalid_transition"
  );
  assert.throws(
    () => transitionArtworkVersion(initialized, "uploading", "2026-08-17T11:59:59.000Z"),
    /cannot move backwards/
  );
});

test("keeps a usable artwork version valid when inspection is disabled", () => {
  const { catalog, usable } = fixture();
  const disabled = createInspectionPolicyRevision({
    catalog,
    policy_revision_id: "policy_disabled_001",
    mode: "disabled",
    provider_key: null,
    created_at: timestamp
  });
  const readiness = evaluateArtworkReadiness(usable, disabled);
  assert.deepEqual(readiness, {
    asset_safety: "usable",
    inspection_requirement: "disabled",
    inspection_evidence: "not_requested",
    human_approval: "not_requested",
    business_release: "held"
  });
  assert.throws(
    () =>
      createArtworkInspection({
        version: usable,
        policy: disabled,
        inspection_id: "inspection_001",
        provider_key: "provider_alpha",
        adapter_version: "adapter-1",
        engine_revision: "engine-1",
        idempotency_key: "idempotency-1",
        created_at: timestamp
      }),
    (error: unknown) =>
      error instanceof ArtworkCatalogDomainError && error.code === "inspection_disabled"
  );
});

test("fails closed on customer, catalog, specification, provider, and asset safety mismatches", () => {
  const { catalog, product, asset, initialized, usable } = fixture();
  const otherSpecification = createProductSpecificationRevision({
    customer_id: "customer_other",
    specification_revision_id: "specification_other",
    width: 1,
    height: 1,
    units: "in",
    artwork_scale: { numerator: 1, denominator: 1 },
    target_dpi: 300,
    created_at: timestamp
  });
  assert.throws(
    () =>
      createCatalogProductRevision({
        product,
        specification: otherSpecification,
        catalog_product_revision_id: "product_revision_other",
        created_at: timestamp
      }),
    (error: unknown) =>
      error instanceof ArtworkCatalogDomainError && error.code === "binding_mismatch"
  );
  assert.throws(
    () =>
      createArtworkVersion({
        asset,
        specification: otherSpecification,
        artwork_version_id: "version_other",
        object_version_id: "object_other",
        sha256: "b".repeat(64),
        content_type: "application/pdf",
        content_length: 1,
        original_filename: "other.pdf",
        created_at: timestamp
      }),
    (error: unknown) =>
      error instanceof ArtworkCatalogDomainError && error.code === "binding_mismatch"
  );

  const advisory = createInspectionPolicyRevision({
    catalog,
    policy_revision_id: "policy_advisory_001",
    mode: "advisory",
    provider_key: "provider_alpha",
    created_at: timestamp
  });
  assert.throws(
    () =>
      createArtworkInspection({
        version: initialized,
        policy: advisory,
        inspection_id: "inspection_001",
        provider_key: "provider_alpha",
        adapter_version: "adapter-1",
        engine_revision: "engine-1",
        idempotency_key: "idempotency-1",
        created_at: timestamp
      }),
    (error: unknown) =>
      error instanceof ArtworkCatalogDomainError && error.code === "asset_not_usable"
  );
  assert.throws(
    () =>
      createArtworkInspection({
        version: usable,
        policy: advisory,
        inspection_id: "inspection_001",
        provider_key: "provider_other",
        adapter_version: "adapter-1",
        engine_revision: "engine-1",
        idempotency_key: "idempotency-1",
        created_at: timestamp
      }),
    (error: unknown) =>
      error instanceof ArtworkCatalogDomainError && error.code === "binding_mismatch"
  );
});

function completedObservation(inspectionId: string, policyRevisionId: string): InspectionObservation {
  return {
    inspection_id: inspectionId,
    status: "completed",
    verdict: "pass",
    provider_reference: "provider-reference-001",
    provider_key: "provider_alpha",
    adapter_version: "adapter-1",
    engine_revision: "engine-1",
    policy_revision_id: policyRevisionId,
    metrics: [],
    findings: [],
    native_report: null,
    submitted_at: timestamp,
    started_at: timestamp,
    completed_at: "2026-08-17T12:00:10.000Z",
    error: null
  };
}

test("appends observations and reruns without overwriting earlier evidence", () => {
  const { catalog, usable } = fixture();
  const firstPolicy = createInspectionPolicyRevision({
    catalog,
    policy_revision_id: "policy_advisory_001",
    mode: "advisory",
    provider_key: "provider_alpha",
    created_at: timestamp
  });
  const first = createArtworkInspection({
    version: usable,
    policy: firstPolicy,
    inspection_id: "inspection_001",
    provider_key: "provider_alpha",
    adapter_version: "adapter-1",
    engine_revision: "engine-1",
    idempotency_key: "idempotency-1",
    created_at: "2026-08-17T12:00:05.000Z"
  });
  const firstCompleted = recordArtworkInspectionObservation(
    first,
    completedObservation(first.inspection_id, first.policy_revision_id),
    "2026-08-17T12:00:10.000Z"
  );
  const secondPolicy = createInspectionPolicyRevision({
    catalog,
    policy_revision_id: "policy_advisory_002",
    mode: "advisory",
    provider_key: "provider_alpha",
    created_at: "2026-08-17T12:01:00.000Z"
  });
  const second = createArtworkInspection({
    version: usable,
    policy: secondPolicy,
    inspection_id: "inspection_002",
    provider_key: "provider_alpha",
    adapter_version: "adapter-1",
    engine_revision: "engine-1",
    idempotency_key: "idempotency-2",
    created_at: "2026-08-17T12:01:00.000Z"
  });
  const history = appendArtworkInspectionRerun([firstCompleted], second);
  assert.equal(history.length, 2);
  assert.equal(history[0]?.status, "completed");
  assert.equal(history[0]?.observations.length, 1);
  assert.equal(history[1]?.status, "queued");
  assert.equal(Object.isFrozen(history), true);

  assert.throws(
    () => appendArtworkInspectionRerun(history, { ...second, inspection_id: "inspection_003" as never }),
    (error: unknown) =>
      error instanceof ArtworkCatalogDomainError && error.code === "rerun_conflict"
  );
  assert.throws(
    () =>
      appendArtworkInspectionRerun(history, {
        ...second,
        inspection_id: "inspection_004" as never,
        policy_revision_id: "policy_advisory_003" as never,
        idempotency_key: "idempotency-3",
        sha256: "f".repeat(64)
      }),
    (error: unknown) =>
      error instanceof ArtworkCatalogDomainError && error.code === "binding_mismatch"
  );
});

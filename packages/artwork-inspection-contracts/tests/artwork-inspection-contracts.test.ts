import assert from "node:assert/strict";
import test from "node:test";
import {
  appendInspectionObservation,
  ArtworkInspectionContractError,
  assertInspectionRequestMatches,
  buildInspectionIdempotencyMaterial,
  createSubmissionUncertainObservation,
  toSafeInspectionSummary,
  validateInspectionObservation,
  validateInspectionRequest,
  type ArtworkInspectionProvider,
  type InspectionCallContext,
  type InspectionObservation,
  type InspectionProviderDescriptor,
  type InspectionRequest,
  type InspectionSubmission,
  type ProviderInspectionReference
} from "../src/index.ts";

const timestamp = "2026-08-17T12:00:00.000Z";
const sha256 = "a".repeat(64);

const descriptor: InspectionProviderDescriptor = {
  provider_key: "provider_alpha",
  display_name: "Provider Alpha",
  adapter_version: "adapter-1",
  engine_versions: ["engine-1"],
  capabilities: {
    accepted_content_types: ["application/pdf", "image/tiff"],
    maximum_bytes: 1_000_000,
    maximum_pages: 10,
    supports_async: true,
    supports_webhooks: false,
    supports_polling: true,
    supports_cancellation: false,
    supports_multi_page: true,
    priorities: ["normal", "high"]
  }
};

const request: InspectionRequest = {
  inspection_id: "inspection_001",
  idempotency_key: "idempotency_001",
  customer_scope: {
    customer_id: "customer_1249",
    catalog_id: "catalog_001",
    catalog_product_id: "product_001",
    workflow: "catalog"
  },
  priority: "normal",
  asset: {
    artwork_asset_id: "asset_001",
    artwork_version_id: "version_001",
    object_version_id: "object_version_001",
    sha256,
    content_type: "application/pdf",
    content_length: 100_000,
    page_count: 2
  },
  specification: {
    specification_revision_id: "specification_001",
    width: 144,
    height: 30,
    units: "in",
    artwork_scale: { numerator: 1, denominator: 1 },
    target_dpi: 150
  },
  policy_revision_id: "policy_001",
  requested_engine_revision: "engine-1"
};

function observation(
  status: InspectionObservation["status"],
  overrides: Partial<InspectionObservation> = {}
): InspectionObservation {
  return {
    inspection_id: request.inspection_id,
    status,
    verdict: status === "completed" ? "pass" : null,
    provider_reference: "provider-reference-001",
    provider_key: descriptor.provider_key,
    adapter_version: descriptor.adapter_version,
    engine_revision: "engine-1",
    policy_revision_id: request.policy_revision_id,
    metrics: [],
    findings: [],
    native_report: null,
    submitted_at: timestamp,
    started_at: status === "queued" ? null : timestamp,
    completed_at: status === "completed" ? timestamp : null,
    error: null,
    ...overrides
  };
}

test("validates structured requests and fails closed on capability or binding mismatches", () => {
  const validated = validateInspectionRequest(request, descriptor);
  assert.equal(validated.specification.width, 144);
  assert.equal(validated.specification.target_dpi, 150);
  assert.equal(Object.isFrozen(validated), true);
  assert.equal(Object.isFrozen(validated.asset), true);

  const expected = {
    inspection_id: request.inspection_id,
    idempotency_key: request.idempotency_key,
    customer_id: request.customer_scope.customer_id,
    catalog_id: request.customer_scope.catalog_id,
    catalog_product_id: request.customer_scope.catalog_product_id,
    artwork_asset_id: request.asset.artwork_asset_id,
    artwork_version_id: request.asset.artwork_version_id,
    object_version_id: request.asset.object_version_id,
    sha256: request.asset.sha256,
    specification_revision_id: request.specification.specification_revision_id,
    policy_revision_id: request.policy_revision_id
  };
  assert.doesNotThrow(() => assertInspectionRequestMatches(validated, expected));

  for (const mismatch of [
    { ...expected, idempotency_key: "idempotency_other" },
    { ...expected, customer_id: "customer_other" },
    { ...expected, object_version_id: "object_version_other" },
    { ...expected, sha256: "b".repeat(64) },
    { ...expected, specification_revision_id: "specification_other" },
    { ...expected, policy_revision_id: "policy_other" }
  ]) {
    assert.throws(
      () => assertInspectionRequestMatches(validated, mismatch),
      (error: unknown) =>
        error instanceof ArtworkInspectionContractError && error.code === "binding_mismatch"
    );
  }

  assert.throws(
    () =>
      validateInspectionRequest(
        { ...request, asset: { ...request.asset, content_length: descriptor.capabilities.maximum_bytes + 1 } },
        descriptor
      ),
    (error: unknown) =>
      error instanceof ArtworkInspectionContractError && error.code === "unsupported_capability"
  );
});

test("accepts valid observation transitions and preserves append-only evidence", () => {
  const queued = observation("queued");
  const running = observation("running");
  const completed = observation("completed", {
    native_report: {
      private_report_ref: "private-report-001",
      sha256: "c".repeat(64),
      schema_version: "1"
    }
  });
  const history = appendInspectionObservation(
    appendInspectionObservation(appendInspectionObservation([], queued), running),
    completed
  );
  assert.deepEqual(history.map((item) => item.status), ["queued", "running", "completed"]);
  assert.equal(Object.isFrozen(history), true);
  assert.equal(Object.isFrozen(history[0]), true);
  assert.throws(
    () => appendInspectionObservation(history, observation("running")),
    (error: unknown) =>
      error instanceof ArtworkInspectionContractError && error.code === "invalid_transition"
  );
  assert.throws(
    () => appendInspectionObservation(history.slice(0, 2), observation("completed", { provider_key: "other" })),
    (error: unknown) =>
      error instanceof ArtworkInspectionContractError && error.code === "binding_mismatch"
  );
});

test("builds deterministic idempotency material from every immutable run identity", () => {
  const identity = {
    inspection_id: request.inspection_id,
    artwork_sha256: request.asset.sha256,
    specification_revision_id: request.specification.specification_revision_id,
    policy_revision_id: request.policy_revision_id,
    provider_key: descriptor.provider_key,
    adapter_version: descriptor.adapter_version,
    engine_revision: request.requested_engine_revision
  };
  const material = buildInspectionIdempotencyMaterial(identity);
  assert.equal(material, buildInspectionIdempotencyMaterial({ ...identity }));
  for (const changed of [
    { ...identity, artwork_sha256: "b".repeat(64) },
    { ...identity, specification_revision_id: "specification_002" },
    { ...identity, policy_revision_id: "policy_002" },
    { ...identity, provider_key: "provider_beta" },
    { ...identity, adapter_version: "adapter-2" },
    { ...identity, engine_revision: "engine-2" }
  ]) {
    assert.notEqual(buildInspectionIdempotencyMaterial(changed), material);
  }
});

test("enforces terminal status and verdict combinations", () => {
  assert.throws(
    () => validateInspectionObservation(observation("completed", { verdict: null })),
    /require a verdict/
  );
  assert.throws(
    () => validateInspectionObservation(observation("failed")),
    /require a sanitized error/
  );
  assert.throws(
    () => validateInspectionObservation(observation("running", { verdict: "warn" })),
    /only completed observations/
  );
});

test("turns uncertain acceptance into reconciliation instead of retry", () => {
  const uncertain = createSubmissionUncertainObservation({
    inspection_id: request.inspection_id,
    provider_key: descriptor.provider_key,
    adapter_version: descriptor.adapter_version,
    engine_revision: "engine-1",
    policy_revision_id: request.policy_revision_id,
    provider_reference: null,
    correlation_id: "correlation-001",
    occurred_at: timestamp,
    submitted_at: timestamp
  });
  assert.equal(uncertain.status, "reconciling");
  assert.equal(uncertain.error?.retry_disposition, "reconcile");
  assert.notEqual(uncertain.error?.retry_disposition, "bounded");
});

test("projects safe summaries without provider references or private report locations", () => {
  const completed = observation("completed", {
    native_report: {
      private_report_ref: "private-report-001",
      sha256: "d".repeat(64),
      schema_version: "1"
    }
  });
  const summary = toSafeInspectionSummary(completed);
  const serialized = JSON.stringify(summary);
  assert.equal(summary.has_native_report, true);
  assert.equal(serialized.includes("private-report-001"), false);
  assert.equal(serialized.includes("provider-reference-001"), false);
  assert.equal(serialized.includes("object_version"), false);
  assert.equal(serialized.includes("credentials"), false);
  assert.equal(serialized.includes("url"), false);
});

class AlphaProvider implements ArtworkInspectionProvider {
  async descriptor() {
    return descriptor;
  }

  async submit(_request: InspectionRequest, _context: InspectionCallContext): Promise<InspectionSubmission> {
    return { status: "accepted", provider_reference: "alpha-reference", observation: null, accepted_at: timestamp };
  }

  async reconcile(_reference: ProviderInspectionReference, _context: InspectionCallContext) {
    return observation("completed");
  }
}

class BetaProvider implements ArtworkInspectionProvider {
  async descriptor(): Promise<InspectionProviderDescriptor> {
    return {
      ...descriptor,
      provider_key: "provider_beta",
      display_name: "Provider Beta",
      capabilities: { ...descriptor.capabilities, supports_webhooks: true }
    };
  }

  async submit(_request: InspectionRequest, _context: InspectionCallContext): Promise<InspectionSubmission> {
    return { status: "running", provider_reference: "beta-reference", observation: null, accepted_at: timestamp };
  }

  async reconcile(_reference: ProviderInspectionReference, _context: InspectionCallContext) {
    return observation("running", { provider_key: "provider_beta" });
  }
}

test("allows two distinct mock providers to satisfy the same neutral port", async () => {
  const providers: ArtworkInspectionProvider[] = [new AlphaProvider(), new BetaProvider()];
  assert.deepEqual(
    await Promise.all(providers.map(async (provider) => (await provider.descriptor()).provider_key)),
    ["provider_alpha", "provider_beta"]
  );
});

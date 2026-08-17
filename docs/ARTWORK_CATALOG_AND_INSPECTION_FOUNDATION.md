# Artwork Catalog and Inspection Foundation

**Status:** Proposed architecture contract

**Scope:** Documentation only; no runtime, infrastructure, configuration, or production authorization

**Initial tenant candidate:** LTL Demo (`1249`), under the separate pilot contract

## 1. Purpose

This document defines the smallest provider-neutral foundation Pathfinder needs to retain customer artwork, associate it with an expected print specification, and optionally request a technical artwork inspection.

The first implementation is an internal learning vertical. It is not the customer-facing catalog product, an ordering workflow, or an approval system. The catalog must remain usable when inspection is disabled, unavailable, unsupported, or intentionally skipped.

The shared platform vocabulary is **artwork catalog**, **artwork version**, and **artwork inspection**. Provider product names are configuration values at an adapter boundary; they are not shared domain names.

## 2. Architectural decisions

### 2.1 Inspection is optional

Artwork upload and version retention do not depend on an inspection provider. A provider can add technical evidence to an artwork version, but it cannot own or invalidate the version record.

The platform must support these policy modes:

- `disabled`: retain the artwork version without requesting an inspection;
- `advisory`: request an inspection and display its evidence without blocking catalog use;
- `required`: reserved for a later explicitly approved workflow; a provider result may contribute to a policy decision but is never human approval by itself.

The initial internal pilot uses `advisory` mode after first proving that `disabled` mode works.

### 2.2 Inspection evidence, approval, and readiness are separate

Pathfinder must not translate a provider PASS directly into “approved,” “print ready,” or “ready to order.” Readiness is a Pathfinder projection composed from independent facts:

```text
asset_safety: usable | pending | blocked
inspection_requirement: disabled | advisory | required
inspection_evidence: not_requested | queued | running | pass | warn | fail | unavailable
human_approval: not_requested | pending | approved | rejected
business_release: held | eligible | released
```

The initial pilot populates asset safety and inspection evidence only. Human approval, business release, Proof decisions, and ordering remain out of scope.

### 2.3 Structured specification data is authoritative

Expected dimensions, units, scale, resolution target, and the applicable policy revision must be supplied as immutable structured data. A filename may be retained for display and audit, but filename parsing is not an authoritative source of expected size or scale.

### 2.4 Provider-neutral shared naming is mandatory

Shared packages, records, tables, routes, events, object keys, feature flags, queues, alarms, and UI concepts must not contain a provider product name. A stable provider key and configurable display name may appear only in provider registry/configuration and provider-specific evidence.

This permits a later adapter, including an API-based prepress workflow provider, without migrating catalog records or changing shared APIs.

### 2.5 Append-only evidence and immutable versions

An artwork upload creates an immutable version bound to the exact object version, checksum, content length, content type, and product specification revision. A new file creates a new artwork version. A rerun with a new inspection policy, adapter, or engine creates a new inspection record. Historical evidence is never overwritten.

## 3. Existing Pathfinder patterns to follow

This vertical should conform to the current implementation rather than create a parallel platform style.

| Concern | Existing pattern | Required application |
|---|---|---|
| Customer authority | `packages/customer-directory/` and `apps/api/src/proof/customer-capability-authority.ts` | Every catalog, product, asset, version, policy, and inspection is bound to one customer. Authority is revalidated server-side on every sensitive request. |
| Runtime configuration | `apps/api/src/runtime-config.ts`, `apps/api/src/proof/runtime-config.ts`, and `apps/api/src/proof/asset-upload-config.ts` | Parse and validate dark-by-default emergency gates centrally. Use bounded allowlists and expirations for pilot activation. Durable customer behavior belongs in versioned policy records, not environment variables. |
| Immutable asset lifecycle | `packages/proof-domain/src/proof-asset-lifecycle.ts` and `packages/proof-domain/src/proof-asset-upload.ts` | Reuse the design principles: explicit states, immutable object-version identity, SHA-256 binding, strict transitions, retention holds, and fail-closed validation. Do not make catalog assets Proof assets. |
| Private upload | `apps/api/src/proof/asset-upload-service.ts` and `apps/api/src/proof/asset-upload-store.ts` | Use server-authorized, direct-to-private-storage upload with bounded multipart support; finalize only after exact metadata reconciliation. Catalog storage and records remain separate from Proof storage and ProofCore. |
| Malware scan | `apps/api/src/proof/asset-scan-worker.ts`, `apps/api/src/proof/sync-queue.ts`, and the scan resources in `infra/aws/api-cloudformation.yaml` | Use exact object-version events, bounded queue delivery, DLQ, alarms, idempotent transition handling, and default-disabled event sources. An inspection cannot begin before asset safety is `usable`. |
| Audit | `apps/api/src/proof/audit-service.ts` | Append sanitized milestones and correlation IDs. Never log credentials, signed URLs, raw object keys, artwork content, or unrestricted provider payloads. |
| Public DTO safety | Public projections in `packages/proof-domain/src/index.ts` | Maintain separate internal and public/operator-safe DTOs. Do not expose storage identities, provider secrets, internal customer bindings, or raw native reports. |
| Infrastructure activation | `infra/aws/proof-assets-cloudformation.yaml`, `infra/aws/api-cloudformation.yaml`, and `docs/VORNAN_PROOF_ASSET_INFRASTRUCTURE.md` | Deploy dark, inspect change sets, activate one bounded capability at a time, reconcile counts/queues/alarms, and stop on ambiguity. Catalog resources must not reuse the Proof bucket or Proof tables. |

The referenced Proof implementation is a pattern library, not an ownership shortcut. Catalog artwork has different retention, reuse, and future-order consumers and therefore requires distinct storage and persistence boundaries.

## 4. Provider-neutral domain model

| Entity | Owner | Contract |
|---|---|---|
| `CustomerCatalog` | Pathfinder | Customer-owned collection of reusable catalog products. Initial visibility is internal only. |
| `CatalogProduct` | Pathfinder | Stable customer-facing product identity. Mutable business changes create revisions rather than rewriting historical order/artwork evidence. |
| `CatalogProductRevision` | Pathfinder | Versioned product description and reference to one product specification revision. |
| `ProductSpecificationRevision` | Pathfinder | Immutable expected width, height, units, artwork scale, target resolution, and optional technical constraints. |
| `ArtworkAsset` | Pathfinder | Logical lineage for artwork associated with a catalog product/use case. |
| `ArtworkVersion` | Pathfinder | Immutable file/object identity, checksum, length, MIME type, predecessor, specification revision, upload actor, safety state, and retention controls. |
| `InspectionPolicyRevision` | Pathfinder | Immutable customer/workflow selection of `disabled`, `advisory`, or `required`, provider key, limits, priority, and result interpretation. |
| `ArtworkInspection` | Pathfinder orchestration | Append-only request and observation history for one exact artwork/specification/policy/adapter/engine combination. |
| `ArtworkReadiness` | Pathfinder projection | Independent composition of safety, technical evidence, human approval, and business release. It is not owned by an inspection provider. |

### 4.1 Required identity bindings

Every `ArtworkVersion` must bind:

- customer, catalog, product, and artwork asset identity;
- immutable product specification revision;
- private object key and object version ID internally;
- SHA-256, content length, and detected content type;
- upload/finalization actor and timestamps;
- validation and malware-scan states;
- predecessor version where applicable;
- retention and hold state.

Every `ArtworkInspection` must bind:

- exact artwork version and checksum;
- exact product specification revision;
- exact inspection policy revision;
- provider key, adapter version, and engine revision;
- idempotency key and correlation ID;
- append-only status observations, normalized result, and private native-report reference.

## 5. Ownership boundaries

### Pathfinder owns

- customer and catalog authority;
- catalog product and specification truth;
- upload authorization, immutable asset/version identity, and retention;
- inspection policy selection and orchestration;
- normalized inspection evidence and audit;
- readiness composition;
- internal API/UI and future customer-safe projections.

### Provider adapter owns

- translation between the shared request and provider protocol;
- provider authentication and transport;
- capability reporting;
- provider-status reconciliation;
- normalization of provider-native results.

### Provider runtime owns

- its deterministic inspection engine;
- provider-native calculations and report generation;
- provider-specific fixture/equivalence tests.

### Proof and ordering are consumers only

Proof may later consume an immutable artwork-version reference and inspection summary in a separate shadow-integration branch. Ordering may later consume an explicitly released artwork version. Neither may infer approval or release from a technical PASS, and neither owns the catalog source record.

## 6. Proposed repository placement

These names are directional and require a later implementation PR:

```text
packages/artwork-catalog-domain/
packages/artwork-inspection-contracts/

apps/api/src/artwork-catalog/
apps/api/src/artwork-inspection/

apps/web/src/ArtworkCatalogPanel.tsx
apps/web/src/ArtworkInspectionPanel.tsx
```

Suggested internal API surface:

```text
/api/customers/:customerId/artwork-catalogs
/api/customers/:customerId/artwork-catalogs/:catalogId/products
/api/customers/:customerId/catalog-products/:productId/specifications
/api/customers/:customerId/artwork-assets
/api/customers/:customerId/artwork-assets/:assetId/versions
/api/customers/:customerId/artwork-inspections
/api/customers/:customerId/artwork-inspections/:inspectionId
```

Suggested generic activation controls:

```text
PATHFINDER_ARTWORK_CATALOG_ENABLED
PATHFINDER_ARTWORK_ASSET_UPLOAD_ENABLED
PATHFINDER_ARTWORK_INSPECTION_ENABLED
PATHFINDER_ARTWORK_INSPECTION_WORKER_ENABLED
PATHFINDER_ARTWORK_PILOT_ALLOWED_CUSTOMERS
PATHFINDER_ARTWORK_PILOT_ALLOWED_CATALOGS
PATHFINDER_ARTWORK_PILOT_EXPIRES_AT
```

Environment controls are emergency and pilot boundaries only. Versioned customer/workflow policy remains the durable source of provider enablement.

## 7. Generic lifecycle

```text
catalog product revision
  -> product specification revision
  -> artwork asset
  -> artwork version initialized
  -> uploading
  -> uploaded
  -> content verified
  -> scan pending
  -> usable | blocked
  -> inspection not requested | queued
  -> running | reconciling
  -> completed | unavailable | failed | cancelled
  -> readiness evaluated independently
```

Provider failure cannot roll back an otherwise safe artwork version. A malware or content-integrity failure blocks the version before provider dispatch.

## 8. Delivery sequence

Each branch starts from current authoritative `origin/main`, remains small, and requires a fresh no-overlap lock.

1. `codex/artwork-catalog-architecture` — these contracts only.
2. `codex/artwork-catalog-domain-contracts` — pure TypeScript entities, transitions, and provider-neutral interfaces.
3. `codex/artwork-catalog-core-api` — focused persistence, tenant authority, audit, and internal DTOs.
4. `codex/artwork-asset-upload-foundation` — private upload, immutable versioning, verification, scan, and retention.
5. `codex/artwork-catalog-operator-ui` — internal-only product/specification/artwork workflow.
6. `codex/artwork-inspection-orchestration` — registry, policy, queues, worker, idempotency, reconciliation, and DLQ.
7. `codex/artwork-inspection-provider-adapter` — first provider connection and normalization.
8. `codex/artwork-proof-shadow-consumer` — later Proof-owned, read-only shadow consumption.
9. `codex/artwork-pilot-infrastructure` — dark resources, IAM, alarms, and activation controls.
10. `codex/artwork-pilot-1249-release-record` — separately authorized pilot evidence and closure.

Runtime, infrastructure, and activation must remain separate review and authorization checkpoints.

## 9. Non-goals for the foundation

- Customer-facing catalog or portal design.
- Pricing, cart, checkout, or order creation.
- Lift recovery or submission.
- Proof approval, revised-art action, publication, grants, or sessions.
- Automatic approval or automatic release from an inspection result.
- File conversion or export.
- AI-generated production decisions.
- Bulk catalog import.
- Reuse of Proof asset storage or Proof persistence.

## 10. Decisions required before runtime implementation

### Blocking before a provider adapter

- Confirm code, dependency, fixture, and deployment licensing.
- Establish a headless deterministic engine boundary independent of a desktop/UI session.
- Confirm accepted input types, linked-asset behavior, page/artboard limits, and fixture hashes.
- Approve retention and access classification for artwork and native reports.
- Define maximum bytes, runtime, scratch space, concurrency, and cost alarms.

### Reversible initial defaults

- Inspection is default-off and advisory.
- Catalog work uses asynchronous normal priority.
- The pilot accepts one flattened/self-contained artwork file and one specification revision.
- Native reports remain private and encrypted.
- Bounded polling/reconciliation is acceptable before webhook support.
- Large-file processing belongs in an isolated container worker, not the API Lambda.

## 11. Change-control boundary

This document authorizes no implementation or production action. Future work requires:

1. a clean branch from current authoritative main;
2. Pathfinder Development ownership of merge order;
3. Proof Development review for shared consumer boundaries;
4. Live Support review for infrastructure, activation, evidence, and rollback;
5. separate authorization for any AWS change, upload, provider request, Proof action, Lift action, or customer-visible release.

## Appendix A: First provider candidate facts

The first candidate adapter is currently known by the working name **PixelGuard**. Its authoritative planning baseline is the private repository tag `pixelguard-v1-handoff` at commit `a11c620ba3e9587e99d996443cc65ad108dea0ae`.

Planning facts, pending direct repository and licensing verification:

- the current implementation is a Streamlit/Python application;
- deterministic inspection behavior must be extracted behind a headless boundary;
- Prepress approved initial product sizes, target DPI values `40`, `72`, `150`, and `300`, and metrics-first `PASS`/`NEEDS WORK` behavior;
- AI-generated notes are excluded from the initial integration;
- TIFF/PDF export is not implemented and is outside this vertical;
- the intended fixture set has 23 direct test inputs; linked PSD files support AI files and are not direct test inputs.

These facts belong to provider-specific configuration and adapter validation. They do not alter the shared domain or naming contract.

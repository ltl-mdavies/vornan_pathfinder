# Artwork Catalog 1249 Internal Pilot

**Status:** Proposed bounded pilot plan

**Customer scope:** LTL Demo (`1249`)

**Audience:** Internal Pathfinder operators and engineering only

**Authorization:** No upload, provider call, AWS activation, customer release, Proof action, or Lift action is authorized by this document

## 1. Pilot question

Can Pathfinder retain one reusable, customer-scoped artwork version with an immutable print specification and optionally obtain useful technical inspection evidence through a provider-neutral adapter—without making inspection a catalog dependency?

This is a connectivity and architecture experiment. It is not a customer-facing catalog release and does not attempt to prove ordering, pricing, checkout, Proof approval, or production readiness.

## 2. Non-negotiable safety boundary

The pilot must use new, clearly identified non-production catalog, product, asset, version, specification, policy, and inspection records scoped to customer `1249`.

The failed Pathfinder/Lift job `job_20260815124334_f8bcbe` is an unrelated **HOLD**. Its one Lift submission attempt returned a deterministic customer/order-type mapping error, no Lift order was created, and no retry is authorized. That job, its lines, its reserved identifiers, and its failure may not be used as pilot input or cited as successful pilot evidence.

The pilot must not:

- create or submit a Pathfinder order;
- call Lift or Wrike;
- create or mutate Proof records, policies, grants, sessions, uploads, decisions, publications, or actions;
- expose catalog or inspection capability to a customer;
- reuse Proof asset storage or Proof persistence;
- change Momentara customer `284619` behavior or data;
- activate broad customer/provider access.

## 3. Pilot data contract

The exact pilot identifiers will be created only during a separately authorized action window. They must be recorded in an approved manifest comparable to:

```json
{
  "customer_id": "1249",
  "catalog_id": "<new-internal-pilot-catalog>",
  "catalog_product_id": "<new-non-production-product>",
  "product_specification_revision_id": "<immutable-specification>",
  "artwork_asset_id": "<new-artwork-lineage>",
  "artwork_version_id": "<immutable-version>",
  "inspection_policy_revision_id": "<disabled-or-advisory-policy>",
  "inspection_id": "<new-inspection-when-authorized>",
  "expires_at": "<bounded-utc-expiration>"
}
```

The manifest contains no signed URL, credential, raw object key, provider-native payload, or customer artwork content.

### 3.1 Product specification

The immutable specification must include:

- expected width and height;
- units;
- artwork scale numerator and denominator;
- target DPI;
- optional bleed or other approved technical constraints;
- creation actor and time;
- an immutable revision identity.

Expected dimensions must not be inferred from the filename.

### 3.2 Artwork fixture

Use only an approved synthetic or explicitly approved non-production file. Record its SHA-256, content length, detected content type, intended specification revision, and expected inspection outcome before upload authorization.

Do not use active production customer artwork. Do not directly test linked PSD source files. Adobe Illustrator inputs must satisfy the provider’s later accepted-input contract; a missing linked asset is evidence to report, not permission to retrieve unapproved files.

## 4. Required dark gates

All capabilities default off. Directional names for later implementation are:

```text
PATHFINDER_ARTWORK_CATALOG_ENABLED
PATHFINDER_ARTWORK_ASSET_UPLOAD_ENABLED
PATHFINDER_ARTWORK_INSPECTION_ENABLED
PATHFINDER_ARTWORK_INSPECTION_WORKER_ENABLED
PATHFINDER_ARTWORK_PILOT_ALLOWED_CUSTOMERS
PATHFINDER_ARTWORK_PILOT_ALLOWED_CATALOGS
PATHFINDER_ARTWORK_PILOT_EXPIRES_AT
```

Pilot activation requires:

- exact allowed customer `1249`;
- exact allowed catalog and product;
- exact expiration;
- one bounded artwork object/version when upload is activated;
- one exact inspection ID/provider request when dispatch is activated;
- default-off behavior on missing, malformed, or expired configuration.

Environment gates are emergency boundaries. A versioned `InspectionPolicyRevision` remains the durable source for `disabled` or `advisory` behavior.

## 5. Pilot stages

Each stage requires its own clean repository/release checkpoint, coordination lock, evidence review, and explicit action authorization where external state would change.

### Stage 0 — Contracts only

- Approve the foundation, provider contract, and this pilot plan.
- Make no runtime or infrastructure change.
- Confirm customer, Proof, provider, and Live Support ownership boundaries.

**Exit evidence:** documentation PR merged after review; no production effect.

### Stage 1 — Pure domain and persistence contracts

- Add provider-neutral entities and state transitions.
- Add customer-scoped authorization, immutable version semantics, sanitized DTOs, and audit contracts.
- Use in-memory or deterministic test adapters only.
- Prove that inspection-disabled catalog state is valid.

**Exit evidence:** focused tests plus full repository check/test/build; no AWS or customer data.

### Stage 2 — Internal catalog API and operator surface

- Add internal-only catalog/product/specification/artwork metadata operations.
- Display no customer-facing route or navigation.
- Keep upload and inspection disabled.
- Prove exact `1249` tenant isolation using fixtures or a separately approved non-production record.

**Exit evidence:** authorization, DTO-safety, accessibility, and no-effect tests.

### Stage 3 — Private artwork upload foundation

- Create separate private, encrypted, versioned catalog-artwork storage.
- Add bounded direct upload/finalization, immutable checksum/version binding, content verification, malware scan, quarantine, retention, audit, queue, DLQ, and alarms.
- Do not reuse Proof storage or tables.
- Deploy dark before any object upload.

**Exit evidence:** inspected change set, dark deployment reconciliation, stable protected counts, empty queues, alarms OK, and no customer/provider action.

### Stage 4 — One inspection-disabled artwork version

- Authorize one exact fixture upload for the pilot manifest.
- Finalize and reconcile the exact object version/checksum.
- Complete content and malware checks.
- Retain the safe artwork version with inspection policy `disabled`.
- Confirm the operator sees `Inspection off` and the artwork remains usable within the internal catalog.

**Exit evidence:** immutable asset/version/audit packet and zero inspection/provider records.

### Stage 5 — Generic inspection orchestration

- Add provider registry, policy, queue, worker, idempotency, reconciliation, DLQ, telemetry, and private native-report contracts.
- Use a fake adapter to prove pass, warn, fail, unavailable, timeout/reconciliation, and duplicate-delivery behavior.
- Keep real provider dispatch disabled.

**Exit evidence:** deterministic automated tests and dark infrastructure reconciliation.

### Stage 6 — One advisory provider request

- Revalidate licensing, headless engine, fixtures, runtime limits, and adapter equivalence.
- Create one immutable `advisory` policy revision for the exact pilot scope.
- Authorize one exact inspection ID and provider request.
- Dispatch once; stop on ambiguous acceptance.
- Reconcile queued, running, and terminal evidence.
- Close the worker/provider gate after evidence capture.

**Exit evidence:** exact request/result identities, normalized evidence, native-report hash/reference, audit, queue/DLQ/alarms, cost/runtime, and proof of no unrelated mutations.

### Stage 7 — Versioned rerun

- Create either a new policy revision or approved engine revision.
- Run one new inspection without overwriting the first.
- Confirm both records remain independently auditable.

**Exit evidence:** immutable prior/new records and deterministic supersession link.

Proof shadow consumption, customer access, and required/enforced inspection are later programs, not pilot stages.

## 6. Internal operator language

Use wording that does not imply approval or order readiness:

- `Inspection off`
- `Queued`
- `Checking artwork`
- `Passed technical check`
- `Needs work`
- `Technical check unavailable`
- `Technical check failed`

Do not use `Approved`, `Print ready`, `Order ready`, or `Production ready` for a provider result.

## 7. Pilot success criteria

The pilot succeeds only if evidence proves all of the following:

1. A safe artwork version remains usable when inspection is disabled.
2. Exact customer, catalog, product, specification, object version, and checksum identities reconcile.
3. A provider receives structured dimensions, units, scale, and DPI target.
4. The adapter result matches the approved fixture expectation for the supported input.
5. Provider technical evidence is displayed without changing human approval or business release.
6. A provider failure or unavailability does not corrupt catalog or artwork state.
7. Duplicate queue delivery/provider response does not create duplicate inspection work.
8. Timeout after possible acceptance reconciles without blind resubmission.
9. A new policy/engine run does not overwrite earlier evidence.
10. Logs and safe DTOs contain no credentials, signed URLs, raw object keys, raw artwork, or unrestricted native payloads.
11. No Jobs, Order IDs, ProductMappings, Lift cache, routes, Wrike records, Proof records, or customer-facing records change.
12. Momentara and the unrelated failed `1249` Lift job remain unchanged.

## 8. Evidence packet

Every active pilot checkpoint must capture:

- repository base/head, PR, merged commit, and deployed artifact identity where applicable;
- approved action lock, actor, scope, and expiration;
- exact pilot manifest identifiers and checksums;
- before/after protected record counts;
- feature-gate and policy revision identities without secrets;
- queue depth, DLQ depth, alarms, worker concurrency, runtime, bytes processed, and cost indicators;
- append-only audit milestones and correlation IDs;
- normalized result and private native-report checksum/reference;
- no-effect reconciliation for Proof, Lift, Wrike, customer portal, Momentara, and the failed 1249 job;
- gate shutdown and rollback/closure confirmation.

Ambiguous provider or infrastructure state is a stop condition, not a reason to retry.

## 9. Rollback and closure

Rollback is capability shutdown, not evidence deletion:

1. Disable provider dispatch and worker event sources.
2. Prevent new upload initialization.
3. Allow in-flight reconciliation only under explicit authorization.
4. Verify queues, DLQs, alarms, and exact provider references.
5. Retain immutable inspection and audit records.
6. Apply approved retention policy to fixture objects/native reports after holds expire.
7. Confirm no customer-visible route or ordering/Proof action was enabled.

Do not delete or rewrite records to make counts look restored.

## 10. Explicitly out of scope

- Customer-facing catalog design or release.
- Pricing, cart, checkout, ordering, or order templates.
- Lift submission, Lift mapping recovery, or Wrike writeback.
- Proof approvals, revisions, grants, sessions, publications, or actions.
- Required/enforced inspections.
- Automatic approval, release, or ordering.
- Bulk catalog import.
- TIFF/PDF or other export generation.
- AI-generated decision notes.
- Direct linked-PSD fixture execution.
- General multi-page PDF production policy.
- Processing arbitrary customer production artwork.

## 11. Coordination and authorization

- **Pathfinder Development** owns shared domain/API/UI merge order and tenant behavior.
- **Artwork Catalog & Prepress Modules** owns the provider-neutral catalog and inspection vertical within approved branches.
- **Vornan Proof Development** reviews consumer boundaries and owns any later Proof shadow branch.
- **Pathfinder Live Support** owns production baselines, infrastructure/change-set review, exact action locks, alarms, evidence, shutdown, and rollback.

No stage inherits authorization from the previous stage. Code merge does not authorize deployment. Dark deployment does not authorize upload. Upload does not authorize a provider call. Provider evidence does not authorize Proof, Lift, ordering, or customer access.

## Appendix A: First provider-specific pilot facts

The first candidate provider is currently known by the working name **PixelGuard**. Its planning baseline is tag `pixelguard-v1-handoff`, commit `a11c620ba3e9587e99d996443cc65ad108dea0ae`.

Before Stage 6, the adapter team must verify repository access, licensing, dependency licensing, the deterministic headless boundary, the 23-input fixture manifest and hashes, expected PASS/NEEDS WORK outcomes, supported AI/PDF/TIFF/image variants, linked-asset handling, and page/artboard limits.

For the advisory pilot, native `PASS` maps to `pass`; native `NEEDS WORK` initially maps to `warn` while retaining provider-native detail privately. AI-generated notes and export functionality are excluded. This mapping is an immutable policy/adapter revision and does not define the shared platform contract.

# E-commerce field naming and provenance — 2026-09-28

Removed output order_type_name; due_date follows requested_ship_date with null for unmapped dates. Line identity now uses unit_number, product_id, customer_sku, product_name and description. Shop proof_status moved to approval.proof_status without changing approval semantics. Field origins and PDF page/trim versus final/live dimensions are documented in COMBINED_ECOMMERCE_REVIEW.md. Questioned source_status, market, priority and orientation remain optional, not silently removed.

- 668 API, 15 Lift adapter and 29 template tests passed; all workspace type checks passed.
- Thirteen focused template/preview cases passed, including required field ordering, explicit unmapped values, due-date preservation and proof-status placement.
- Regenerated Draft record and both synthetic previews. Source canonical registry/evidence and legacy High End Work/runtime routes remain intact; no live target/config/data changes, external writes, push or deploy.

---

# E-commerce grouping cleanup — 2026-09-28

Updated the isolated Draft/projection and regenerated both preview artifacts to match Marcus's grouping decisions. Live dimensions now appear after final dimensions; SKU is a single field below unit number; production starts material/laminate/varnish; cut type/shape/complexity/die reference are consolidated in `cut`. No material-code/finish/corner-description duplicates are exported. Source registry/evidence and High End Work remain intact.

- 668 API, 15 Lift adapter and 29 template tests passed.
- Final 13 focused tests passed after order grouping and explicit-null preservation refinements; all workspace type checks passed.
- Existing checks now verify supplied live dimensions, SKU mapping, output order, cut consolidation, reviewed target cut/laminate precedence and unchanged legacy generation.
- No live configuration, routes, customer data, target writes, deployment, dependency changes or migrations. Packaging/browser checks not repeated for this local output cleanup.

---

# Combined e-commerce field model — 2026-09-28

Builds on `88e6779`, implementing Marcus's clarified WooCommerce/Sticker Press field decisions. See [COMBINED_ECOMMERCE_REVIEW.md](COMBINED_ECOMMERCE_REVIEW.md) for normalization, omissions and remaining target/runtime boundaries.

- 668 API tests, 15 Lift adapter tests and 29 template tests passed; all workspace type checks passed.
- Thirteen focused template/preview tests passed, including generic e-commerce without Andy evidence, unchanged strict Sticker Press rejection, explicit null/zero/false/omitted handling, decimal precision, both roll modes and invalid/conflicting units/counts, and excluded XML passthrough fields.
- Reproducible synthetic combined preview and regenerated template/Andy preview; no raw XML, customer details or external artwork copied from the supplied XML into the repository.
- Pricing sections are always present with null unmapped values; no currency, totals or prices inferred. Shipping dates remain optional. Original/custom-area pricing deferred.
- Shared High End Work generator/runtime routes/registration remain unchanged. Generic export projection is still restricted to the explicit e-commerce template ID and cannot authorize submission.
- No live config/data/target writes, source URL calls, XML ingestion, customer creation/synchronization, push, merge or deploy. No new dependency or persistence migration. Existing production packaging/security/field-acceptance gates remain open; this iteration did not rerun packaging or browser tests.

---

# Lift E-commerce Orders template validation — 2026-09-28

Builds on local `13f42a2`. See [ECOMMERCE_TEMPLATE.md](ECOMMERCE_TEMPLATE.md) for exact scope and runtime/target acceptance limits. Created a local Draft artifact and explicit e-commerce projection; nothing is inserted into live config or selected by routes.

- 664 API tests, 15 Lift adapter tests and 29 template tests passed.
- All workspace type checks and API Lambda packaging passed. Final nine focused clone/preview tests and all workspace checks passed after required mapping refinement and the derived prepaid-label presence flag. Refreshed origin/main remains `14ff397b9b1bc317d9c22cb6023b95ba2360a5f7`.
- High End Work seed body compared to prior commit: unchanged after extraction to a pure factory. Default selection, normalization, empty-template fallback and ThinkDifferentPrint code are unchanged.
- Added optional canonical registry fields; tested uniqueness, global optionality and complete expansion mapping coverage.
- Added tests for immutable clone/custom mapping preservation, opt-in projection, four-line values, source/target distinctions, document separation and mismatched-line rejection. Updated the existing production projection expectation to include the newly requested source material/finish/shape fields; all final tests pass.
- No server, route, customer config, dependency, credentials, document grant, target order, submission/association or scheduler changes. Production installation/execution/field acceptance remain unverified. Full UI/browser and production smoke were not run.

---

# Lift-preview validation — 2026-09-28

Local slice 5a builds on `b8f7598`. Refreshed origin/main remains `14ff397b9b1bc317d9c22cb6023b95ba2360a5f7`; no intervening main changes. See [LIFT_PREVIEW.md](LIFT_PREVIEW.md) and the reproducible sanitized sample packet. Full slice 5 is still open pending authoritative mappings and a sanctioned target test.

| Check | Result |
| --- | --- |
| New `json-lift-preview.test.ts` | Five tests passed: complete four-line evidence/quantity/dimension/note preservation, no mutation and stable fingerprint; exact selectors and unit/product-ID alternatives; scope/production/unrelated-customer/duplicate rejection; access URL exclusion and prepaid/false-boolean handling; retained hash/size/line binding and rejection of unsupported or mismatched inspection claims. |
| API + Lift adapter regression | 660 API tests and 15 Lift adapter tests passed. Final focused tests passed after tightening inspection-result binding. |
| Type checks | All workspace checks passed; final API check passed after resolving a TypeScript narrowing error in the inspection projection. |
| Sample regeneration | Regenerated sample compares byte-for-byte with the committed candidate. Uses only the existing sanitized fixture and unresolved mappings; no private payload/artwork access. |
| Diff/source review | `git diff --check` passed; no shared runtime/exporter/store/dependency changes, no structured access URLs or private retained paths in the sample. |

The initial test helper called a nonexistent adapter method and was corrected to the actual validated adapter API; all final tests pass. No browser or deployment/packaging rerun was needed for this unmounted pure adapter; previous package checks do not establish production readiness. No customer/catalog network verification, submit request, job, document grant, target order, production config change, external callback, push, merge or deploy. The actual numeric customer ID, target products/materials and field acceptance remain unverified. Local review hashes are not production submit-integrity approvals. Existing asset/security/release gates remain open.

---

# Webhook-slice validation — 2026-09-28

Builds on local asset commit `4baa706`. Refreshed origin/main remains `14ff397b9b1bc317d9c22cb6023b95ba2360a5f7`; no intervening main changes. Branch remains `codex/json-intake-foundation`. Scope, contract review details and remaining gates are in [WEBHOOKS.md](WEBHOOKS.md).

| Check | Result |
| --- | --- |
| `json-webhooks.test.ts` final focused run | 14 passed. Exact sent raw-byte HMAC vector; mutation/key/time/store/header checks; crash before/after insert and concurrent materialization; stable bytes and key rotation; endpoint scope/config/destination pinning; ten-attempt schedule, Retry-After, permanent failures and exhaustion; uncertain claim recovery and stale acknowledgement; timeout/error redaction; resolved-issue suppression/history; replay identity/audit/destination binding; actual local HTTP receiver and durable dedup; confirmation association mismatches and cross-read drift; out-of-order consumer example; real process restart/cross-process CAS; authenticated status ownership before webhook reads. |
| `npm run test --workspace @pathfinder/api` | 654 passed, zero failures/skips, including the first 13 webhook tests. The final focused run adds the 14th authenticated status test and extra crash/replay assertions. |
| `npm run check` | All workspace type checks passed after final source changes. |
| `npm run package:api-lambda` | Existing API package built. Inspection found none of the new webhook transport/event markers in the artifact: the module remains unmounted. This does not validate a future production webhook bundle. |
| Main refresh / diff | Origin main unchanged; `git diff --check` passed. Source-only file allowlist excludes handoff, artwork, runtime/output data, secrets and private payloads. |

The local receiver required approved loopback-capable test execution. No external destination was contacted. No push, merge, deployment, production data/config/credential changes, Lift/Wrike writes, notifications or partner callbacks occurred. No dependency or shared runtime changes. Local confirmation fields are additive; new journals require their current reader/worker and preserved history. Production durability, scheduling, key/endpoint registration, incident routing, authoritative target adapters and all prior asset/release gates remain open. No browser/UI changes were made.

---

# Asset-slice validation — 2026-09-28

This section records the next local slice on top of `38daa0cc683073e7aa352059458bca7a1e48a010`. Refreshed origin/main remains `14ff397b9b1bc317d9c22cb6023b95ba2360a5f7`; no intervening main changes. Branch remains `codex/json-intake-foundation`. Scope/limitations and exact dependency sources are in [ASSET_REVIEW.md](ASSET_REVIEW.md).

| Check | Result |
| --- | --- |
| New `json-intake-assets.test.ts` | 18 passed. Covers URL/host/private IP/DNS/redirect checks; actual Node request pinning/TLS options/remote socket guard via injected socket; streamed bounds, DNS/body deadlines and safe errors; compressed/uncompressed PDFs; malformed/truncated/encrypted/multipage/invalid boxes/UserUnit/rotation; nested Form/DeviceN and catalog-only/unused resources; provisional geometry tolerance; real worker termination and compressed object-stream allocation guard; checkpoint recovery; separate previews; concurrent/crashed/exhausted retry budget. |
| Existing `json-intake.test.ts` | All 16 continue passing; internal transient test now advances the clock for explicit backoff. |
| `npm run test --workspace @pathfinder/api` | 641 tests passed, zero failures/skips. |
| `npm run check` | All workspace type checks passed. |
| `npm run package:api-lambda` | Existing API package built. Artifact inspection confirms this unmounted JSON/worker code is not included. **Not a packaged-runtime validation of the new inspector.** Local worker refuses Lambda until that separate integration is reviewed. |
| Private four-reference review | All four unchanged local PDFs passed checksum/approval binding, single-page box comparison, named page/Form spot/layer presence using explicit local 0.001-inch policy. No network fetch; no PDF rewritten; no manufacturing or malware approval claimed. |
| Manifest/lock | Only pinned pdf-lib 1.17.1 and its dependency closure added; existing dependency versions unchanged. Public license metadata recorded in ASSET_REVIEW.md. |
| Dependency advisory review | Partial public-name-only research recorded, including upstream issue 1773 and reachability limits. Full repository npm audit was blocked by automatic approval review over private dependency metadata disclosure and was not bypassed. Security clearance remains open. |
| Diff/privacy | `git diff --check` passed; source-safe allowlist excludes handoff/artwork/runtime/output artifacts. |

No push, merge, deployment, customer network calls, production data/config/credential changes or external order/notification writes. No shared Proof/artwork inspection/ledger/runtime/deployment file changes. Local receipt additions are optional fields; previous foundation snapshots remain readable and explicitly retain `inspection: not_run`. A legacy reader can load JSON but will not enforce the new retry budget/inspection behavior: do not run older workers over these local receipts. This is not a production schema migration or rollback certification.

Open gates: full dependency/security review, process-level parser containment, actual worker artifact/notice/dependency packaging and packaged-runtime tests, approved metadata/color/cut policy, authenticated production store/caller config, actual host allowlist, customer/Lift mapping, and existing release smoke/browser/deploy compatibility matrix. No code here enables production.

---

# Local validation record — 2026-09-28

Baseline and refreshed origin/main: `14ff397b9b1bc317d9c22cb6023b95ba2360a5f7`. Branch: `codex/json-intake-foundation`. The accompanying foundation commit is the local candidate; record an exact release/merge SHA separately if later proposed for release.

## Executed

| Check | Result |
| --- | --- |
| Handoff manifest transfer | All 36 immutable entries: SHA-256, byte count and preserved file mode match. Mutable coordination files copied separately. |
| `npm run check` | All workspace TypeScript checks passed. |
| `node --import tsx/esm --test apps/api/tests/json-intake.test.ts` | 16 passed, including loopback auth/status, concurrent identity reservation, cross-process receipt CAS/restart, existing shared local ledger restart, crash boundaries, stale claim rejection, operator-review preservation, integrity/expiry/errors and URL refresh. Rerun after final directory fsync tightening. |
| `npm run test --workspace @pathfinder/api` | 623 passed, zero failures (includes the 16 new tests). Existing intake, public intake/auth, Proof, Status and writeback API regressions included. |
| `npm run test --workspace @pathfinder/templates --workspace @pathfinder/lift-adapter --workspace @pathfinder/wrike-adapter` | 29 template, 15 Lift adapter, 55 Wrike adapter tests passed. |
| `npm run check --workspace @pathfinder/api` | Rechecked after final foundation changes. |
| Immutable sent HMAC vector | Exact raw-body MAC/event ID match; altered trailing byte rejected. No signing implementation or partner delivery added. |
| Local original-PDF integration check | Four privately retained handoff PDFs read only from local files, retained unchanged through this service, byte/hash/approval checks passed. Retry reused one receipt and one shared local attempt. Zero jobs/submissions. Temporary private test store removed afterward. |
| `git diff --check` and staged privacy review | Required before local commit; handoff/artwork/runtime files excluded. |

One initial loopback test run failed because the filesystem sandbox disallowed the local listener. It passed with approved loopback-capable execution. A quantity-conflict test was updated to keep declared area consistent after the adapter gained area validation; the changed valid order then exercised 409 as intended. No failing checks remain in the final focused run.

## Scope and limits

The synthetic `%PDF-` fixture deliberately proves integrity checks only. It is not a structurally valid production PDF and tests/status explicitly retain `inspection: not_run`. The private original-PDF check verifies unchanged source bytes and approval linkage; it does not rerun PDF geometry, contour, color or malware inspection. The earlier source inspection reports remain unchanged in the private handoff.

No browser/UI changes. Full frontend browser regression, deployment-contract/packaging checks, production DynamoDB durability/fencing, current deployed surface/config inventory, production smoke, customer activation, shipping/callback delivery, and rollback exercise were not run. They are release gates under RELEASE_COORDINATION.md, not satisfied by these local tests. The API router is unmounted/default-disabled, test-only; no live Lift/Wrike/email/callback or production config/data action occurred.

## Release ledger

- PR / merge SHA: none; local review foundation only.
- Changed existing files: `.gitignore` (private handoff exclusion), `packages/canonical/src/index.ts` (type exports only).
- New files: isolated JSON intake adapter/auth/local-store/service/router, canonical extension, sanitized fixture, tests and these design/validation documents.
- Production/config/IAM/schema migration diff: none. Local receipts are versioned 1 and append-only; no existing shared storage mutation/migration is required by this unmounted module.
- Existing hotfixes: main re-fetched at completion; no intervening changes beyond kickoff baseline.
- Deployment artifacts/workflows/current surface baselines: not checked; no deployment requested.
- Rollback for this local slice: stop the test harness/remove its mount; preserve private receipts/assets for investigation. Never delete shared production data. Future release requires verified per-surface artifact/config rollback and explicit user authorization.

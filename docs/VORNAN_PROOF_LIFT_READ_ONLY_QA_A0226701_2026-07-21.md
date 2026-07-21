# Vornan Proof approved Lift read-only QA — A0226701 — 2026-07-21

## Authorization and decision

The operator explicitly approved Lift order `A0226701` for testing on 2026-07-21. The approved scope was production Lift `GET` synchronization, order/order-line correlation, `ORDER_LINE_ID` matching, Proof retrieval, and cached refresh behavior in the isolated dark `vornan-proof-dev` stack.

The Lift-originated path passed after correcting a signed-URL cache-comparison defect discovered by the approved refresh. The Pathfinder-originated path remains untested because this order has no exact production Pathfinder job or submit-attempt match. A second explicitly approved Pathfinder-originated order is required.

This result does not authorize public reads, DNS, grant or link email, proof decisions, or any Lift write. `ReadOnlyQaConfirmed` remains `false`.

## Safety boundary

- Stack: `vornan-proof-dev`, region `us-east-1`.
- Source branch: `codex/proof-synthetic-lifecycle-qa` from `origin/main` commit `77a000b0c1c23a3af7cf35d1a805749b8d4f44b0`.
- `SyntheticQaEnabled=false` throughout the real-order runs.
- `PublicReadEnabled=false`, `ReadOnlyQaConfirmed=false`, and `ProductionPublicReadApproved=false`.
- Grant creation and public read were false in the deployed sync worker configuration.
- Domain and certificate inputs remained empty.
- The sync queue and DLQ were empty before the first request.
- `A0226701` was absent from the isolated Proof cache before testing.
- No raw Lift payload, customer name, order title, filename, proof URL, comment, token, cookie, or signed query value was retained in this evidence.

The worker used the existing `@pathfinder/lift-proof-adapter` read path. It supplies no HTTP method, so Fetch uses `GET`; the adapter exports no implemented Lift Proof write capability. Repository tests independently require queued refresh traffic to contain `GET` methods only and keep all write flags false.

## Initial approved run and defect discovery

The first sync created a normalized active aggregate:

- 3 order lines with 3 unique Lift `ORDER_LINE_ID` values.
- 3 Proof tasks and 3 unique attachments.
- All 3 tasks carried an order-line ID that matched exactly one cached order line.
- All 3 line-scoped Proof report reads succeeded and returned 3 total proof rows.
- No order-scoped fallback read occurred.
- No normalization warning, line-number fallback, unmatched proof, missing attachment, or duplicate mismatch occurred.
- Each proof had a current HTTPS preview and download target; none had URL credentials.
- `proof.sync_completed` and `proof.review_ready` were recorded.

An immediate unchanged refresh again completed all three line-scoped reads, but the cache advanced the order and every task to version 2. Field-category comparison showed that only `preview_url` and `download_url` changed. For all three proofs, the HTTPS origin/path remained identical and only the signed query parameters rotated.

That behavior was a cache correctness failure: refreshing a signed access URL must not create a false customer-visible file version.

## Correction

Proof-domain comparison now treats a proof asset's scheme, host, and path as its stable identity while ignoring rotating query and fragment components for change detection. On an otherwise unchanged refresh it:

- keeps the existing order, task, and proof version identifiers;
- refreshes the current preview/download URLs so the newest signatures remain usable;
- preserves the existing version-history length and timestamps;
- still creates a new version when the asset host/path or any proof metadata changes.

Regression coverage verifies both rotating signed-query preservation and genuine path-change versioning.

The correction was packaged as:

- Artifact: `proof/dev/vornan-proof-lambdas-approved-readonly-cache-fix-20260721T140123Z.zip`.
- SHA-256: `d0db160b07329885872c8150a523468584232932b7631a14dc05470a739f8201`.

It was deployed only to `vornan-proof-dev` with synthetic mode and all public/readiness gates false.

Before rerunning, the exact dev-only `ORDER#A0226701` partitions created by the discovery run were reset: 10 core records and 3 audit records. The selector queried only that exact partition; no Lift or Pathfinder production record was modified.

## Corrected live result

The clean first sync and unchanged refresh both passed:

| Check | First sync | Unchanged refresh |
| --- | ---: | ---: |
| Order lines | 3 | 3 |
| Unique line IDs | 3 | 3 |
| Proof tasks / unique attachments | 3 / 3 | 3 / 3 |
| Tasks matched to cached line ID | 3 | 3 |
| Successful line reads | 3 of 3 | 3 of 3 |
| Proof rows | 3 | 3 |
| Fallback reads | 0 | 0 |
| Normalization warnings | 0 | 0 |
| Order version | 1 | 1 |
| Task versions | 1, 1, 1 | 1, 1, 1 |
| History entries per task | 1, 1, 1 | 1, 1, 1 |

The normalized-content hash after removing sync timestamps/diagnostics and signed query components was identical before and after refresh: `d2b73f522f2ad9d436f9ff2f1a0e125579608450dde74bb55c02f20612d348d3`.

Audit idempotency also passed:

- `proof.sync_completed`: 2.
- `proof.review_ready`: 1.
- No failure, all-reviewed, reopened, grant, session, participant, feedback, email, or decision event.

The retained isolated cache contains 1 profile, 3 task records, and 3 version records. It contains no grant or other lifecycle records.

## Origin classification

Read-only exact-order presence checks returned zero matches in both `Pathfinder-Jobs-prod` and `Pathfinder-SubmitAttempts-prod`. No table item was returned or changed. Therefore `A0226701` validates the direct Lift-originated order path, not the Pathfinder-originated path.

No unapproved order was selected or queried to fill the missing Pathfinder-originated case.

## Telemetry, queues, alarms, and public boundary

- Four approved sync messages were processed successfully: two discovery operations and two corrected confirmation operations.
- Each operation performed one order read plus three line-scoped proof-report reads. Across the complete approved investigation, 16 production Lift requests were made, all through the GET-only adapter path.
- The worker log window contained 18 events and 4 bounded `sync_order` metric records with zero server-error metric records.
- Sanitized log scans found no approved order number, access token/URL, session token, customer or recipient email, or proof-link field.
- The main queue and DLQ ended at zero visible, in-flight, and delayed messages.
- All nine `vornan-proof-dev` alarms remained `OK`.
- The post-cache repository smoke passed: public read false, decisions false, invalid and unauthenticated requests denied, decision routes absent, and direct API bypass rejected.
- No customer order or proof detail was exposed through CloudFront.

## Deferred validation and next approval

The following remains intentionally deferred:

- Proof retrieval for one Pathfinder-originated order.
- Cross-checking that order's persisted Pathfinder target order number against the Lift order header.
- Exact `ORDER_LINE_ID` matching and unchanged refresh behavior for that second origin path.

The operator must provide and explicitly approve one exact Pathfinder-originated Lift order number before those reads occur. All existing guardrails remain unchanged while awaiting it.

## Repository validation

- `npm run check` passed across every workspace.
- `npm run test` passed all 133 workspace tests: 69 API, 17 Proof UI, 2 Status, 4 admin web, 5 Lift proof adapter, 5 Order Rollup, 20 proof-domain, and 11 templates.
- `npm run build` passed for the API and all three production SPAs.
- `npm run test:proof-deploy` passed all 25 deployment-safety tests.
- Proof Lambda packaging, targeted API/proof-domain checks, artifact hashing, the post-cache dark smoke, credential-free asset checks, and `git diff --check` passed.

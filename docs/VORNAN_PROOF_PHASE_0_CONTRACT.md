# Vornan Proof Phase 0 contract and write gate

Authoritative architecture: `docs/VORNAN_PROOF_PATHFINDER_ARCHITECTURE_HANDOFF_2026-07-19.docx`.

Implementation branch: `codex/vornan-proof-foundation`.

Current implementation phase: Phase 0 contract capture, Phase 1 read-only vertical slice, and the default-off Phase 2 tokenized customer-read foundation with deployment, operator-visible integration posture, per-route bounded telemetry, operational readiness, immutable lifecycle audit controls, isolated identity/feedback-acknowledgement prerequisites, aggregate-only reviewer activity, bounded customer-safe display/proof/feedback metadata, task-scoped file history with approval/technical-check metadata, resilient customer-safe lifecycle states and server-owned counters, sanitized sync diagnostics, idempotent read-derived review lifecycle transitions, customer-safe quantity metadata, an explicit read-only completion state, deterministic accessible dialog/bottom-sheet focus behavior, a bounded automatic refresh lifecycle, an automated Adspace-artifact rejection gate, fail-closed grant prerequisite synchronization, a shared `ORDER_LINE_ID`-first join contract with Order Rollup, a customer-safe Proof-to-Status projection, and fail-closed local QA persistence. This checkpoint is not authorization for Lift approval, undo, or revised-art writes.

## Hard write gate

All Lift proof decision capabilities remain unavailable in code during the read-only foundation phase:

- `@pathfinder/lift-proof-adapter` exposes AS360Orders and AS360ProofReport reads only. It contains no proof decision URL builder, JWT signer, PUT transport, approval body, revision body, or undo body.
- `apps/api/src/proof/runtime-config.ts` returns literal `false` for approval, revision, and undo. Environment variables cannot enable those capabilities. Grant creation and public read have separate default-off flags because they do not write to Lift.
- Public customer reads run through `apps/api/src/proof/public-server.ts`, a separate Express/Lambda entry point with narrowly scoped session cookies and no decision routes. The public router is never registered in the authenticated Pathfinder monolith.
- Existing Pathfinder order submission remains controlled by its separate `PATHFINDER_ENABLE_LIFT_SUBMIT` gate and is not reused for Proof decisions.

Lift proof writes may be designed in Phase 3/4 only after all of the following are confirmed and recorded:

1. The Lift QA proof endpoint has an isolated lifecycle that cannot silently target production.
2. Dedicated QA proof credentials are available; the currently shared production credential boundary is removed or explicitly accepted by the security owner.
3. Exact approval and revision bodies, JWT claims/headers/lifetime, response shapes, and `approveQuantity` behavior pass contract tests.
4. A real QA approval reaches the intended `ATTACHMENT_ID` and a subsequent read confirms the stable state.
5. A real QA revision completes private upload, direct 200 delivery, Lift ingestion, and regenerated-proof synchronization without leaving the old attachment actionable.
6. Approval and revision feature flags remain independently controlled, default off, and are reviewed before any production enablement.

## Phase 0 decision status

| Contract area | Recorded direction | Implementation status |
| --- | --- | --- |
| Lift read authentication | AS360Orders and AS360ProofReport require no custom headers or Basic Auth. | Implemented as `Accept: application/json` only. |
| Order syntax | Uppercase `A` plus 7-8 digits. | Implemented and tested. |
| Aggregate identity | Lift order number. | Implemented. Direct orders do not depend on a Pathfinder job. |
| Task identity | One active task per `ATTACHMENT_ID`; `ORDER_LINE_ID` is parent context. | Implemented and tested. |
| Compatibility join | One shared Order Rollup matcher applies `ORDER_LINE_ID` first; `LINE_NUMBER` is only an observable fallback. | Implemented and tested in Proof and the shared rollup. |
| Status projection | Status and Order Rollup consume the normalized Proof cache when available; no Proof grant, session, participant, or decision authority crosses that boundary. | Implemented with a sanitized read-only Lift-report fallback. |
| Read sequence | AS360Orders `p0`, line-scoped AS360ProofReport `p1`/`p2`, concurrency at most 5. | Implemented and tested. |
| Report fallback | One order-scoped fallback only after failed line reads return no usable proof rows. | Implemented and tested. |
| Read failure behavior | Never erase cached tasks or history; missing order becomes health state. | Implemented in the domain merge and local/Dynamo persistence. |
| Proof history | Preserve replaced/disappeared attachments before removing them from the active queue. | Implemented and tested. |
| Dedicated persistence | Proof core uses its own `pk`/`sk` table with attachment and line indexes, on-demand billing, SSE, and PITR. | CloudFormation and local adapter implemented; local mutations are serialized and atomically replaced, malformed stores fail closed; deployment not performed. |
| Known Lift contract fixtures | Real response topology for nested `LINES`, sibling attachments, and a completed/reference order. | Manually redacted fixtures and exact normalization tests implemented; customer creative, signed URLs, comments, and reports removed. |
| Lift QA endpoint lifecycle | QA endpoint is distinct but currently shares production credentials. | Open hard gate for all Lift Proof writes. |
| Large revision files | At least 800 MB with resumable multipart; ZIP excluded from Lift artwork. | Recorded for Phase 4; no upload or revision code exists. |
| Support SLA | `support@vornan.com`; response target/escalation required before pilot. | Pre-pilot operating follow-up. |

## Phase 1 read-only slice

Implemented boundaries:

- `packages/order-rollup`: shared Lift line normalization plus the authoritative `ORDER_LINE_ID`-first proof/package matcher consumed by both Order Rollup and Proof.
- `packages/proof-domain`: normalized order/task/version model, attachment grouping, sibling labels, state derivation, shared line matching with compatibility warnings, no-op merge stability, missing-order preservation, and archived history.
- `packages/proof-domain`: one customer-safe Order Rollup projection derived from the normalized Proof aggregate, including bounded proof assets and aggregate review counts but excluding Proof task identities, attachment identities, grants, sessions, participants, feedback, audit data, and decision authority.
- `packages/lift-proof-adapter`: independently configurable read hosts, validated order query, line-scoped proof queries, bounded concurrency, timeout/error translation, and controlled fallback.
- `apps/api/src/proof`: dedicated local/Dynamo persistence plus authenticated sync, inspection, and read-health routes. Each successful sync persists a bounded diagnostic summary containing counts only; Lift URLs, line identities, raw errors, credentials, and customer files are excluded. The local QA driver preserves malformed data, atomically replaces the live file, and serializes mutations within one API process.
- `infra/aws/proof-cloudformation.yaml`: dedicated retained Proof core table with PITR, SSE, attachment index, and line index.

Authenticated operator endpoints:

- `POST /api/proof/orders/{orderNumber}/sync`
- `GET /api/proof/orders/{orderNumber}`
- `GET /api/proof/health/lift`
- `POST /api/proof/orders/{orderNumber}/grants` (default off; view scope only)
- `GET /api/proof/orders/{orderNumber}/grants`
- `GET /api/proof/orders/{orderNumber}/audit` (restricted, redacted, newest-first pagination)
- `PATCH /api/proof/grants/{grantId}` (update, revoke, or regenerate; default off)
- `POST /api/proof/grants/{grantId}/email` (default off; validates the exact unused grant link and returns masked delivery metadata only)
- `GET /api/proof/grants/{grantId}/participants` (restricted operator view; name/email never enter public aggregate responses or audit metadata)

Required runtime configuration for DynamoDB:

```text
PATHFINDER_PROOF_STORAGE_DRIVER=dynamodb
PATHFINDER_PROOF_CORE_TABLE=Pathfinder-ProofCore-{environment}
PATHFINDER_PROOF_AUDIT_TABLE=Pathfinder-ProofAudit-{environment}
PATHFINDER_PROOF_LIFT_ORDER_READ_URL=https://admin.lifterp.com/.../AS360Orders/N?offset=0
PATHFINDER_PROOF_LIFT_REPORT_READ_URL=https://admin.lifterp.com/.../AS360ProofReport/N?offset=0
PATHFINDER_PROOF_LIFT_READ_CONCURRENCY=5
PATHFINDER_PROOF_LIFT_READ_TIMEOUT_MS=15000
PATHFINDER_PROOF_READABLE_MIN_STEP=<Lift-owner-confirmed value>
PATHFINDER_PROOF_ENABLE_GRANT_CREATION=false
PATHFINDER_PROOF_ENABLE_LINK_EMAIL=false
PATHFINDER_PROOF_REPLY_TO=support@vornan.com
PATHFINDER_PROOF_PUBLIC_BASE_URL=https://proof.vornan.co
```

The local Phase 1 contract gate is met. The redacted `A0221132` fixture verifies the actual nested `LINES` response and four distinct sibling attachments all join once through real `ORDER_LINE_ID` `9301338`, without compatibility fallback. A conflicting `LINE_NUMBER` regression proves the authoritative ID wins in both Proof and the shared Order Rollup contract. The redacted `A0219609` fixture verifies completed/invoiced state is retained as a non-actionable reference. Dedicated local-store tests prove malformed QA lifecycle data remains byte-for-byte intact and concurrent in-process mutations are retained. Separate local API processes must still use distinct `PATHFINDER_PROOF_LOCAL_STORE_PATH` values. A deployment smoke test against the dedicated table and authenticated operator routes remains required before rollout.

## Phase 2 tokenized customer-read foundation

Implemented boundaries:

- 32-byte base64url grant and session secrets; SHA-256 hashes are the only persisted secret material.
- Raw grant tokens are returned in a fragment URL exactly once and can be exchanged only once.
- `HttpOnly; Secure; SameSite=Lax; Path=/api/public/proof` session cookies.
- A separate non-`HttpOnly`, `Secure`, `SameSite=Lax` double-submit CSRF cookie is session-bound by a persisted SHA-256 hash. The raw CSRF token is never stored, returned in JSON, or accepted without an exact header/cookie match.
- Session validation reloads the grant on every request, enforcing expiry, revocation, scope, and one-order isolation.
- The customer response includes only the session expiry deadline needed for browser lifecycle control. Invalid/used grant fragments route to `#/link-unavailable`; expiry, revocation, explicit logout, and authenticated `401` responses route to `#/session-ended` and remove all proof content from view.
- Customer-safe DTOs omit Lift line/attachment identifiers, customer identity, approver identity, normalization warnings, raw detailed reports, fingerprints, and raw internal objects.
- `apps/proof`: responsive view-only queue/detail SPA with proof thumbnails, state counters, product/line/filename/status search, siblings, contained preview/download, modal feedback and version history, and a stable but disabled decision transport.
- The public order DTO owns integer counts for `pending`, `regenerating`, `waiting`, `reviewed`, and `total`. The SPA presents the first three independently and shows reviewed/total together. Approved and production-reference tasks are both customer-safe reviewed history; references are never relabeled as customer approvals. Cancelled, missing, and file-error tasks remain in total without being misclassified into a positive or actionable counter.
- Customer-visible Lift strings are normalized again at the public boundary: order title (160), order status (80), line number (32), product name (160), approval status (40), and feedback text (8,000) have explicit maximum lengths; ASCII control characters and unstable whitespace are removed. Customer-visible version/comment timestamps must be parseable and no longer fall back to an arbitrary raw string. Each public version exposes at most 100 feedback entries. When Lift supplies no usable title/status, the SPA uses `Order A########` and `Proof review`; development-only `#/proof/display-fallback-qa` covers this state without inventing order data.
- Each task carries its joined Lift line `QUANTITY`/`ORDER_QUANTITY` into the customer-safe DTO only when it is finite, non-negative, and no greater than 1,000,000,000. The SPA labels it only as `Qty`; assigned-location, allocation, and mismatch concepts remain absent.
- Public proof versions expose a bounded server-owned asset descriptor: sanitized filename/MIME metadata, credential-free HTTPS low/high URLs, and one deterministic `image`, `pdf`, `download`, or `unavailable` preview kind. Unsafe schemes, embedded URL credentials, protocol-relative references, active SVG/HTML preview, and malformed URLs are removed. Low-resolution image/PDF URLs remain the contained preview while the safe high-resolution URL remains the open/download target; if only the high-resolution browser-native file survives validation it becomes the preview fallback.
- The SPA revalidates asset URLs before rendering. PNG/JPEG/GIF/WebP use contained images; PDF uses a contained, keyboard-reachable browser viewer with native paging/zoom plus explicit open/download guidance; TIFF/PSD/AI/EPS/INDD and other non-browser-native files use a metadata card and safe full-resolution action without an embedded active preview. A valid 676-byte one-page PDF fixture and a development-only `#/proof/assets-qa` packet cover PDF, long filename, prepress download-only, and conversion-unavailable states.
- Queue filtering cannot leave a hidden task rendered in the detail pane. Queue cards expose one selected option, support Arrow/Left/Right/Home/End keyboard movement, and present distinct no-proof, no-open-proof, and filter-empty states.
- Lift revision-like approval statuses normalize to a non-actionable `revised` task state and render to customers as `Regenerating`; the prior synchronized file remains reference-only while the task stays in the open queue. Waiting, reference, cancelled, missing, and file-error states have bounded customer-facing explanations. Active packets older than the configured freshness window are projected as `stale` without mutating the stored Lift-derived aggregate or removing cached proofs; missing/error packets likewise preserve and explain available cached content.
- Orders with at least one reviewed task and no pending, waiting, regenerating, missing, or file-error task render an explicit read-only success state. Active all-approved packets say `All proofs reviewed`; complete/reference packets say `Proof packet complete`. The default Open view links directly to Reviewed so approved and production-reference files stay browsable. Stale, missing, and error order health cannot produce a false completion state. Development-only `#/proof/all-reviewed-qa` and `#/proof/complete-qa` fixtures cover both presentations without emitting a completion event or contacting Lift.
- The desktop shell consumes the full viewport while the searchable queue scrolls independently and the selected artwork remains fully contained above the stable decision transport. Narrow and short-landscape layouts become a stacked proof-review feed with sticky inbox controls, bottom-sheet feedback/history, 44 px search/filter/file/decision targets, reduced-motion behavior, contained artwork, PDF guidance, and an explicit safe fallback for non-previewable files.
- Feedback, file-history, and reviewer-identity surfaces use native modal isolation with explicit accessible names/descriptions. Feedback/history place initial focus on their close control; reviewer identity places it on the name field. Close and Escape return focus to the exact connected opener, with a selected-proof fallback if that opener disappeared. Opening reviewer identity from feedback never exposes two open dialogs or returns focus through the background between them.
- Pathfinder Jobs now includes an authenticated Vornan Proof operator panel for direct-order synchronization plus labeled view-link creation, listing, revocation, and regeneration.
- The operator panel now presents a redacted integration-health posture for persistence, reviewed Lift read hosts, isolated refresh queue, edge boundary, freshness policy, and customer capability gates. It distinguishes local QA, configuration-required, dark-deploy-ready, and active read-only states without claiming Phase 3 readiness. Only hosts and configuration booleans cross the health boundary; secrets, queue URLs, Lift paths/queries, and customer identifiers remain excluded.
- Shared authenticated and public Order Rollups prefer the cached normalized Proof projection. When that cache is present, order snapshot construction skips the second raw Lift proof-report read. If the cache is absent or unavailable, the existing Lift report remains a read-only fallback and is re-allowlisted at the public Status boundary. Status shows normalized pending/regenerating/waiting/reviewed progress and directs reviewers to their dedicated Vornan Proof email; a Status token never becomes Proof authorization and `decisions_enabled` remains literal `false`.
- Authenticated grant creation fails closed before cache lookup or Lift traffic when its default-off flag is disabled. When enabled, an uncached direct Lift order performs its first read-only sync before grant issuance; a stale cached order refreshes first, a fresh cached order avoids the extra Lift read, and any prerequisite read failure returns without creating a grant or raw link.
- The same authenticated panel can copy or privately deliver the one-time link. Email delivery has an independent default-off gate, accepts only the exact unused active grant URL, uses `Vornan Updates <notifications@notify.vornan.co>` with `support@vornan.com` Reply-To, supplies text and HTML bodies, and opts Proof bearer-link messages out of the general SES configuration set so the application does not enable click/open tracking.
- Reviewers may optionally identify themselves by name and email while the experience remains view-only. Identity is bound to the current grant/session, can be updated by that session, is visible only through the authenticated operator boundary, and produces redacted audit events containing identifiers but no name or email. Public responses expose only the current session's own identity plus aggregate reviewer count/activity time with `reviewer_names_visible=false`; another reviewer's name or email never crosses the public boundary.
- Current feedback can be explicitly acknowledged only by an identified participant through a CSRF-protected Proof-local route. The acknowledgement is bound to the participant, task, grant, and current feedback fingerprint; changed attachment/comment feedback automatically makes the prior acknowledgement stale. Public DTOs expose only the `required`/`acknowledged` state, while audit records identifiers without comment text or fingerprints. This acknowledgement does not approve a proof, request a revision, or contact Lift.
- Feedback comments include a bounded customer-safe attachment projection. The serializer accepts deduplicated filenames, valid MIME labels, and HTTPS links without embedded username/password credentials from Lift `COMMENT_ATTACHMENT`; arbitrary object fields, unsafe schemes, malformed JSON/blobs, control characters, internal thread/file IDs, and private notes are excluded. The feedback modal renders available links as keyboard-accessible 44 px file actions and labels metadata-only attachments without inventing a URL.
- File history is available through a dedicated authenticated task route. The server resolves the task only inside the session's granted order and returns the same customer-safe version DTO used by the order response; Lift attachment IDs, approver identity, raw detailed reports, feedback fingerprints, raw rows, and internal warnings are excluded. The SPA opens from cached history, lazily checks the task route, and retains the cache if that check fails.
- Public version history includes approval status/date plus an allowlisted `technical_checks` projection derived from Lift `DETAILED_REPORT`. Only bounded check names and statuses are eligible; duplicate checks are collapsed, URL/token-shaped values are rejected, and raw report objects, report details, internal IDs, signed links, and approver identity remain private. The history sheet presents these fields for the selected version without adding a customer write.
- Separate public Lambda/API Gateway resources with a dedicated least-privilege IAM role. Infrastructure defaults public read to `false`.
- Private versioned S3 hosting, CloudFront OAC, SPA rewriting, same-origin `/api/public/proof/*` routing, hardened response headers, optional WAF attachment, TLS-only bucket policy, and deployment scripts.
- Stale customer reads enqueue a deduplicated FIFO refresh request only while the stored aggregate is active and its proof state changed within the configured automatic-refresh window (14 days by default). Complete/reference, missing/error, and long-inactive packets remain browsable without continuous Lift polling. Invalid change timestamps fail closed and do not auto-queue. A concurrency-limited worker performs eligible Lift GETs and normalized persistence through an encrypted queue and DLQ; the authenticated manual refresh remains available for every valid session regardless of automatic eligibility.
- Manual customer refresh is an authenticated `202` queue action with its own WAF rate limit. It never waits on Lift, and the SPA truthfully keeps the cached packet visible while refresh work runs.
- DynamoDB TTL on `ttl_epoch` for short-lived sessions only. Grants expire logically and remain as operational evidence.
- Deployment preflight requires an explicit stage-matched Lift read environment and reviewed URLs, rejects silent non-production use of recorded production Lift hosts, and fails any attempted Lift approval/revision/undo flag.
- Token-safe embedded metrics, retained Lambda/API access logs, SLO alarms, queue/DLQ alarms, and a CloudWatch dashboard provide read-only operational evidence without logging Proof secrets or customer payloads. Every Phase 2 public route maps to a fixed low-cardinality operation (`token_exchange`, `cached_order_read`, `task_history`, `participant_identity`, `feedback_acknowledgement`, `manual_refresh`, `session_logout`, or `health_read`); task IDs and other customer identifiers never become metric dimensions. The protected Proof workflow runs the deployment-safety suite before artifact packaging or any AWS mutation.
- `scripts/smoke-proof-read-only.mjs` verifies same-origin security headers, default-off health flags, generic denial behavior, absent decision routes, and direct API bypass rejection after deployment.
- A separate retained, encrypted, PITR-enabled `Pathfinder-ProofAudit-{environment}` table records append-only sync, grant, and session lifecycle events. Read normalization derives `proof.review_ready`, `proof.all_reviewed`, and `proof.review_reopened` only when the normalized state changes, so a no-op sync cannot duplicate them. These are restricted audit/readiness signals only; no external event dispatch, customer decision, or Lift write is implied. Public and worker roles can append only; authenticated support/platform operators can query redacted order-scoped pages.
- Audit metadata is a closed allowlist. Events contain lifecycle identifiers, action/outcome, actor type, correlation, time, and safe link-delivery mode/status, but never customer email, creative, filename, comment, raw payload, bearer/session hash, or signed URL.
- `scripts/tests/proof-artifact-rejection.test.mjs` enforces the architecture's customer-boundary rejection checklist during the deployment safety suite. It scans the Proof SPA, its brand assets and tests, the public router/service projection, the proof domain, and the Lift proof read adapter for Adspace identity/domains/integration names/imports/sample identifiers and for excluded project, venue, inventory, room, allocation, assignment, transit, campaign, or tenant concepts. A match fails `npm run test:proof-deploy` before packaging or deployment.

Isolated public endpoints:

- `POST /api/public/proof/sessions`
- `GET /api/public/proof/order`
- `GET /api/public/proof/tasks/{taskId}/history` (authenticated, order-bound, customer-safe, and read-only)
- `POST /api/public/proof/order/refresh` (authenticated, queued, read-only)
- `POST /api/public/proof/participants` (authenticated and CSRF-protected; optional during view-only QA)
- `POST /api/public/proof/tasks/{taskId}/feedback-acknowledgements` (authenticated, participant-bound, CSRF-protected, and Proof-local only)
- `DELETE /api/public/proof/sessions/current`
- `GET /api/public/proof/health`

Default-off runtime configuration:

```text
PATHFINDER_PROOF_ENABLE_PUBLIC_READ=false
PATHFINDER_PROOF_ENABLE_LINK_EMAIL=false
PATHFINDER_PROOF_REPLY_TO=support@vornan.com
PATHFINDER_PROOF_ENVIRONMENT_NAME=qa
PATHFINDER_PROOF_LIFT_READ_ENVIRONMENT=qa
PATHFINDER_PROOF_LIFT_ORDER_READ_URL=<reviewed stage AS360Orders/N URL>
PATHFINDER_PROOF_LIFT_REPORT_READ_URL=<reviewed stage AS360ProofReport/N URL>
PATHFINDER_PROOF_ACKNOWLEDGE_PRODUCTION_READS=false
PATHFINDER_PROOF_SESSION_TTL_MINUTES=30
PATHFINDER_PROOF_GRANT_TTL_DAYS=14
PATHFINDER_PROOF_STALE_AFTER_MINUTES=15
PATHFINDER_PROOF_AUTO_REFRESH_MAX_INACTIVE_DAYS=14
PATHFINDER_PROOF_SYNC_QUEUE_URL=<stack output>
PATHFINDER_PROOF_EDGE_SHARED_SECRET=<dedicated CloudFront-to-API secret>
PATHFINDER_PROOF_MANAGED_WEB_ACL_ENABLED=true
PATHFINDER_PROOF_READ_ONLY_QA_CONFIRMED=false
PATHFINDER_PROOF_PRODUCTION_PUBLIC_READ_APPROVED=false
PATHFINDER_PROOF_ALARM_TOPIC_ARN=<optional operational SNS topic>
PATHFINDER_PROOF_LOG_RETENTION_DAYS=30
```

Phase 2 is implemented and its isolated `vornan-proof-dev` foundation is deployed dark, but no customer capability is enabled. Dark-boundary, purgeable synthetic-lifecycle, direct-Lift read-only, Pathfinder-originated read-only, and temporary deployed customer-boundary evidence are recorded in the dated Proof QA documents. `npm run check:proof-phase2` evaluates their bounded readiness state without mutating infrastructure or authorizing a feature-flag change. The deployed grant/session lifecycle and one-order responsive customer boundary have passed with the purgeable reserved fixture; activation remains blocked until separate explicit read-only customer-activation approval is recorded and reviewed. `scripts/deploy-proof-stack.sh` defaults to the `dev` environment and keeps public read off; `scripts/deploy-proof-web.sh` publishes only the static SPA. Follow `docs/VORNAN_PROOF_READ_ONLY_QA_RUNBOOK.md`. Deployment must keep public read and grant creation off until a new, explicit authorization changes that posture. This gate does not change the Lift write prohibition.

The controlled customer-boundary validation in `scripts/proof-customer-boundary-qa.ts` passed under the explicit temporary approval recorded in `docs/VORNAN_PROOF_CUSTOMER_BOUNDARY_QA_EVIDENCE_2026-07-21.md`. The runner accepted only the alias-free `vornan-proof-dev` public-read QA posture, the reserved synthetic fixture, and an exact confirmation string. It exercised no email, decision, production-public-read approval, or Lift transport and revoked its temporary view grant. The stack was restored dark and the fixture purged immediately after responsive validation. Its preflight and the readiness evaluator continue to report deployment and mutation authorization as false; the temporary QA approval is not customer activation approval.

The `proof.vornan.co` CNAME is also gated. It may be added only after the production stack emits `ProofDnsRecordValue` and `npm run check:proof-dns` reports `ready_to_add_cname: true` following a dark distribution smoke. The initial Cloudflare record must remain DNS-only. DNS creation does not enable customer reads, grant creation, or Lift writes.

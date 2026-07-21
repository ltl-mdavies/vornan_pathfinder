# Vornan Proof read-only QA deployment runbook

Authoritative architecture: `docs/VORNAN_PROOF_PATHFINDER_ARCHITECTURE_HANDOFF_2026-07-19.docx`.

Scope: deploy and confirm the isolated Phase 2 customer-read lifecycle. This runbook does not authorize or test Lift approval, revision, undo, proof JWT signing, or any Lift `PUT` request.

## Non-negotiable gates

- Deploy only to `dev`, `qa`, or `prod`; the declared Lift read environment must match the stack environment.
- Supply both reviewed HTTPS Lift read endpoints explicitly. A non-production deployment using the recorded production Lift hosts fails unless the reviewer records `PATHFINDER_PROOF_ACKNOWLEDGE_PRODUCTION_READS=true`.
- Every deployed public API must have a dedicated edge secret of at least 32 characters. Direct API Gateway access must return HTTP 403.
- Keep `PATHFINDER_PROOF_ENABLE_PUBLIC_READ=false`, the IAM operator window off, and `PATHFINDER_PROOF_ENABLE_LINK_EMAIL=false` for the first deployment.
- Keep transactional delivery in `log` mode until the complete read-only lifecycle passes. Proof log-mode output may contain only category, masked recipient, recipient count, and subject; it must never contain the raw access URL or token.
- Public read requires a managed or supplied WAF and `PATHFINDER_PROOF_READ_ONLY_QA_CONFIRMED=true`. Production additionally requires `PATHFINDER_PROOF_PRODUCTION_PUBLIC_READ_APPROVED=true`.
- Any requested approval, revision, undo, or generic Lift-write flag fails deployment preflight. Runtime decision flags remain literal `false` independently of deployment configuration.
- Keep concurrent local API processes on distinct `PATHFINDER_PROOF_LOCAL_STORE_PATH` values. The local driver serializes mutations only within one process; malformed or unreadable existing stores must fail closed and remain byte-for-byte intact.
- Do not paste fragment tokens, cookies, signed URLs, customer creative, comments, or raw Lift payloads into tickets, chat, screenshots, shell history, or logs.

## Required protected-environment configuration

```text
PATHFINDER_PROOF_ENVIRONMENT_NAME=qa
PATHFINDER_PROOF_LIFT_READ_ENVIRONMENT=qa
PATHFINDER_PROOF_LIFT_ORDER_READ_URL=<reviewed AS360Orders/N HTTPS endpoint>
PATHFINDER_PROOF_LIFT_REPORT_READ_URL=<reviewed AS360ProofReport/N HTTPS endpoint>
PATHFINDER_PROOF_ACKNOWLEDGE_PRODUCTION_READS=false
PATHFINDER_PROOF_EDGE_SHARED_SECRET=<32+ character secret>
PATHFINDER_PROOF_ENABLE_PUBLIC_READ=false
PATHFINDER_PROOF_OPERATOR_GRANT_CREATION_ENABLED=false
PATHFINDER_PROOF_GRANT_ALLOWED_CUSTOMER_IDS=
PATHFINDER_PROOF_READ_ONLY_ACTIVATION_EXPIRES_AT=
PATHFINDER_PROOF_ENABLE_LINK_EMAIL=false
PATHFINDER_STATUS_EMAIL_MODE=log
PATHFINDER_PROOF_REPLY_TO=support@vornan.com
PATHFINDER_PROOF_READ_ONLY_QA_CONFIRMED=false
PATHFINDER_PROOF_PRODUCTION_PUBLIC_READ_APPROVED=false
PATHFINDER_PROOF_MANAGED_WEB_ACL_ENABLED=true
PATHFINDER_PROOF_ALARM_TOPIC_ARN=<reviewed operational SNS topic, optional before pilot>
PATHFINDER_PROOF_LOG_RETENTION_DAYS=30
PATHFINDER_PROOF_AUTO_REFRESH_MAX_INACTIVE_DAYS=14
PATHFINDER_PROOF_AUDIT_TABLE=Pathfinder-ProofAudit-qa
PATHFINDER_PROOF_DOMAIN_NAME=<approved stage alias; proof.vornan.co for prod>
PATHFINDER_PROOF_CERTIFICATE_ARN=<issued us-east-1 ACM certificate covering the alias>
```

Run `npm run verify:proof-deploy` before packaging or uploading artifacts. The protected GitHub workflow executes the same preflight automatically.

## Controlled synthetic lifecycle before Lift reads

Before requesting approval for any real Lift order, validate the cache, grant/session, audit, queue, telemetry, alarm, log, and fail-closed UI lifecycle with the reserved non-customer fixture.

- Use only stack `vornan-proof-dev`, reserved order `A00000000`, marker `SYNTHETIC QA — NOT A CUSTOMER`, and a unique bounded `vpqa-*` fixture ID.
- Enable `SyntheticQaEnabled=true` only for the lifecycle window. CloudFormation and deployment preflight reject this flag unless environment is `dev`, public read/read-only QA/production approval are false, and domain/certificate inputs are empty.
- Keep the fixture flag out of the public Lambda. The lifecycle harness enables grant/public handlers only inside an in-process test app connected to the isolated dev tables; it must not open a listener or change deployed public-read parameters.
- Use the harness's controlled success and failure messages. The failure must occur before the Lift adapter and traverse the deployed retry/DLQ policy.
- Never use `PurgeQueue`. Purge with the exact fixture ID; the cleanup selector must refuse any table record or queue message it cannot prove belongs to the reserved fixture.

```text
PATHFINDER_PROOF_QA_CONFIRM=VORNAN_PROOF_SYNTHETIC_QA \
PATHFINDER_PROOF_QA_FIXTURE_ID=vpqa-<unique-id> \
PATHFINDER_PROOF_STACK_NAME=vornan-proof-dev \
npm run qa:proof-synthetic

PATHFINDER_PROOF_QA_CONFIRM=VORNAN_PROOF_SYNTHETIC_QA \
PATHFINDER_PROOF_QA_FIXTURE_ID=vpqa-<same-id> \
PATHFINDER_PROOF_STACK_NAME=vornan-proof-dev \
npm run purge:proof-synthetic
```

After evidence capture, verify zero fixture records and queue messages, restore the queue's original visibility timeout, redeploy with `SyntheticQaEnabled=false`, and wait for intentionally triggered alarms to return to `OK`. A passing synthetic lifecycle does not authorize a Lift read; stop and obtain explicit approval for one exact QA order.

## DNS cutover gate

Do not create the Proof DNS record before the first dark deployment completes. `ProofDomainName` and `CertificateArn` must be supplied together; production accepts only `proof.vornan.co`, and CloudFront certificates must be issued by ACM in `us-east-1`.

After the stack deploys with `PublicReadEnabled=false`, publish the SPA and run the isolated smoke against `ProofWebDistributionDomainName`, not the not-yet-created alias. Then run:

```text
PATHFINDER_PROOF_ENVIRONMENT_NAME=prod \
PATHFINDER_PROOF_DARK_SMOKE_CONFIRMED=true \
npm run check:proof-dns
```

Add the record only when the command reports `ready_to_add_cname: true`. It verifies that CloudFormation completed, the CloudFront distribution is deployed, the configured alias matches, the ACM certificate is issued and covers the alias, public read remains off, and the dark smoke was explicitly confirmed. The protected deployment workflow publishes the same result and exact values in its job summary.

The initial Cloudflare record will be:

```text
Type:   CNAME
Host:   proof
Name:   proof.vornan.co
Target: <ProofDnsRecordValue from vornan-proof-prod>
Proxy:  DNS only
TTL:    Auto
```

The target is an AWS-generated `*.cloudfront.net` hostname and does not exist until the Proof stack is deployed with the alias and issued certificate. After DNS propagation, repeat `npm run smoke:proof-read-only` against `https://proof.vornan.co` while public read remains off. This DNS gate does not authorize customer grant creation, public reads, or any Lift write.

## Controlled customer-boundary QA window

The deployed one-order/session boundary uses the purgeable synthetic fixture, not a customer order. Follow `docs/VORNAN_PROOF_CUSTOMER_BOUNDARY_QA_PLAN_2026-07-21.md` and obtain a new explicit approval before changing either `ReadOnlyQaConfirmed` or `PublicReadEnabled`.

The prepared harness is restricted to `vornan-proof-dev`, the reserved synthetic order, an exact retained `vpqa-*` identity, an alias-free WAF-protected distribution, and the explicit confirmation string below. It refuses a dark or production-approved stack, creates only a view grant, never emits its raw token/cookies, checks direct API bypass denial, and revokes the grant in a `finally` path.

```text
PATHFINDER_PROOF_BOUNDARY_QA_CONFIRM=VORNAN_PROOF_CUSTOMER_BOUNDARY_QA \
PATHFINDER_PROOF_QA_FIXTURE_ID=vpqa-<approved-id> \
PATHFINDER_PROOF_STACK_NAME=vornan-proof-dev \
npm run qa:proof-boundary
```

Do not run this command against the current dark stack and do not treat the command itself as deployment authorization. After the approved window, restore `PublicReadEnabled=false` and `ReadOnlyQaConfirmed=false` before using the exact-fixture purge. The API harness is necessary but not sufficient for the responsive acceptance gate; complete the authenticated desktop/mobile UI review through a separately approved private token handoff before marking the deployed customer boundary passed.

## Deployment sequence

1. Record the target account, region, stack, Git commit, Lift read environment, endpoint hosts, reviewer, and maintenance window. Record no URL query strings.
2. Run the repository checks, workspace tests, `npm run test:proof-deploy`, Proof Lambda packaging, and SPA build. The protected GitHub workflow must complete the same deployment-safety suite before it configures AWS credentials or uploads an artifact.
3. Deploy the dedicated Proof stack with public read off, the IAM operator window off, managed WAF on, and the edge secret configured. Record the retained table, operator function, distribution, API, queue, and dashboard outputs. Do not deploy the Pathfinder production API for this isolated activation.
4. Publish the SPA and invalidate CloudFront.
5. Run `npm run smoke:proof-read-only` with the distribution hostname and the direct API Gateway stack output. This checks security headers, safe health flags, generic invalid-token behavior, unauthenticated denial, absent decision routes, and edge-bypass rejection.
6. Confirm the CloudWatch dashboard exists, each alarm is in `OK` or `INSUFFICIENT_DATA`, the DLQ is empty, the audit table has PITR and no TTL, and logs contain no bearer token, cookie, raw URL query, signed URL, or creative/customer payload. Exercise session exchange, cached order read, task history, participant identity, feedback acknowledgement, manual refresh, logout, and health; confirm each appears under its fixed operation name and that no task, participant, grant, order, email, filename, or token value becomes a metric dimension.
7. Open the authenticated Pathfinder operator panel and confirm its Integration health card says `Dark read-only boundary ready` only when dedicated DynamoDB core/audit tables, the isolated sync queue, and the CloudFront-to-API edge secret are configured while public read is off. Confirm local storage is labeled `Local read-only QA` and missing deployed controls remain listed as requirements. Inspect the health response and verify it contains only configuration booleans, bounded policy values, and hostnames—never the edge secret, queue URL, Lift path/query, credential, customer identifier, or file. Then synchronize one approved QA order. Confirm Lift traffic consists only of `GET` requests and the cached order preserves sibling attachments and completed/reference state. Compare the shared Order Rollup line and Proof tasks using the real Lift `ORDER_LINE_ID`: every attachment must appear under exactly one line, a valid ID must win when `LINE_NUMBER` conflicts, and `LINE_NUMBER` fallback must be recorded only when no matching ID exists.
   With that normalized Proof aggregate present, create or refresh an internal order snapshot and confirm no second Lift proof-report request occurs. Confirm the rollup receives only bounded proof file/status/URL/date fields plus pending, regenerating, waiting, reviewed, and total counts; it must receive no Proof task or attachment identity, grant, session, participant, feedback, audit, or decision scope. Capture a public Status snapshot and confirm it remains immutable and view-only, shows the normalized review progress, and tells the customer to use the dedicated Vornan Proof email. Confirm the Status token cannot call any Proof route. Remove the normalized aggregate or force a safe cache-read failure and confirm the raw Lift report fallback is sanitized before entering Status, unsafe URLs and embedded credentials are removed, and the fallback adds no decision capability.
   Inspect the successful Proof sync response and cached order. Confirm diagnostics contain only the completion time, line-read success/failure/row counts, fallback status/row count, and normalization-warning count; they must contain no Lift URL, query, line identity, raw error, credential, or customer file. Synchronize the unchanged packet again and confirm `proof.review_ready` is not duplicated. Move the read fixture from pending to fully reviewed and back to pending, then confirm exactly one restricted `proof.all_reviewed` and one `proof.review_reopened` event with bounded counts. Confirm these events are audit/readiness records only and do not call Status, email, a decision route, or Lift write transport.
8. Keep `OperatorGrantCreationEnabled=false` until the exact dev change set is reviewed. For the approved boundary window, configure `GrantAllowedCustomerIds=1249`, the bounded activation expiry, the direct CloudFront HTTPS base URL, public read/read-only QA true, managed/shared WAF intact, synthetic QA false, no domain/certificate, link email false, and production approval false. Invoke the IAM-only operator with `sync_order` first; an allowed header may continue to line-scoped proof GETs, while a missing or different customer ID must stop before proof-report reads and persistence. Invoke `create_view_grant` only for an approved LTL Demo order and confirm it repeats the cohort-bound GET synchronization before issuing the grant. Force a safe read failure and confirm no grant or raw link is produced. The operator Lambda has no API Gateway integration or public invoke permission and creates only `view` scope.

   Prepare request and response files outside the repository with owner-only permissions. The response contains the one-time fragment link and is secret-bearing operational material:

   ```text
   aws lambda invoke \
     --function-name vornan-proof-operator-dev \
     --cli-binary-format raw-in-base64-out \
     --payload fileb:///secure/path/proof-operator-request.json \
     /secure/path/proof-operator-response.json
   ```

   Do not place the JSON payload inline in shell history. Privately hand off the link, then securely remove the response. Evidence may retain only the order number, operation, correlation ID, safe aggregate counts, grant ID/status, and pass/fail result—never the access URL or token. Use `list_grants` for a bounded inventory and `revoke_grant` for cleanup. Emergency revocation remains available after the creation flag is restored to false, but only for a stored order still in the configured cohort.
9. With public read still off, confirm token exchange returns the unavailable response without revealing order existence.
10. After review, record the isolated read-only lifecycle as confirmed and deploy the same isolated stack with the bounded public-read and IAM-operator window. Repeat the automated smoke gate. Do not change Pathfinder production surfaces.
11. Exchange the QA grant once, confirm the raw fragment disappears, the session is `HttpOnly`, `Secure`, `SameSite=Lax`, and the customer can see exactly one order on desktop and mobile. Confirm a distinct `Secure`, `SameSite=Lax` CSRF cookie is readable by the SPA, is not returned in JSON or persisted raw, and that participant, feedback-acknowledgement, refresh, and logout requests fail without an exact CSRF header/cookie match. Viewing must remain available before reviewer identification. Save and update one reviewer name/email, confirm only that session receives its own identity, and verify the authenticated operator view reports the reviewer count/details while audit records contain identifiers only. Confirm the public response and header expose only aggregate identified-reviewer count/activity time with `reviewer_names_visible=false`; inject another participant record and verify its name, email, participant ID, and grant details remain absent. Open current feedback and confirm it cannot be acknowledged before identity; acknowledge it after identification and verify the public DTO returns only `feedback_required=true` and `feedback_acknowledged=true`. Confirm feedback attachments render as keyboard-accessible file actions with filename/type labels. Exercise array, nested `attachments`, JSON-encoded, URL-only, and filename-only `COMMENT_ATTACHMENT` shapes; confirm duplicates collapse, valid HTTPS links remain usable, metadata-only files remain labeled, and internal IDs/notes, embedded URL credentials, unsafe schemes, malformed blobs, and arbitrary object fields do not enter the public DTO. Change the current feedback fixture, including its attachment set, confirm acknowledgement resets to false, acknowledge again, and verify audit contains task/grant/participant identifiers but no comment text, attachment metadata/URL, or feedback fingerprint. Confirm the UI states clearly that acknowledgement is a review record—not approval or revision—and no Lift request is emitted. Open file history and confirm the SPA requests `GET /api/public/proof/tasks/{taskId}/history`, returns only versions from the session order, never returns Lift attachment IDs, approver identity, raw detailed reports, feedback fingerprints, raw rows, or internal warnings, and returns the same generic not-available response for an unknown or cross-order task. Confirm the selected version displays approval status/date and only bounded technical check names/statuses; inject report IDs, details, signed URLs, URL-shaped names, token-shaped statuses, and duplicate checks and confirm they are absent or collapsed in the public response. Interrupt the history request and confirm cached versions remain visible with a retry action; expire the session and confirm the history request transitions to the terminal session state. Exercise Lift approval statuses `REVISION`, `REVISED`, `REJECTED`, `REGENERATING`, and `CHANGES REQUESTED`; confirm each becomes a non-actionable `revised` task, is labeled `Regenerating`, remains in the open queue, and explains that its last synchronized file is reference-only. Confirm waiting, reference, cancelled, missing, and file-error tasks use distinct text/icon status and never become actionable. Age an active cached packet beyond the configured freshness window and confirm only the public projection becomes `stale`, the refresh remains queued/bounded, and cached proofs stay visible under a customer-safe notice; repeat with missing/error aggregate fixtures and confirm cached files are not erased. At 1366×768 confirm the shell fills the viewport, order counters include waiting/regenerating tasks as open, the queue scrolls independently, the selected artwork is fully contained without crop or warp, and the locked decision transport remains visible. Search by product, line, filename, customer-facing state label, and normalized state; confirm a search that hides the selected task also clears its detail and that the clear action restores the queue. At 390×844 and 320×568 confirm the stacked proof-review feed has no horizontal document overflow and search/filter/file/decision actions remain at least 44 px. At 844×390 confirm the mobile feed is used instead of a squeezed desktop split. Open feedback and file history with the keyboard at each responsive layout; confirm each native modal has its accessible name/description, initial focus lands on Close, Tab cannot leave the modal, and Close or Escape returns focus to the exact opener. Open reviewer identity from the header and confirm initial focus lands on Name and returns to the header control. Then open reviewer identity from feedback and confirm only one dialog is open throughout, background focus is never exposed, and closing identity returns directly to the original Feedback control. Verify queue selection with Arrow keys plus Home/End, confirm filter changes never leave a hidden task in detail, exercise the distinct no-proof/no-open/filter-empty/search-empty states, and confirm reduced-motion plus PDF/non-previewable-file fallbacks. Use the `#/proof/assets-qa` fixture and representative Lift rows to confirm `PROOF_LINK_LOW` is used only as the contained preview, `PROOF_LINK_HIGH` is the full-resolution target, and filename/MIME metadata produces exactly one server-owned `image`, `pdf`, `download`, or `unavailable` kind. Inject HTTP, `javascript:`, credential-bearing HTTPS, protocol-relative, malformed, SVG, and HTML references and confirm none becomes an embedded preview or customer action. Confirm PNG/JPEG/GIF/WebP stay contained; exercise PDF paging/zoom plus keyboard-reachable Open/Download fallback; verify long filenames do not create horizontal overflow; and confirm TIFF/PSD/AI/EPS/INDD use a metadata/download card or an explicit conversion-unavailable state. Confirm all decision controls remain disabled and no approval, revision, undo, upload, or generic Proof write request is emitted.
12. Use the `#/proof/all-reviewed-qa` and `#/proof/complete-qa` fixtures plus representative Lift-complete rows to confirm an active all-approved packet says `All proofs reviewed`, a complete/reference packet says `Proof packet complete`, Open contains no task cards, and `View reviewed proofs` moves directly to the approved/reference files on desktop and mobile. Confirm pending, waiting, regenerating, missing, file-error, stale, missing-order, and error-order fixtures cannot show a false success state. Confirm completion remains presentation-only: no domain event, approval, revision, undo, upload, or generic Proof write request is emitted.
13. Use representative joined Lift lines with integer, fractional, zero, null, negative, non-finite, and oversized quantities. Confirm only finite values from 0 through 1,000,000,000 enter the public task DTO; null or rejected values create no empty quantity label. At desktop, narrow portrait, and short landscape sizes, confirm `Qty` stays visible without overflowing the queue/detail/feed and no assigned-location, allocation, or mismatch comparison appears.
14. Use `#/proof/lifecycle-qa` to confirm the public response and command bar separately show Pending 1, Regenerating 1, Waiting 1, and Reviewed 1/5. Approved/reference tasks must share Reviewed without relabeling a reference as approved, while file-error and other unavailable tasks remain only in Total. At 1366×768, 390×844, 320×568, and 844×390 confirm the four counter cells stay legible without horizontal overflow or displacing the contained proof and disabled decision transport.
15. Inject control characters, repeated whitespace, invalid dates, and values beyond the public limits into order title/status, line number, product name, approval status, and feedback text. Confirm the public DTO returns only normalized bounded values or `null`, exposes no more than 100 feedback entries per version, and never causes the SPA to display an invalid raw timestamp. Use `#/proof/display-fallback-qa` at desktop, narrow portrait, and short landscape sizes; confirm the heading is exactly `Order A0221132`, the status is `Proof review`, generic missing product text is stable, and no fake customer/order title appears.
16. After the link lifecycle and sanitized log evidence pass, a reviewed QA test may switch transactional delivery to `ses` and enable the independent link-email flag for one approved recipient. Confirm the message uses the Vornan sender, `support@vornan.com` Reply-To, text and HTML bodies, no application-enabled click/open tracking, and that the operator screen removes the raw link only after SES reports success. Never retain the message URL in evidence.
17. Confirm reuse of the one-time grant routes to the generic `#/link-unavailable` state. Confirm revocation, explicit logout, and expiry route to `#/session-ended`, remove the order from view, and disclose no order or token detail. Then confirm a stale active packet whose proof state changed within 14 days enqueues one deduplicated refresh without blocking the page. Confirm a complete/reference packet, degraded packet, packet unchanged for 14 days, and packet with an invalid `updated_at` remain cached and browsable without automatic queue activity; an old active packet may still project `stale` without polling. Use the customer refresh control on the inactive packet and confirm it returns an authenticated queued state, leaves cached proofs usable, produces only SQS/worker Lift `GET` activity, and is covered by the manual-refresh WAF rate metric. Confirm deployment rejects an automatic-refresh window outside 1–365 whole days. Confirm the restricted operator audit shows the sync, grant, link-delivery, exchange, and revocation lifecycle using identifiers and correlation IDs only.
18. Run `npm run test:proof-deploy` and confirm the Adspace-artifact rejection tests pass. Review the scanned customer boundary and confirm it contains no Adspace name, logo/domain reference, integration identity, physical resource name, runtime import, sample identifier, or excluded project/venue/inventory/room/allocation/location-assignment/transit/campaign/tenant concept. Treat any required exception as an architecture review; do not weaken or bypass the gate for a deployment.
19. Revoke active grants, then return public read, the IAM operator window, read-only QA confirmation, and link email to off unless a separate read-only pilot approval explicitly leaves them enabled. Retain the cohort only as needed for verified emergency revocation, then clear it in the final dark deployment.

## Evidence record

Before requesting any activation review, update the bounded machine-readable evidence state and run:

```text
npm run check:proof-phase2
```

The default state file is `docs/VORNAN_PROOF_PHASE_2_READINESS_STATE_2026-07-21.json`; a reviewed alternate may be supplied with `PATHFINDER_PROOF_PHASE2_READINESS_FILE`. The evaluator is read-only and emits only fixed gate names, booleans, counts, and bounded status/next-action values. It ignores extra fields so identifiers, payloads, URLs, recipients, and free-form notes cannot enter the readiness output.

After the 2026-07-21 internal LTL Demo cohort approval, the bounded state may report `ready_for_explicit_activation_review`. This remains a review state, not deployment authorization: the evaluator always returns `public_read_change_authorized=false` and `mutation_authorized=false`.

After the deployed boundary prerequisites pass, prepare the separate read-only activation packet and run:

```text
npm run check:proof-activation-review
```

The default bounded input is `docs/VORNAN_PROOF_READ_ONLY_ACTIVATION_REVIEW_STATE_2026-07-21.json`; a reviewed alternate may be supplied with `PATHFINDER_PROOF_ACTIVATION_REVIEW_FILE`. The checker requires exact dev/cohort/time scope, private link handoff, named monitoring and rollback ownership, support response/escalation, and the immutable no-production-approval/no-DNS/no-email/no-decision/no-Lift-write boundary. Its output never authorizes a flag change or deployment. The approved internal cohort is enforced at grant creation with the Lift customer ID, and the activation deadline caps grants and sessions and fails closed after expiry. Follow `docs/VORNAN_PROOF_READ_ONLY_ACTIVATION_REVIEW_PACKET_2026-07-21.md`.

Record only identifiers safe for operational evidence:

- Date/time, environment, AWS account, region, stack ID, commit SHA, CloudFormation change-set ID, distribution ID, API ID, and dashboard name.
- Lift endpoint classification and hostnames without paths or query strings.
- Redacted order number if policy requires it; otherwise use the internal QA case ID.
- Automated smoke result, viewport/accessibility result, grant/session/revocation pass or fail, queue/DLQ result, and reviewer names.
- Correlation IDs from sanitized telemetry. Never record the underlying token, cookie, signed URL, or customer payload.

`PATHFINDER_PROOF_READ_ONLY_QA_CONFIRMED` may become `true` only when every Phase 2 check above passes. This confirmation does not satisfy the isolated Lift write lifecycle gate for Phase 3.

## Alarm response

- **Public server errors:** set public read to false, preserve logs, inspect sanitized correlation IDs and the latest change set, and roll back the application artifact if necessary.
- **Public denial spike:** inspect WAF sampled-request metadata without enabling sensitive request logging; tune only after distinguishing expected shared-reviewer traffic from abuse.
- **Cached-read or token-exchange latency:** keep serving cached data, inspect Lambda concurrency and DynamoDB latency, and do not bypass same-origin or WAF controls.
- **Sync failure or lag:** leave cached data intact, verify the declared Lift read endpoint and schema health, and allow bounded SQS retries.
- **Any DLQ message:** treat it as actionable. Preserve the message/correlation evidence, diagnose the read-only failure, and redrive only after the cause is fixed. Never transform the sync queue into a decision retry path.

## Rollback

1. Redeploy with `PublicReadEnabled=false`; do not delete the retained Proof table, logs, queue, or bucket.
2. Revoke affected grants through the authenticated operator boundary when available.
3. Roll back the Lambda and SPA artifacts through a reviewed CloudFormation change set and S3 version history.
4. Verify the direct API remains edge-restricted, the public health response reports `decisions_enabled=false`, the DLQ is retained, and cached proof/history data remains intact.
5. Record the incident and required corrective action before attempting the lifecycle again.

Phase 3 remains blocked until the separate Lift QA endpoint lifecycle and dedicated credential boundary are confirmed and a real attachment-targeted QA approval contract can be tested safely.

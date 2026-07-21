# Vornan Proof synthetic lifecycle QA evidence — 2026-07-21

## Decision

The isolated, non-customer Proof lifecycle passed in the dark `vornan-proof-dev` stack. The fixture was purged and its runtime capability was disabled after the run. This result confirms the synthetic lifecycle only; it does not authorize production Lift reads, public Proof reads, DNS, grant/link email, proof decisions, or any Lift write.

`ReadOnlyQaConfirmed` remains `false`. Real-data validation is deferred until an operator explicitly approves one exact Lift QA order.

## Boundary and fixture identity

- Source baseline: `origin/main` commit `77a000b0c1c23a3af7cf35d1a805749b8d4f44b0`.
- Branch: `codex/proof-synthetic-lifecycle-qa`.
- AWS environment: account `744016783602`, region `us-east-1`, stack `vornan-proof-dev`.
- Stack ID: `arn:aws:cloudformation:us-east-1:744016783602:stack/vornan-proof-dev/9688ddc0-849d-11f1-a144-0ebd9adba6b5`.
- CloudFront distribution: `E381PLTIBZ9880` at `dpib8f02ljvrd.cloudfront.net`; no custom alias was configured.
- API ID: `e9rs8r7npa`; direct access remained edge-restricted.
- Dashboard: `vornan-proof-dev`.
- Passing fixture ID: `vpqa-20260721-lifecycle-02`.
- Reserved fixture order: `A00000000`.
- Required marker: `SYNTHETIC QA — NOT A CUSTOMER`.
- Fixture source: a single order line and a single Proof task generated in-process by the sync worker. It uses no Lift endpoint, customer payload, customer creative, email recipient, or decision transport.
- Passing lifecycle artifact: `proof/dev/vornan-proof-lambdas-synthetic-qa-telemetry-fix-20260721T131935Z.zip`, SHA-256 `2d13e4d138a4c6c52f9139e970766e3a0863b2aeeca8eee1ce5c3d1a779cf436`.
- Final dark artifact after cleanup: `proof/dev/vornan-proof-lambdas-synthetic-qa-final-20260721T133605Z.zip`, SHA-256 `a847ede4946e3bddda6d2faf0db0731c5761fd7e6db6dc180ca43f63dc58d92e`.

The stack accepted `SyntheticQaEnabled=true` only while all of the following were simultaneously true: environment `dev`; public read false; read-only QA confirmation false; production public-read approval false; no Proof domain; and no certificate. The synthetic flag was supplied only to the sync worker. The public Lambda never received it.

## Lifecycle result

### Cached aggregate and queue processing

- A real FIFO sync-queue message created one cached order aggregate with one line and one task.
- The task and line shared the same fixture-owned order-line ID.
- `proof.sync_completed` and `proof.review_ready` were recorded exactly once.
- A separate controlled-failure message failed before any Lift adapter call, retried five times through the deployed event-source mapping, and reached the real DLQ.
- The worker logged six bounded `sync_order` metric records: one successful attempt and five controlled failures.
- The sync log window contained 30 events, five `ProofSyntheticQaFailure` records, no fixture ID, and no access token, access URL, session token, customer email, or recipient email fields.

### Grant and session lifecycle

Grant/public-read switches were enabled only inside an in-process `supertest` app connected to the isolated dev DynamoDB tables. No listener, CloudFront route, or public stack parameter was enabled.

- A view grant was created for the cached fixture.
- The raw grant exchanged successfully once; a second exchange returned the generic unauthorized response.
- The session cookie was `HttpOnly`, `Secure`, and `SameSite=Lax`.
- The distinct CSRF cookie was `Secure` and `SameSite=Lax`, and mutation requests required the matching header.
- Cached order read returned one pending task with decisions disabled.
- Participant identification, task history, feedback acknowledgement, logout, post-logout denial, and grant revocation all passed.
- The public order DTO did not contain the synthetic marker.
- No email path was invoked and no raw grant URL, token, or cookie was retained in this evidence.

### Audit-event coverage

Before purge, the fixture had 13 audit events:

| Action | Count |
| --- | ---: |
| `proof.sync_completed` | 1 |
| `proof.review_ready` | 1 |
| `proof.grant_created` | 1 |
| `proof.session_exchanged` | 1 |
| `proof.participant_identified` | 1 |
| `proof.feedback_acknowledged` | 1 |
| `proof.session_ended` | 1 |
| `proof.grant_revoked` | 1 |
| `proof.sync_failed` | 5 |

### Telemetry, alarms, and logs

- Local lifecycle telemetry used only the fixed `Environment`, `Operation`, and `Service` dimensions.
- The lifecycle emitted the expected fixed operations: `token_exchange`, `cached_order_read`, `task_history`, `participant_identity`, `feedback_acknowledgement`, and `session_logout`.
- The deployed sync worker emitted `sync_order` metrics with only the same bounded dimensions.
- A dark deployed health request mapped to `health_read`; an unauthenticated cached-order request mapped to `cached_order_read`. Both returned HTTP 403 because public read remained off.
- `vornan-proof-dev-sync-failures` entered `ALARM` on the controlled failures.
- `vornan-proof-dev-sync-dlq` entered `ALARM` after the controlled message became visible.
- The existing alarm definitions were unchanged. Queue/failure alarms retained their 60-second/300-second periods and threshold of one.
- Raw log messages were not copied into evidence. Summary scans found no access token, session token, customer email, recipient email, raw access URL, fixture ID, or customer payload.

The lifecycle harness exposed a telemetry defect on the first attempt (`vpqa-20260721-lifecycle-01`): Express mount-path rewriting caused the response-finish callback to classify a known route as `unknown_public_route`. That attempt made no Lift request and was immediately purged (7 core records, 13 audit records, one DLQ message, zero residual records/messages). The middleware now captures the route operation before `next()`, a mounted-router regression test covers the behavior, and the deployed second run confirmed `cached_order_read`.

The post-cleanup smoke exposed a second telemetry edge case: the expected HTTP 503 returned while the public lifecycle is disabled was counted as a server error and could falsely alarm a dark stack. The final artifact marks only `ProofAccessFeatureDisabledError` as an expected denial; a genuine 503 such as queue unavailability remains a server error. Regression coverage passed, and the deployed final smoke emitted one `token_exchange` denial, zero server-error records, and no sensitive payload terms.

### Responsive fail-closed UI

The deployed CloudFront SPA was checked at `1366×768`, `390×844`, `320×568`, and `844×390`.

- The document exactly filled each viewport with no horizontal overflow.
- The session-ended heading and safe recovery copy remained visible.
- An invalid fragment access token failed closed to the same session-ended state.
- `#/proof/lifecycle-qa` failed closed in the production build.
- Neither `A00000000` nor the synthetic marker was rendered.
- No Proof order, line, file, history, feedback, grant, or decision surface was exposed.

## Cleanup and post-run state

Cleanup used the exact fixture ID and reserved order selector; it did not purge either queue broadly. The command refuses any table row or queue message that does not prove ownership by `A00000000` and the requested `vpqa-*` identity.

```text
PATHFINDER_PROOF_QA_CONFIRM=VORNAN_PROOF_SYNTHETIC_QA \
PATHFINDER_PROOF_QA_FIXTURE_ID=vpqa-20260721-lifecycle-02 \
PATHFINDER_PROOF_STACK_NAME=vornan-proof-dev \
npm run purge:proof-synthetic
```

Cleanup result:

- Core records deleted: 7; residual: 0.
- Audit records deleted: 13; residual: 0.
- DLQ messages deleted: 1; residual: 0.
- Main queue residual visible/in-flight/delayed messages: 0/0/0.
- Main queue visibility timeout restored to 90 seconds.
- DLQ residual visible/in-flight/delayed messages: 0/0/0.
- `SyntheticQaEnabled=false` after cleanup.
- `PublicReadEnabled=false`, `ReadOnlyQaConfirmed=false`, and `ProductionPublicReadApproved=false`.
- Domain and certificate parameters remain empty; no DNS record was created.
- After the intentional metric windows expired, all nine `vornan-proof-dev` alarms returned to `OK` without manual alarm-state changes or message redrive.

## Guardrail evidence

- No production Lift `GET`, order synchronization, proof-report retrieval, or refresh was attempted.
- No Lift `PUT`, approval, revision, undo, upload, submit, or other write was attempted.
- No Pathfinder production API, web, status, store, infrastructure, or deployment was changed.
- No public read, public token exchange, grant creation endpoint, link email, DNS, custom domain, or proof decision capability was enabled in the deployed stack.
- Normal GitHub Proof deployments explicitly set `SyntheticQaEnabled=false`.
- Deployment preflight and CloudFormation rules reject synthetic mode outside a fully dark, alias-free dev stack.
- Synthetic messages require a strict two-field envelope, a bounded `vpqa-*` identity, the reserved order number, and an explicit success/failure outcome. A reserved-order collision fails closed.

## Validation evidence

The frozen implementation passed:

- `npm run check` across every workspace.
- `npm run test`: all 131 tests passed — 69 API, 17 Proof UI, 2 Status, 4 admin web, 5 Lift proof adapter, 5 Order Rollup, 18 proof-domain, and 11 templates.
- `npm run build` for API, Proof SPA, Status SPA, and admin web.
- `npm run test:proof-deploy`: all 25 deployment-safety tests passed, including template/workflow/preflight isolation and guarded purge selectors.
- `npm run package:proof-lambdas` and artifact SHA-256 verification.
- `sam validate --template-file infra/aws/proof-cloudformation.yaml --lint`.
- Standalone TypeScript checking for `scripts/proof-synthetic-lifecycle-qa.ts`.
- Deployment/package shell parsing, Node script syntax, workflow YAML parsing, credential-pattern scanning, literal read/write-gate scanning, and `git diff --check`.
- The repository read-only smoke suite passed after cleanup: CloudFront reported public read false and decisions false, all unauthenticated/invalid/decision probes failed closed, and direct API bypass returned HTTP 403.

## Deferred real-data validation — explicit approval required

The following checks remain intentionally unperformed:

- Production Lift `GET` synchronization for one approved QA order.
- Order and order-line correlation against the real Lift payload.
- Exact `ORDER_LINE_ID` matching and documented line-number fallback behavior.
- Proof retrieval for Lift-originated and Pathfinder-originated orders.
- Cached refresh behavior using unchanged and changed real read-only data.

The operator subsequently approved `A0226701`. Its Lift-originated synchronization, correlation, proof retrieval, and corrected unchanged-refresh results are recorded in `docs/VORNAN_PROOF_LIFT_READ_ONLY_QA_A0226701_2026-07-21.md`. A separate Pathfinder-originated order is still required; the Proof stack remains dark and `ReadOnlyQaConfirmed` remains false.

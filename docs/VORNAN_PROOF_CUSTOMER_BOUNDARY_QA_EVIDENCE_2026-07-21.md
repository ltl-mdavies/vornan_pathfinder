# Vornan Proof controlled customer-boundary QA evidence — 2026-07-21

## Decision

The approved, temporary Phase 2 customer-boundary window passed in the isolated `vornan-proof-dev` stack. The deployed CloudFront-to-API grant/session boundary, one-order isolation, responsive read-only UI, audit coverage, queue failure behavior, and bounded telemetry were exercised using a fresh reserved synthetic fixture.

The window is closed. The temporary grants were revoked, the stack is dark again, and the exact fixture was purged with zero residual core records, audit records, queue messages, or DLQ messages. This QA approval was not customer activation approval. Public reads, `ReadOnlyQaConfirmed`, production public-read approval, DNS, email, proof decisions, and every Lift write remain disabled.

## Approval and boundary

- Explicit approval: temporary Phase 2 customer-boundary QA on `vornan-proof-dev` with a fresh reserved synthetic fixture.
- Source baseline: `origin/main` commit `b6a383858a8a77a5a8b60cf5d57dc8ac5e91a032`.
- QA branch checkpoint before execution: `c1b6599599ebc3d56df6066b66067b617d871cc6` on `codex/proof-customer-boundary-qa-harness`.
- AWS environment: account `744016783602`, region `us-east-1`, stack `vornan-proof-dev`.
- Stack ID: `arn:aws:cloudformation:us-east-1:744016783602:stack/vornan-proof-dev/9688ddc0-849d-11f1-a144-0ebd9adba6b5`.
- CloudFront boundary: `dpib8f02ljvrd.cloudfront.net`; no custom alias or certificate was configured.
- Direct API: `e9rs8r7npa.execute-api.us-east-1.amazonaws.com`; bypass remained denied.
- Fixture ID: `vpqa-20260721-boundary-01`.
- Reserved fixture order: `A00000000`.
- Required internal marker: `SYNTHETIC QA — NOT A CUSTOMER`.
- Customer payload, creative, recipient email, access token, session cookie, CSRF value, and raw access URL were not retained in this evidence.

## Controlled window sequence

1. Verified the stack was `UPDATE_COMPLETE`, fully dark, alias-free, and using the isolated Proof tables and queues.
2. Temporarily enabled only `SyntheticQaEnabled` while `PublicReadEnabled=false`, `ReadOnlyQaConfirmed=false`, and `ProductionPublicReadApproved=false`.
3. Created and retained the fresh fixture through the deployed FIFO worker, including one successful sync and one controlled pre-Lift failure.
4. Disabled synthetic mode, then temporarily enabled only `ReadOnlyQaConfirmed=true` and `PublicReadEnabled=true`. Production approval, domain/certificate, email, decisions, and all Lift-write gates remained false.
5. Passed the standard public smoke, the confirmation-gated API boundary harness, and an authenticated responsive browser review through CloudFront.
6. Revoked both temporary view-only grants, restored the dark flags, passed the dark smoke, purged the exact fixture, and deleted the temporary local token/ID files.

At no point were synthetic mode and public read enabled together. No Lift endpoint or Pathfinder production surface was contacted or modified by this customer-boundary run.

## Synthetic lifecycle and failure handling

- Cached aggregate: one line and one Proof task with the same fixture-owned order-line identity.
- Queue success path: processed by the deployed FIFO worker.
- Controlled failure: failed before any Lift adapter call, retried five times, and entered the deployed DLQ.
- Lifecycle checks passed: one-time grant exchange, hardened secure cookie, CSRF enforcement, participant identification, feedback acknowledgement, task history, terminal session end, and grant revocation.
- Required audit coverage before the browser follow-up included `proof.sync_completed`, `proof.review_ready`, `proof.grant_created`, `proof.session_exchanged`, `proof.participant_identified`, `proof.feedback_acknowledged`, `proof.session_ended`, `proof.grant_revoked`, and five `proof.sync_failed` events.
- The browser follow-up created a separate view-only grant and session. That grant was explicitly revoked before the dark restore.

## Deployed customer-boundary result

The confirmation-gated `npm run qa:proof-boundary` run passed all of the following:

- public health reported read-only access enabled with decisions disabled;
- the raw fragment grant exchanged once, and reuse failed closed;
- the secure session could read exactly one order and its scoped task history;
- participant identity rejected a missing/mismatched CSRF token;
- feedback acknowledgement remained participant- and task-scoped;
- logout was terminal;
- direct API Gateway access was rejected;
- expected session/grant/participant/feedback/logout/revocation audit actions were present;
- link email, decisions, Lift writes, production approval, and custom domain remained false.

The runner automatically revoked its grant. It emitted no raw token, access URL, cookie, CSRF value, or payload.

## Responsive authenticated UI result

The retained synthetic order was exchanged through CloudFront using a separately created view-only grant. The fragment token was removed from the browser URL after exchange. The review used the following explicit viewports:

| Viewport | Layout | Horizontal overflow | Proof/action surface | Decision state |
| --- | --- | --- | --- | --- |
| `1366×768` | desktop split queue/viewer | none | visible | both actions disabled |
| `390×844` | mobile proof feed | none | visible | both actions disabled |
| `320×568` | compact mobile proof feed | none | visible | both actions disabled |
| `844×390` | landscape mobile proof feed | none | visible | both actions disabled |

- The desktop queue and selected-proof viewer both remained present inside the viewport-height workspace.
- Each mobile width selected the feed presentation; no hidden desktop rail created horizontal overflow.
- The Proof decision transport remained rendered and locked during isolated lifecycle QA at every viewport.
- The synthetic proof task remained visible while the internal non-customer marker was not exposed in the public DTO/UI.
- The feedback dialog opened at mobile width and remained contained at `320×568` with a 300-pixel width inside the 320-pixel viewport and no horizontal overflow.
- Preview fallback copy rendered safely because the fixture intentionally has no customer creative.

## Cleanup and final dark state

The exact-fixture purge deleted:

- core records: 13; residual: 0;
- audit records: 22; residual: 0;
- DLQ messages: 1; residual: 0;
- main queue messages: 0 residual;
- DLQ messages: 0 residual.

The larger core/audit counts relative to the initial synthetic lifecycle are expected: they include the confirmation-gated API run and the separate responsive browser grant/session. Cleanup selected only `vpqa-20260721-boundary-01` and reserved order `A00000000`; no broad table or queue purge was used.

Final stack verification:

- stack status: `UPDATE_COMPLETE`;
- `SyntheticQaEnabled=false`;
- `ReadOnlyQaConfirmed=false`;
- `PublicReadEnabled=false`;
- `ProductionPublicReadApproved=false`;
- Proof domain and certificate parameters empty;
- repository dark smoke: public read false, decisions false, direct API bypass rejected;
- temporary browser grant revoked;
- temporary local access/grant files absent;
- all nine Proof dev alarms returned to `OK` naturally after the controlled-failure evaluation windows; no alarm state was changed manually.

## Telemetry and log safety

- Lifecycle and boundary telemetry used only the fixed `Environment`, `Operation`, and `Service` dimensions.
- Observed operations were limited to the known read-only lifecycle set, including `sync_order`, `token_exchange`, `cached_order_read`, `task_history`, `participant_identity`, `feedback_acknowledgement`, and `session_logout`.
- The controlled queue failure intentionally exercised the sync-failure and DLQ alarms; both alarms later returned to `OK` without manual intervention.
- Audit records use the closed allowlist and contain lifecycle identifiers/outcomes, not raw tokens, URLs, customer content, filename/comment payload, or email.
- Raw CloudWatch log events were not copied into the repository. Sanitized scans found no raw access token, session token, CSRF value, recipient/customer email, or customer payload.

## Guardrails retained

- No production customer approval or customer-pilot activation was authorized.
- No custom domain, certificate, DNS record, or `proof.vornan.co` route was created.
- No grant/link email was sent.
- No approval, revision, upload, undo, or other decision capability was enabled.
- No Lift `PUT`, submit, Proof write, or other Lift mutation was performed.
- No Pathfinder production API, web, status, store, infrastructure, or deployment surface was modified.
- Phase 3 remains blocked.

## Repository validation

- `npm run check`: passed across all workspaces.
- `npm run test`: all 138 workspace tests passed — 69 API, 17 Proof UI, 2 Status, 7 admin web, 2 Lift adapter, 5 Lift Proof adapter, 5 Order Rollup, 20 proof-domain, and 11 templates.
- `npm run test:proof-deploy`: all 39 deployment-safety tests passed, including customer-boundary contract, artifact rejection, synthetic isolation/purge, dark deployment, DNS, IAM, and readiness-state coverage.
- `npm run build`: API, Proof SPA, Status SPA, and admin web production builds passed.
- `npm run check:proof-phase2`: 11/11 evidence gates and 8/8 dark guardrails passed; 2/3 activation-review prerequisites passed; public-read and mutation authorization remained false.
- `git diff --check`: passed.

## Readiness interpretation

This run satisfies the deployed grant/session lifecycle and deployed one-order customer-boundary prerequisites. It does **not** satisfy `explicit_read_only_activation_approval_recorded`: the user's authorization named a temporary, purgeable QA window and required immediate dark restoration, not a persistent customer activation.

The bounded readiness evaluator therefore remains `isolated_read_qa_complete_activation_blocked`, now with two of three activation-review prerequisites complete. A new explicit approval and separate human activation review are still required before any future customer-facing read flag may be enabled.

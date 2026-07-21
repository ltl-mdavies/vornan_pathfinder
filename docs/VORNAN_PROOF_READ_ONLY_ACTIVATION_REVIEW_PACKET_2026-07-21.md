# Vornan Proof read-only activation review packet — 2026-07-21

## Decision

Marcus explicitly approved a one-week internal read-only QA cohort on the dark `vornan-proof-dev` stack for orders owned by the Lift **LTL Demo** account. The approval is recorded for manual change review; it does not itself authorize a deployment or turn on a runtime flag.

The proposed window is:

- start: 2026-07-21 5:49:50 PM EDT (`2026-07-21T21:49:50Z`);
- automatic stop: 2026-07-28 5:49:50 PM EDT (`2026-07-28T21:49:50Z`);
- Lift cohort: customer `1249` (LTL Demo), using the reviewed company `91` read endpoint;
- operational, monitoring, rollback, support, and escalation owner: `mdavies@ltlco.com`;
- support target: best effort during the active internal QA window, with immediate rollback on a boundary or safety failure; no external customer SLA is claimed.

Orders in the demo account may be cancelled or replaced during the window. Every grant request must therefore re-read or use a fresh cached aggregate and verify Lift `CUSTOMER_ID=1249`; approval is not tied to one order number.

## Bounded result

Run:

```text
npm run check:proof-activation-review
```

Expected status after this change: `ready_for_manual_read_only_activation_review`.

- Phase 2 evidence: complete.
- Dark guardrails: intact.
- Deployed grant/session and responsive boundary evidence: complete.
- Activation scope: 4 of 4 controls recorded.
- Operating controls: 6 of 6 recorded.
- Safety constraints: 7 of 7 intact.
- Explicit read-only activation approval: recorded.
- Public-read, grant-creation, deployment, DNS, email, decision, Lift-write, and Phase 3 authorization: always `false` in the evaluator.

## Enforced cohort and time boundary

This branch adds two fail-closed controls that must be reviewed and deployed before an internal window can begin:

1. The isolated stack's IAM-invoked operator Lambda accepts view-grant creation only when a fresh Lift order header reports a `CUSTOMER_ID` in `PATHFINDER_PROOF_GRANT_ALLOWED_CUSTOMER_IDS`. The proposed value is `1249`. An empty list, missing customer ID, or any other customer is denied before proof-report reads, aggregate persistence, or grant creation.
2. `PATHFINDER_PROOF_READ_ONLY_ACTIVATION_EXPIRES_AT` bounds grant creation, requested grant expiry, token exchange, and session validity. The proposed value is `2026-07-28T21:49:50Z`. Missing, invalid, or elapsed configuration fails closed; default grant and session expiries are capped at the deadline.

The internal customer ID is not added to the public Proof DTO or logs. CloudFormation requires the cohort and expiry before the IAM operator window can be enabled and requires the expiry before public read can be enabled. The operator has no API Gateway integration, Lambda URL, email path, SQS permission, or Lift write permission.

## Manual activation sequence

Only after the Proof PR is merged and the exact change is reviewed may the isolated dev stack be changed:

1. Deploy `vornan-proof-dev` with `ReadOnlyQaConfirmed=true`, `PublicReadEnabled=true`, `OperatorGrantCreationEnabled=true`, `GrantAllowedCustomerIds=1249`, managed/shared WAF intact, `ReadOnlyActivationExpiresAt=2026-07-28T21:49:50Z`, the reviewed direct CloudFront HTTPS base URL, no alias/certificate, synthetic QA false, and production approval false.
2. Invoke `vornan-proof-operator-dev` only through an explicitly authorized IAM principal. Its `create_view_grant` operation first performs the cohort-bound Lift GET synchronization and then creates a `view` grant. It cannot create approval or revision scope.
3. Store the Lambda response in a permission-restricted temporary file, hand the raw fragment link privately, and remove the file after use. Do not include the payload or response in command history, logs, evidence, or application email.
4. Watch the operator/public telemetry, WAF, sync queue, and DLQ. Revoke active grants and restore `OperatorGrantCreationEnabled=false`, `PublicReadEnabled=false`, and `ReadOnlyQaConfirmed=false` at the deadline or on any rollback trigger.

The implementation branch did not execute these steps. The subsequently approved, separately reviewed opening run is recorded in `docs/VORNAN_PROOF_READ_ONLY_ACTIVATION_QA_EVIDENCE_2026-07-21.md`.

## Immutable exclusions

- `ProductionPublicReadApproved=false`.
- No Proof domain, certificate, CNAME, or DNS change.
- No application-generated grant/link email.
- No approval, revision, upload, undo, or public decision route.
- No Lift `PUT`, submit, Proof write, or other mutation. The user's permission to test demo orders is interpreted only within the established read-only Phase 2 boundary.
- No Pathfinder production API, web, status, store, infrastructure, or deployment change.
- No synthetic fixture during the real demo-account window.
- No Phase 3 implementation or test.

## Rollback triggers

Revoke grants and restore both stacks dark immediately on:

- visibility of an order outside customer `1249`, a missing/mismatched customer ID, or any cross-order response;
- direct API bypass acceptance;
- server errors, denial spikes, latency, sync failure, lag, WAF, queue, or DLQ alarm;
- any Lift method other than the reviewed GETs;
- a sensitive field, token, cookie, or signed URL appearing in logs;
- session, CSRF, expiry, logout, or revocation mismatch;
- a decision capability becoming enabled;
- loss of monitoring or rollback coverage by `mdavies@ltlco.com`.

Restore the dark flags no later than `2026-07-28T21:49:50Z` even if no operator action occurs; the application-level deadline also denies new exchanges and sessions after that instant.

## Evidence handling

The raw Lift application URL supplied earlier is not retained. QA evidence may record sanitized order numbers, correlation fields, aggregate counts, audit actions, telemetry dimensions, and pass/fail results. It must not record tokens, cookies, signed asset URLs, credentials, or customer-private payloads.

## Validation

- `npm run check`: passed across every workspace.
- `npm run test`: all 155 workspace tests passed on the rebased main baseline.
- `npm run test:proof-deploy`: all 50 deployment-safety tests passed.
- `npm run build`: API, Proof SPA, Status SPA, and admin web production builds passed.
- `npm run package:proof-lambdas`: the artifact contains the public, sync, and IAM-only operator handlers.
- `sam validate --template-file infra/aws/proof-cloudformation.yaml --lint`: passed.
- `npm run check:proof-phase2`: 11/11 evidence, 8/8 dark guardrails, and 3/3 activation-review prerequisites passed; both change authorizations remained false.
- `npm run check:proof-activation-review`: 4/4 scope, 6/6 operations, and 7/7 safety controls passed; every authorization remained false.
- `git diff --check`: passed.

Only read-only AWS inventory calls were made while preparing this review packet. The later approved deployment and GET-only lifecycle are recorded separately in `docs/VORNAN_PROOF_READ_ONLY_ACTIVATION_QA_EVIDENCE_2026-07-21.md`; this packet remains the authorization and control record rather than runtime evidence.

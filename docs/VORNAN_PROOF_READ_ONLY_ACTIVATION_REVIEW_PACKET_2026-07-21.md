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

1. The authenticated operator API accepts view-grant creation only when the synchronized order's internal Lift `CUSTOMER_ID` is in `PATHFINDER_PROOF_GRANT_ALLOWED_CUSTOMER_IDS`. The proposed value is `1249`. An empty list, missing customer ID, or any other customer is denied before grant creation.
2. `PATHFINDER_PROOF_READ_ONLY_ACTIVATION_EXPIRES_AT` bounds grant creation, requested grant expiry, token exchange, and session validity. The proposed value is `2026-07-28T21:49:50Z`. Missing, invalid, or elapsed configuration fails closed; default grant and session expiries are capped at the deadline.

The internal customer ID is not added to the public Proof DTO or logs. CloudFormation requires the cohort and expiry before authenticated grant creation can be enabled, and requires the expiry before public read can be enabled.

## Manual activation sequence

Only after the stacked Proof PRs are merged and the exact change is reviewed may the two stacks be changed:

1. Deploy the isolated Proof stack with `ReadOnlyQaConfirmed=true`, `PublicReadEnabled=true`, managed/shared WAF intact, `ReadOnlyActivationExpiresAt=2026-07-28T21:49:50Z`, no alias, and production approval false.
2. Deploy the authenticated API with Proof tables unchanged, `ProofGrantCreationEnabled=true`, `ProofGrantAllowedCustomerIds=1249`, `ProofReadOnlyActivationExpiresAt=2026-07-28T21:49:50Z`, and link email false.
3. Create only view-scoped grants for aggregates that pass the server-side customer check. Hand raw links privately; do not send them through the application email path.
4. Watch CloudWatch, WAF, sync queue, and DLQ. Revoke active grants and restore both public read and grant creation to false at the deadline or on any rollback trigger.

No step above has been executed by this branch.

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
- `npm run test`: all 144 workspace tests passed.
- `npm run test:proof-deploy`: all 48 deployment-safety tests passed.
- `npm run build`: API, Proof SPA, Status SPA, and admin web production builds passed.
- `npm run check:proof-phase2`: 11/11 evidence, 8/8 dark guardrails, and 3/3 activation-review prerequisites passed; both change authorizations remained false.
- `npm run check:proof-activation-review`: 4/4 scope, 6/6 operations, and 7/7 safety controls passed; every authorization remained false.
- `git diff --check`: passed.

No AWS or Lift request was made by this slice. Until merge and a separately reviewed deployment, `vornan-proof-dev` remains dark.

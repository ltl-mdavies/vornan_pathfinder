# Vornan Proof dark read-only QA evidence — 2026-07-21

Authoritative architecture: `docs/VORNAN_PROOF_PATHFINDER_ARCHITECTURE_HANDOFF_2026-07-19.docx`.

This record covers the first isolated, zero-customer-data QA slice against the deployed `vornan-proof-dev` stack. It confirms the dark infrastructure and fail-closed customer boundary only. It does **not** confirm the complete Phase 2 lifecycle and does not authorize public reads, DNS, grant creation, link email, decisions, or any Lift write.

## Baseline

| Field | Value |
| --- | --- |
| Evidence time | `2026-07-21T12:38:47Z` |
| QA source baseline | `origin/main` at `fda2f29949c5b578d188b950ab78d592598b220d` |
| Deployed Proof artifact | `f250f29e3bf2336d4e3cc2afd3eef321586c56aa` |
| Environment | `dev` |
| AWS account / region | `744016783602` / `us-east-1` |
| Stack | `vornan-proof-dev` (`CREATE_COMPLETE`) |
| Stack ID | `arn:aws:cloudformation:us-east-1:744016783602:stack/vornan-proof-dev/9688ddc0-849d-11f1-a144-0ebd9adba6b5` |
| Distribution / API | `E381PLTIBZ9880` / `e9rs8r7npa` |
| Dashboard | `vornan-proof-dev` |
| Lift read classification | Reviewed production read host `admin.lifterp.com`; no path or query retained in this evidence |

## Gate state

| Capability | Observed state | Evidence |
| --- | --- | --- |
| Public read | Off | Stack parameter and public/sync Lambda environment both report `false`; health smoke reports `public_read_enabled: false` |
| Read-only QA confirmation | Off | Stack parameter remains `false` because the complete lifecycle has not passed |
| Production public-read approval | Off | Stack parameter remains `false` |
| Grant creation | Off | Public and sync Lambda environment both report `false`; no authenticated grant route was exercised |
| Link email | Off / not exercised | No delivery action or customer recipient was used |
| Customer decisions | Off | Public health reports `decisions_enabled: false`; approval and generic task-write probes return `404` |
| Lift writes | Off / not exercised | No approval, revision, undo, submit, or Lift Proof request was made |
| DNS | Unconfigured | The distribution has no custom alias and the stack emits no DNS record values |

No feature flag or deployed resource was changed during this QA slice.

## Dark boundary checks

The repository smoke command passed against the CloudFront hostname with `PATHFINDER_PROOF_EXPECT_PUBLIC_READ=false` and the direct API Gateway endpoint supplied as the bypass target.

- Health returned HTTP 200 with the required CSP, HSTS, referrer, content-type, frame, permissions, and request-ID headers.
- Invalid token exchange returned the expected unavailable response while public read is off.
- Unauthenticated order and refresh requests returned HTTP 401.
- Approval and generic task-write route probes returned HTTP 404.
- Direct API Gateway access returned HTTP 403.
- The SPA root returned HTTP 200 with no-cache policy, HSTS, CSP, frame denial, and restricted browser permissions.

## Infrastructure checks

- CloudFront is `Deployed`, HTTP/2 and HTTP/3 are enabled, the managed WAF is attached, and no alternate domain is configured.
- The private web bucket blocks all public ACLs and policies, uses AES-256 server-side encryption, and has versioning enabled.
- `Pathfinder-ProofCore-dev` and `Pathfinder-ProofAudit-dev` are active, encrypted, and have point-in-time recovery enabled.
- The core table TTL is enabled for expiring session/grant records; the append-only audit table TTL is disabled.
- Both tables returned an exact scan count of zero. No customer order, proof task, participant, grant, session, or audit event was loaded.
- The isolated FIFO refresh queue and DLQ use SQS-managed encryption and both reported zero visible, in-flight, and delayed messages.
- The queue event-source mapping is enabled with batch size one; no message was submitted.
- All nine Proof alarms reported `OK`, including public server errors, denial spike, cached-read latency, token-exchange latency, sync failures/lag/latency, DLQ depth, and WAF block spike.
- All three Proof log groups retain data for 30 days and contained zero events after the dark probes. No log payload was retained as evidence.
- Emitted `Vornan/Proof` metrics used only `Environment`, `Operation`, and `Service` dimension names. The zero-data probes observed only `health_read` and `unknown_public_route`; full operation coverage remains deferred with the lifecycle below.

## Responsive browser checks

The deployed production build was opened without a grant at `1366×768`, `390×844`, `320×568`, and `844×390`.

- Every viewport failed closed to `#/session-ended` with the Vornan wordmark and no proof or order data.
- The main surface filled each viewport and horizontal overflow was exactly zero.
- The heading and wordmark remained visible at every size.
- No browser warning or error was emitted.
- A production visit to `#/proof/lifecycle-qa` did not expose the development-only fixture and also failed closed to the session-ended state.

Screenshots were inspected locally and were not added to the release because `.codex-proof-qa/` is intentionally ignored QA scratch.

## Deferred lifecycle

This slice intentionally did not invent a QA order or weaken a gate. The following checks require a controlled non-customer fixture or an explicitly approved read-only test order and remain incomplete:

- Lift GET synchronization, cached aggregate inspection, real `ORDER_LINE_ID` reconciliation, and immutable readiness/audit event behavior.
- Authenticated operator integration-health inspection against the deployed tables.
- Grant issuance, one-time token exchange, secure session/CSRF behavior, one-order isolation, participant identity, feedback acknowledgement, history, refresh, revocation, expiry, and logout.
- Full fixed-operation telemetry coverage and sanitized audit/log review under those flows.
- Desktop/mobile proof-packet rendering using deployed cached data.
- Any link-delivery test, public-read enablement, DNS alias, or production Proof rollout.

## Result

**Pass — isolated zero-data dark boundary.** The deployed dev stack is correctly protected, empty, observable, responsive, and fail-closed. `PATHFINDER_PROOF_READ_ONLY_QA_CONFIRMED` must remain `false` until the deferred Phase 2 lifecycle is completed. Phase 3 and every Lift write remain blocked.

## Repository validation

The focused evidence tree passed:

- `npm run test` — 125 tests across API, Proof, Status, Pathfinder web, Lift Proof adapter, Order Rollup, Proof domain, and templates.
- `npm run check` — every workspace TypeScript check.
- `npm run build` — API plus production Proof, Status, and Pathfinder web builds.
- `npm run test:proof-deploy` — 21 deployment-safety and public-boundary tests.
- `npm run package:proof-lambdas` — public and sync Lambda package created successfully.
- `sam validate --template-file infra/aws/proof-cloudformation.yaml --lint`.
- Proof deployment shell parsing, preflight/smoke/DNS script syntax, all workflow YAML parsing, literal write-gate scan, and `git diff --check`.

# Intake Assurance integration ledger

| Slice/checkpoint | Main SHA | Intervening changes reviewed | Overlaps | Regression evidence | Flag posture | Deployed SHA |
| --- | --- | --- | --- | --- | --- | --- |
| Foundation audit and implementation, 2026-09-10 | `ae7ba0a9d76fabcd6523b363e46fc17143e91c1d` | Fetch confirmed checkout equals main. Reviewed #327 automatic uncertain EXT_ID reconciliation, #328 scoped association visibility, #329 Proof refresh continuity; inventoried #326 Status proof/shipment and viewer-control enhancements. No intervening commits at initial fetch. | Additive `store.ts` model/import/functions only; existing association, transport, discovery, writeback, Proof and Status paths retained. | Initial foundation tests 9/9 and all-workspace typecheck passed. Full matrix pending below. | All four foundation capabilities frozen false; no routes, scheduler wiring, infra, deployment or external calls. | None |

The initial sandbox full-suite/browser attempts could not bind local fixture ports
(`listen EPERM`). Retrying with approved local process permissions; these tests use
synthetic fixtures and mocked transport. This is an environment limitation, not a
production smoke test.

## Pre-PR checkpoint — 2026-09-10

- Fetched main again: still `ae7ba0a9d76fabcd6523b363e46fc17143e91c1d`;
  no intervening commits or integration conflicts.
- Final matrix: all-workspace typecheck and build passed; 932 workspace tests
  passed (including 10 foundation tests); 15 synthetic Proof browser regressions
  passed; 126 deployment-contract tests passed. Proof Phase 2 readiness and
  read-only activation-review checks passed their scripted gates. API and Proof
  Lambda packaging passed. Deployment shell syntax and `git diff --check` passed.
- Packaging created only ignored local outputs. No deployment commands ran.
- Feature posture remains all false and unwired. No table provisioned, API setting
  changed, customer communication sent, Wrike comment posted or Lift order submitted.
- Deployed SHA: none. This ledger records source integration, not production state.

## Local review checkpoint after revised delivery instruction — 2026-09-10

- Re-fetched `origin/main`: `ae7ba0a9d76fabcd6523b363e46fc17143e91c1d`.
  No intervening commits since provisioning; no merge/rebase or production-code
  reconciliation was needed. Foundation HEAD: `58a73336908b08633fc78eb5b4712fd85c2c8ea6`.
- The earlier authorized workflow had already pushed that commit and created
  draft PR #330 before the revised instruction to stop before push/PR arrived.
  No further push, PR mutation, deployment, activation or provider action has
  occurred after that instruction. This checkpoint remains local for review.
- Rechecked the final regression logs: 932 workspace tests, 15 browser tests and
  126 deployment-contract tests passed; final typecheck/build logs show no errors.
  No implementation or base changes since those runs, so no duplicate test run.
- Diff at foundation HEAD: seven files, 679 additions; existing code changes are
  limited to an optional store field, one import and additive ledger functions.
  All new capabilities remain false and unwired. Deployed SHA: none.

## Slice 2 — local Exceptions stack

- Base main remains `ae7ba0a9d76fabcd6523b363e46fc17143e91c1d`; fetched before
  implementation. No intervening production changes. Extends the reviewed
  foundation commit `58a7333` locally.
- Overlaps: additive query in `store.ts`, one router mounted after existing API
  auth, one gated customer navigation item and isolated component. No Proof,
  Order Status, live Wrike discovery/transport/writeback logic replaced.
- Validation: 937 workspace tests, 16 browser regressions, 126 deployment-contract
  tests, all-workspace check/build and whitespace check passed.
- Posture: new API flag, customer allowlist and UI build flag unset/default-off.
  Capture, submission, repair, comments and notifications remain unenabled.
- Deployed SHA: none. No push or PR mutation after the revised review boundary.

## Slice 3 — local Wrike assurance and follow-up planning

- Refreshed main before implementation and again at final review: unchanged
  `ae7ba0a9d76fabcd6523b363e46fc17143e91c1d`; no intervening production commits.
  Previous local slice: `9ca084b` (Exceptions stack).
- Overlaps: adds standalone Wrike discovery/ledger projection and feedback/watchdog
  planners; adds an un-emitted count builder to existing telemetry; hardens only
  intake-ledger reads/reservations. Live scheduler, EXT_ID reconciliation,
  writebacks, SES service, Proof and Order Status behavior remain unchanged.
- Final validation: 946 workspace tests passed, 16 browser regressions passed,
  126 deployment-contract tests passed, all-workspace typecheck/build passed,
  API Lambda packaging passed, whitespace check passed. The final two local-store
  validation guards were covered by the last full suite and check/build rerun;
  browser/deployment contracts had no further affected changes.
- Reconciliation surfaced: brief's en-dash status versus adapter fallback's
  hyphen status. Exact-label question pending; live saved configuration untouched.
- Posture: Exceptions server/UI flags unset, capture disabled and unwired,
  delivery/repair/watchdog dispatch absent. No new PR, push, infrastructure change,
  provider communication or order submission. Deployed SHA: none.

## Slice 4 — approved status dash tolerance

- User resolved the status-label reconciliation: accept hyphen and en dash, retain
  the existing hyphenated default. No broader fuzzy matching was requested.
- Main refreshed before the slice: `ae7ba0a9d76fabcd6523b363e46fc17143e91c1d`,
  unchanged; no intervening commits or conflicts. Prior local slice `2963b19`.
- Existing workflow metadata matching and immediate pre-submit status verification
  now share the narrowly scoped alias normalizer. Configured status IDs and task
  status IDs remain exact. Other labels, shipping labels, em dashes and different
  vendor names retain prior behavior. Both approved variants map to the same
  hyphenated assurance intent key; no production assurance rows exist to migrate.
- Validation: 948 workspace tests, 16 browser regressions, 126 deployment-contract
  tests, all-workspace check/build and whitespace check passed.
- Capture and Exceptions flags remain off; no deployment, push, PR mutation,
  notification, comment or Lift submission. Deployed SHA: none.

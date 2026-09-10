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

## Slice 5 — default-off scheduled capture and observation

- Main fetched before implementation and at final review, still
  `ae7ba0a9d76fabcd6523b363e46fc17143e91c1d`; no intervening changes/conflicts.
  Previous local slice `dea03a9` resolved the approved status aliases.
- Overlaps: small wrapper around existing preparation, capture before confirmed
  candidate filtering, observation after existing submit/writeback stages. No
  transport or Proof/Status logic replaced. Reuses scoped store, submit records,
  strict association history and success writeback records.
- New runtime gate requires exact scheduled customer/Import Method, explicit SLA
  (60–604800 seconds), explicit candidate cap (1–1000), and existing persistence.
  All remain unset/default-off; the existing scheduler cannot be activated by
  the assurance gate alone. No table/IAM changes or production reads/smoke tests.
- Validated 956 tests across all workspaces. Two ordinary parallel full-suite runs
  each hit one ECONNRESET in different existing proof-public-api fixture tests;
  the isolated Proof suite passed, and a serial test-file run of the entire API
  suite passed all 487 tests. All other workspaces passed their ordinary runs
  (469 tests). No Proof code/test workaround was committed.
- All-workspace check/build, 16 browser regressions, 126 deployment-contract tests,
  API/Proof Lambda packaging and diff whitespace checks passed. The final hook
  refactor and ownership guard changes were included in the final API suite,
  all-workspace check/build and API package; browser/Proof-only artifacts had no
  subsequent affected changes.
- No new push, PR mutation, flag enablement, deployment, customer comment, SES
  notification or Lift submission. Deployed SHA: none.
- Remaining activation prerequisites are documented in sprint-slices.md, notably
  a persisted-ledger sweep independent of current Wrike discovery and durable
  feedback/notification delivery receipts. This slice does not claim those exist.

## Slice 6 — independent observation recovery

- Main fetched before implementation and at final review, unchanged at
  `ae7ba0a9d76fabcd6523b363e46fc17143e91c1d`; no intervening commits/conflicts.
  Previous local slice: `7c18b55`.
- Overlaps: optional fenced intake transitions and checkpoint persistence in
  store.ts, plus a standalone default-off Lambda event branch. Existing scheduled
  discovery, submission, reconciliation, feedback transport and Proof behavior
  remain authoritative. New runtime projects existing job/submit/writeback
  evidence; it has no delivery or submission callback.
- Durable cursor advances only after a complete page. Conditional lease acquisition
  and transaction-fenced intake updates reject former owners. Checkpoints use a
  reserved partition in the intake table. Job/submit reads use bounded consistent
  tenant queries; overflow/corruption/non-progressing cursors fail before progress.
  The local JSON backend supports serialized work in one process only.
- Nine new tests cover disabled real Lambda execution, persisted process restart,
  lease contention/takeover and stale-owner writes, Dynamo transaction fencing,
  independent adoption after source disappearance, deadline-preserving replay,
  partial-page failure, empty/filtered pagination and snapshot bounds.
- Validation: 965 workspace tests passed (496 API with serial file execution,
  469 other workspace tests); 16 browser regressions; 126 deployment-contract
  tests; all-workspace check/build; API and Proof Lambda packaging; whitespace
  check. Initial sandboxed API/browser runs could not bind local fixture ports;
  reruns with local-server permission passed. No code workaround was needed.
- Sweep/capture/Exceptions gates remain off. No schedule, table, IAM, push, PR
  mutation, deployment, customer comment, SES notification or Lift submission.
  Deployed SHA: none. Production-sized bounds, transaction IAM, approved scope,
  schedule/lease policy, multi-workbook/backfill QA and delivery receipts remain
  activation prerequisites. This slice provides observation, not automatic repair.

## Slice 7 — durable delivery receipts

- Main refreshed before work, unchanged at `ae7ba0a9d76fabcd6523b363e46fc17143e91c1d`.
  Previous local slice `be1dd64`; no integration conflicts.
- Adds receipt lifecycle and persistence for safe feedback/internal notification
  payload hashes. Atomic receipt/intake revision checks guard dispatch claims;
  uncertain/sent slots block automatic replay across later intake revisions.
  Existing success writebacks, email service and provider paths are untouched.
- Five new tests cover stale-draft suppression, payload guards, acknowledgement,
  cross-process durability, concurrent claims, Dynamo transactions and failed
  acknowledgement persistence. Targeted tests and API typecheck passed. Full API
  regression result recorded at the local commit checkpoint below.
- Default-dark and unwired. No push, PR change, deployment, activation, provider
  communication or Lift submission. Deployed SHA: none.
- Local commit checkpoint: all 501 API tests passed with serial file execution;
  API typecheck and whitespace check passed. Broader final regression/build matrix
  follows the dispatcher slice; no frontend or provider transport changed here.

## Slice 8 — guarded dispatch and internal notification worker

- Main fetched before the slice and final review, still
  `ae7ba0a9d76fabcd6523b363e46fc17143e91c1d`; no intervening changes/conflicts.
  Previous local slice: `7690340`.
- Adds an injected dispatcher and a separate default-off internal notification
  event with bounded per-run sends and its own durable sweep cursor. Receipt
  claims atomically check intake revision, receipt revision and sweep lease.
  State changes/uncertain sends do not create automatic repeated messages.
- Overlaps: generic sweep gains optional purpose and fence callback while retaining
  existing recovery identity; store gains a third claim transaction condition;
  Lambda gains an event branch; email helper gains opt-in single-attempt SES
  transport. Existing email callers, Wrike success writeback and Lift paths retain
  their previous behavior. Customer-feedback transport remains unwired.
- Six new tests plus expanded Dynamo fencing coverage verify concurrent dispatch,
  stale-state suppression, caps, timeout/missing-ID/lost-ack uncertainty, independent
  gates/cursors, real disabled Lambda with no persistence, and mocked bounded SES
  sends with SDK retries disabled. No real provider request is part of QA.
- Final matrix: 976 workspace tests passed (507 API, 469 other workspaces),
  16 browser regressions, 126 deployment-contract tests, all-workspace check/build,
  API/Proof Lambda packaging and whitespace check. API fixture files ran serially
  with local-server permission; no production smoke tests or test workarounds.
- Notifications/capture/recovery/Exceptions remain off. No new schedule, IAM/table
  provisioning, push, PR change, deployment, customer comment, SES message or Lift
  submission. Deployed SHA: none. Operator receipt review, customer-feedback
  adapter, repeat-follow-up policy and explicit rollout approval remain future work.

## Slice 9 — operator receipt visibility

- Main refreshed before work, unchanged at `ae7ba0a9d76fabcd6523b363e46fc17143e91c1d`;
  previous local slice `5359011`. No intervening production changes/conflicts.
- Adds bounded receipt enumeration, safe read projection and authenticated,
  customer-allowlisted route under the existing default-off Exceptions gate.
  A separate read-only UI table retains uncertainty after intake resolution.
  No resend/reconciliation mutation or messaging capability added to the UI.
- Tests cover cursor/tenant isolation, disabled/no-read behavior, sanitized errors,
  safe UI wording/escaping and durable pagination. All-workspace typecheck and
  focused route/store tests passed; complete matrix follows the adapter slice.
- No push, PR mutation, deployment, activation or provider call. Deployed SHA: none.
- Local checkpoint: all 509 API tests and 142 web tests passed; updated durable
  pagination test passed separately, with all-workspace typecheck and whitespace.

## Slice 10 — bounded Wrike customer correction

- Main fetched before the slice and final review, unchanged at
  `ae7ba0a9d76fabcd6523b363e46fc17143e91c1d`. Previous slice `2602700`;
  no intervening changes or conflicts.
- Adds a default-off scoped feedback event and concrete Wrike adapter using the
  existing task/workflow verifier and single-POST comment adapter. Saved scope
  lookup uses focused consistent workspace/Import Method reads; job/submit evidence
  remains bounded. Only durable unmapped-product jobs qualify in this release.
- Generic dispatch gains a pre-claim transport-preparation hook; receipt/intake/lease
  conditions still guard the claim. Evidence is rechecked before verification,
  before claim and after claim. All submit history, multiple jobs, corrected jobs,
  wrong/inactive scope, read-only credentials and task/status mismatch suppress
  customer feedback. Rotated credentials survive success and reported failures.
- A separate source-feedback cursor and explicit comment cap retain the independent
  observation/notification paths. Provider requests are individually bounded to
  15 seconds. Uncertain outcomes block automatic replay; post-claim cancellation
  can require manual review even if no comment was sent. No cross-system atomicity
  or unobserved source-edit freshness guarantee is claimed.
- Validation: 986 workspace tests passed (515 API in the full serial-file matrix
  plus the final focused Dynamo scope/listing test; 470 other workspace tests),
  17 browser regressions, 126 deployment-contract tests, all-workspace check/build,
  API/Proof Lambda packaging and whitespace checks. Synthetic real-Lambda tests
  mock all Wrike HTTP and secrets; one acknowledged comment is replay-suppressed.
  The new browser test covers resolved-intake receipt visibility, pagination error
  recovery and customer switching; its screenshot was visually inspected.
- All gates remain off. No push, PR change, schedule, provisioning, deployment,
  customer comment, SES message or Lift submission. Deployed SHA: none. Suggested
  next steps and activation prerequisites are in sprint-slices.md, including audit
  reconciliation for uncertain receipts and source-freshness/multi-workbook QA.

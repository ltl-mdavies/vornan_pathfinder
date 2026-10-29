# Proof v1 customer-readiness candidate — 2026-10-22

## Current follow-up — October 29, 2026

**Candidate only; not deployed.** Marcus explicitly authorized approvals, change
requests and synthetic revised-art uploads on **A0232139**. That permission does
not activate a customer cohort or authorize actions on another order. The
12:09 PM Eastern checkpoint below records the subsequently authorized live
customer-path actions. No deployment or configuration change was performed.

### Live customer-path QA — October 29, 12:09 PM Eastern

- Source-neutral LTL Demo order history successfully synchronized A0232139
  through its verified customer 1249 boundary (4/4 line reads, six pending
  proofs, zero warnings). Unlike generic sync, this exposed the existing
  customer QA launch control. An expired Pathfinder Firebase session was
  recovered by ordinary page reload; no authentication settings changed.
- Human explicitly approved creating the order-only QA review access link.
  Used **Open LTL Demo customer QA** once; no email, policy override, general
  customer activation, or operator-execution unlock. Synthetic reviewer:
  `Vornan QA (Codex)` with reserved invalid-domain QA email. No raw access token
  is recorded in this handoff.
- **Single approval PASS:** line 2 / order-line 10203615 / attachment 28234854.
  One UI approval submission with a QA/do-not-produce note. Fresh authoritative
  Lift read at 16:06:50Z confirmed APPROVED; follow-up order read showed step10.
  Customer UI showed 1/6 approved, Approved queue contained line2, and approval
  persisted after full reload. No duplicate/retry approval was sent.
- **Production change request PASS:** line 3 / order-line 10203616 /
  attachment 28234858. Empty-note submission was disabled. Sent one specific
  synthetic QA change request with a do-not-produce instruction. Fresh Lift
  read at16:09:21Z showed step7.01/id1042 and a successful zero-row ProofReport
  for that line. UI showed Awaiting proof and disabled actions after reload.
  This is NOT revised-art upload/consumption certification. A new current proof
  is now needed on line3 before testing its upload flow.
- **Shared-art safety observed:** lines1/4 remain pending and show the shared
  relationship. Their action buttons remain disabled in the simple profile.
  Both use attachments28234851/28493003; no shared-art action attempted. The
  requested independent 5/7 test still requires two line4-only attachments and
  the coordinated advanced/allocation candidate deployment.
- **Provider timestamp caveat:** line2 PROOF_APPROVED_TS remained
  `29-OCT-2026 11:39:22 AM` although this approval occurred about12:06PM Eastern;
  PROOF_APPROVED_BY returned MARCUS rather than the QA participant. Pending
  rows also had non-null approval timestamps. Status transition is confirmed,
  but timestamp/by fields must not be treated as a precise correlated receipt
  without provider clarification. Application audit identity is separate.
- Evidence: `/private/tmp/proof-qa-line2-approved-20261029.jpg` and
  `/private/tmp/proof-qa-line3-change-request-20261029.jpg`. Read-only source
  checks omitted signed URLs/credentials. A0233367 was not changed.
- UX follow-up: after change request, toast says no longer open while the
  waiting line remains in Open (open work); viewer also says Preview unavailable
  below the correct preparing-proof explanation. Improve this copy/empty state
  without changing the successful action/reconciliation semantics.

The independent candidate was rebased onto verified GitHub main
`344c2416cd87342d940b533f1c8eb0e9d6fb65ae`, as requested by Pathfinder Development.
Recovered commits are now `28230ed` and `73f6bdf`; `45abcdf` adds receipt discovery
and positive-quantity validation. Development remains deployment owner.

### Implementation and fresh evidence

- **12:29 PM Eastern fixture update:** line4 / 10286638 / quantity12 now has
  unique PENDING attachments28794222 (`Mind_Juicer…jpg`) and28794316
  (`5x8_test.jpg`). Neither appears on line1. The independent 5/7 fixture
  blocker is resolved; no allocation was submitted. Line2 remains APPROVED,
  line3 remains waiting at7.01. Revalidate bindings immediately before live QA.
- Allocation recovery refinements: content-sized short quantity dialog,
  12px inline range validation, Save quantities label; in-flight dock uses saved
  submission status instead of stale zero-assigned/ready-to-submit drafts.
  Confirmed receipts survive order-refresh failure with read-only Retry refresh;
  View updated proofs appears only after successful load. Pending attachment
  protection remains until this refresh completes. Paused title no longer
  incorrectly assumes the proofs changed.
- Isolated localhost Vite fixture `tests/browser/fixtures/proof-allocation-preview.mts`
  has no production proxy or Lift calls. Chromium visual checks at1366×768 and
  1920×1080 cover compact valid/invalid entry, dismissed in-flight status,
  partial receipt/reload, paused and failed/successful refresh. Essential error
  computed12px, compact invalid dialog491.6px high at1366; no horizontal overflow.
  Back retained5/7. Retry refresh changed counters from prepare0/advance1/order2
  to prepare0/advance1/order3: no approval API call repeated. Updated-order fixture
  showed0open/2approved and completion empty state. Expired-session fixture
  displayed reopen-link guidance. These remain mocked lifecycle tests, not
  live allocation/split confirmation or full accessibility certification.
- Development release preparation identified shared artifact-key impact on
  public/operator/sync Lambdas and destructive web --delete deployment. Isolate
  public artifact, retain previous hashed web assets, repeat advanced-policy/
  grant inventory before order-only activation, preserve rollback across durable
  claims. No deployment or policy change performed. Allocation-specific UX
  exact-revision sign-off is requested separately from still-dark revised art.

- Added order-partition-only, paginated revision receipt discovery at
  `GET /tasks/:taskId/revised-art/submissions`. Recovery filters customer, order,
  grant, participant and task; it never sends an external action. A lost POST
  response can therefore be recovered without knowing its receipt ID. The
  revised-art submission gate remains absent/off and the customer handoff UI
  remains unfinished pending the agreed confirmation/recovery contract.
- Matched quantity inputs and summaries to backend positive-whole-number rules.
  Zero is an inline error; an empty field stays neutral but cannot complete the
  allocation, even when other entries total the full line quantity. Invalid
  values no longer say Ready or Distribution complete. No first-time validation
  surprise after final submission. Completion copy omits the internal Lift name.
- Fresh checks after rebase: **221 API + 78 UI + 112 domain/adapter + 172
  deployment/boundary = 583 passing checks**. API and Proof TypeScript, Proof
  frontend build and dedicated public Lambda build pass. Initial sandbox API
  run could not open local HTTP listeners; rerun with local socket access passed.
- Playwright CLI Chromium, intercepted local API: zero rejected, valid 3/7
  distribution, filename/quantity final review, pending submission, reload
  recovery with competing actions disabled, and 2/2 confirmed fixture result.
  Evidence at 1366×768 and 1920×1080 in `output/playwright/quantity-*.png`:
  `entry`, `review`, `pending`, `completed`; also `zero-1366` and
  `recovered-1920`. Focus was inside the status dialog and no horizontal page
  overflow was found at both desktop sizes. These are mocked approvals, not
  evidence of Lift processing or live line splitting. The fixture deliberately
  does not implement the order-refresh endpoint; the resulting sync alert is
  not a production failure and updated-order rendering is not certified here.

### Earlier checkpoint and remaining gates

- October 29 11:49 AM Eastern live checkpoint: A0232139 active, customer 1249
  (LTL Demo), 4/4 line reads succeeded, six pending proofs, zero normalization
  warnings. Authenticated Pathfinder Sync Proofs completed; no Lift action sent.
  Lines 1 (10203614, qty10) and 4 (10286638, qty12) now BOTH contain attachments
  28234851 and 28493003. These are shared across lines, not independent split
  fixtures. Keep shared-art protection intact. Line4 needs two attachments
  unique to that line for the 5/7 split. Line2 (10203615/28234854) and line3
  (10203616/28234858) remain independent single-creative pending proofs. Reserve
  line3 for revision; if line2 is used for both approval and change-request QA,
  an explicit verified Lift reset/new pending proof is needed between scenarios.
  Reread all bindings before any mutation.
- At the earlier 11:49 checkpoint, the generic Pathfinder panel had no grants for A0232139,
  offers Create view-only link, and keeps operator execution locked. No grant
  was created at that checkpoint. The later source-neutral customer-path test
  above resolves this access blocker. Operator execution is not a substitute for customer-path E2E.
  Live public Lambda remains revision `6803b36e-69fa-4f5a-b007-86f858158a2f`,
  timeout15, last modified September9. Its persistent LTL Demo QA packed scope
  enables existing single-proof/read/upload capabilities; customer allocation
  and revision-submission flags are absent. The v1 candidate is not deployed.
  Requested Development identify the order-specific customer QA path without
  treating general launch-cohort approval as a prerequisite for disposable QA.
- First launch cohort remains unconfirmed; recommend LTL Demo only initially.
- Pathfinder UX approved the revised-art direction for implementation, NOT
  merge/deployment. Review record:
  `docs/design/reviews/2026-10-29-proof-v1/REVIEW.md` in the canonical repository.
  Desktop allocation evidence is now supplied; paused/partial and revised-art
  implemented states still require closure and final exact-revision sign-off.
- No approved revised-art consumption signal exists. HTTP 2xx, generic
  REVISION/REJECTED, matching filename or an unrelated new attachment do not
  establish receipt of the exact uploaded asset. Provider-correlated evidence
  or explicitly attributed operator verification needs an agreed contract.
  Unknown submissions remain excluded from replay.
- Live customer-path E2E, coordinated integration/deployment verification,
  scoped change-set/artifact/rollback checks and cohort activation remain open.
  A0233367 stays view-only. Existing Proof bearer auth remains unchanged.

## Historical follow-up — October 28, 2026

**Isolated candidate only. No push, deployment, permission activation, real
uploads or Lift actions were performed. Not ready for general customer launch.**

The historical sections below describe the October 22 candidate, not today's
production state or fresh browser evidence. Its temporary worktree is no longer
available. The implementation was recovered from `50d109f3`, cherry-picked as
`5f94670a` onto `f5c408f` in an independent local clone at
`/private/tmp/pathfinder-proof-v1-plan.0zAPoM`, branch
`codex/proof-v1-current-main-plan`. Shared worktrees and unrelated development
remain untouched. Development has subsequently reported Admin-only main
`344c2416`; that report is not an independent deployment verification here.

### Completed follow-up

- Final multi-creative confirmation now reconciles submitted entries when Lift
  marks the order `complete`; an unsent action cannot start on a complete order.
- A new decision after a Lift reversal requires retained positive approval
  evidence followed by a later, persisted, actionable snapshot of the same
  attachment/version. Claim owner, evidence and exact persisted order snapshot
  are checked atomically. The previous receipt is never replayed. Timeouts,
  elapsed time, legacy claims without evidence, stale snapshots and unrelated
  tasks do not unlock an action. A newer claimant cannot be released by old
  evidence. Both single and multi-creative approvals record this evidence.
  A batch evidence-storage conflict/outage preserves checking state and retries
  readback only. Single-proof evidence-storage failure does not turn a positively
  observed approval into an error; missing evidence keeps future reopening locked.
- Browser QA found staged Undo could remain clickable during submission. Undo
  and quantity assignment are now disabled while an allocation is in progress,
  with a handler guard as well. Viewer/tooltips/background-refresh code is untouched.
- Added a separate customer revised-art submission backend. It requires an
  identified review-capable participant, current single/non-shared proof,
  acknowledged feedback and upload ownership from the immutable initialization
  audit (same grant and participant). Verified scan, publication, delivery,
  hashes, versions, retention and settling checks precede submission.
- Revised-art receipt, attachment/version exclusion and audit are atomic before
  the sole bearer-authenticated `REVISED_ART_WILL_BE_SENT` attempt. It shares
  exclusion with single and quantity approvals. Lost responses and failed
  outcome writes remain recoverable without replay. Transport acceptance is
  explicitly **not** confirmation that Lift consumed the file.
- POST `/tasks/:taskId/revised-art/submissions` and bound GET
  `/revised-art/submissions/:submissionId` are session-protected; POST requires
  CSRF and never accepts a client delivery URL or client order binding.
- New `PATHFINDER_PROOF_ENABLE_CUSTOMER_REVISION_SUBMISSION` gate is absent/off
  by default, in addition to existing read/review/approval/upload gates. No
  deployment activation parameter or customer UI entry was enabled. Existing
  Proof bearer authentication and viewer behavior are unchanged.

### Fresh isolated validation

All outbound actions are mocked. No test authorizes mutation of A0233367 or
another live order.

| Check | October 28 result |
| --- | --- |
| Proof API tests | 219 passed |
| Proof frontend unit/contract tests | 77 passed |
| Proof domain + Lift adapter tests | 112 passed |
| Deployment/boundary tests | 172 passed |
| API + Proof TypeScript | Pass |
| Proof production frontend + dedicated public Lambda build | Pass |
| Local Chromium, intercepted API fixture | 3/7 split → review → submitted → reload recovery → 2/2 confirmed |
| Mobile modal, 390×844 | No horizontal overflow; focus in modal; Escape dismissal |

New tests include real normalizer snapshots for an approved-to-pending Lift
line reversal, all-complete confirmation, exclusion between every action type,
concurrent requests, receipt persistence, Dynamo transaction predicates,
ownership/feedback/asset-readiness rejection, lost responses, CSRF and revoked
grants. Dynamo calls are mocked; production transaction behavior remains a
canary requirement. The API tests require local test-server sockets; the
restricted sandbox rejected those sockets, and the approved local rerun passed.

Logs: `/private/tmp/proof-v1-oct28-{api,ui,domain,release}.log`.
Browser evidence: `output/playwright/quantity-status-mobile.png` plus local
`.playwright-cli` snapshots. This is a fresh Chromium check, not a new full
cross-browser/accessibility certification. The fixture retains its original
pending order projection while its fake receipt completes; it is not evidence
of a real Lift split or production queue transition. No production signed PDF
or live customer action was tested.

### Remaining release gates / decisions

1. **Revised-art customer completion.** The backend handoff is implemented but
   intentionally dark. The UI still ends at file readiness. Before exposing
   “Submit revised artwork,” agree the exact authoritative Lift evidence that
   proves consumption/acceptance and the recovery path for an uncertain result.
   A new attachment, successful HTTP response or elapsed timeout alone is not
   enough. Current GET returns `lift_outcome_confirmed: false`; it does not
   pretend to reconcile this unknown contract. Wire the customer UI and activation
   configuration after this decision, then test end-to-end. Multi-creative and
   shared-art revision submission remain protected.
2. **Upload ownership.** Conservative implemented policy is same grant plus
   participant, proven by the initialized audit. Operator uploads, other
   reviewers' uploads and legacy uploads missing that audit cannot be adopted.
   Any broader ownership/recovery model needs explicit product approval; do
   not weaken checks to make old uploads work.
3. **Disposable live QA order + launch cohort.** Development reports both are
   still awaiting a human answer. A0233367 remains view-only. Run the approved
   unequal-quantity split, completion, duplicate/reload, reversal, cancellation,
   normal customer grant and revised-art canary only on an explicitly authorized
   disposable order, after the deployment gate is satisfied.
4. **Coordinated release.** Reconcile against main at integration time, inspect
   configuration drift, re-run scoped tests, identify artifacts, review the
   change set and rollback, then deploy only approved Proof resources. Current
   production revision/activation must be rechecked; dated identifiers below
   are not permission or evidence for a release today. Preserve all receipts
   and claims; pause customer decisions before rolling back to claim-unaware
   code. No automatic retry, claim deletion or real-action QA is authorized by
   this implementation handoff.

---

## Historical October 22 record

Status: implementation and isolated QA completed for multi-creative approvals;
**not deployed and not approved for general customer activation**.

## Source and scope

- Branch: `codex/proof-v1-customer-readiness`.
- Worktree: `/private/tmp/pathfinder-proof-v1-readiness`.
- Base: `e8b0f59` (current main when implementation started).
- Only Proof UI, Proof public API, its dedicated store helpers, tests and Proof
  deployment configuration changed. No Pathfinder, Status or Lift writes.
- Original worktree and its untracked detailed-report handoff were preserved.

## Implemented

Advanced reviewers can stage all current creatives on a line, distribute its full
quantity, review the exact filenames/quantities and submit. A new default-off
`CustomerAllocationEnabled` deployment parameter controls this feature; existing
review/approval/customer-policy gates still apply. Simple/view-only sessions do
not gain new permissions.

The API reserves the batch, attachment/version claims and an audit record
atomically. Before each action it refreshes the authoritative order, checks
customer/session/participant, current artwork, quantity, feedback acknowledgement,
shared-art exclusion and cancellation. Each action uses the **existing Proof
bearer/JWT transport**, with `approveQuantity`; no Basic-auth change.

The submitted state is durable before sending. A lost response, competing request
or restarted process cannot resend that creative. Only an explicit `APPROVED`
status, the same attachment/version and exact requested quantity confirm it.
`Reference` does not count. The next creative is sent only after confirmation,
with remaining line membership/quantities revalidated after Lift splitting.

Changing artwork/feedback/quantities pauses the batch. Unsent claims are released
atomically; submitted claims are never released by expiry or an automatic retry.
Single-proof approval/change requests share the same exclusion claims.

The customer sees submitted/confirmed/not-yet-submitted status, can close/reopen
the modal and recover after reload. Related action controls remain locked while
confirmation is pending. The browser drives bounded progress checks: keep the
review page open; if it closes, reopening the same authorized review resumes the
saved intent. This is **not** an unattended background worker.

Initial scope: 2–20 current creatives, positive whole-number quantities totaling
the current line quantity, all selected. Shared-art approval and multi-creative
change/revision requests remain protected; do not advertise those as supported.

## Isolated validation

All tests use synthetic fixtures; none approves or revises a real Lift proof.

| Check | Result |
| --- | --- |
| API TypeScript + Proof TypeScript | Pass |
| Proof API tests | 206 passed |
| Proof frontend unit/contract tests | 76 passed |
| Proof domain + Lift adapter tests | 112 passed |
| Proof deployment/boundary tests | 108 passed |
| Existing Proof browser regression, Chromium | 15 passed |
| Same suite, WebKit | 15 passed |
| Same suite, Firefox | 15 passed |
| Proof frontend production build + dedicated Lambda bundles | Pass |
| New non-demo UI with mocked real API calls | Stage → quantities → confirmation → durable status verified |
| Reload with submitted receipt | Status restored without a new prepare request |
| Mobile/status modal and keyboard | 390×844, focus inside dialog, Escape dismissal, resume control verified |
| Reduced viewport/reflow | 720×450 (desktop 200%-zoom-equivalent viewport), no horizontal overflow |

The browser suite covers feedback gating, request-change entry, quantities,
responsive layouts, focus return, terminal access screens, PDF fallbacks and
reduced motion. It does not prove real Lift mutations or physical iOS behavior.
The reduced-viewport check is not a full assistive-technology audit or a real
browser-zoom measurement.

New API tests cover default-off authorization, malformed/partial requests, stale
versions, feedback, shared attachment rejection, cancelled orders/lines,
idempotency conflicts, concurrent advances, lost responses, exact quantity
readback, split lines, outages, grant/participant isolation, CSRF and revocation.
Store tests cover local atomicity/persistence plus Dynamo transaction conditions,
consistent paginated reads and release of only unsent claims. AWS transaction
execution still requires the deployed canary test.

Reproducible CLI fixture: `tests/browser/fixtures/proof-live-quantity-qa.cjs`.
Screenshots are in the worktree's `output/playwright/` (not a public artifact).
Local test logs: `/private/tmp/proof-v1-{api,ui,domain,release,browser,webkit,firefox}-tests.log`.

## Remaining release blockers

1. **Customer revised-art delivery is incomplete in current main.** The public
   prepare/finalize/status routes scan and publish an upload to `ready_for_lift`.
   They do not call Lift's `REVISED_ART_WILL_BE_SENT` action. That action is wired
   only in `operator-action-service.ts`; `revision-upload-dialog.tsx` ends at
   “Revised artwork is ready.” Do not treat that as submission to Lift. Complete
   a customer-scoped handoff with current-art/feedback/asset-owner validation,
   verified delivery readiness, durable no-retry receipt, attachment/version
   exclusion shared with quantity approval, and authoritative reconciliation.
   Do not expose the operator QA route to customers.
2. **Live disposable-order QA.** Awaiting the user's current LTL Demo order.
   Verify an Advanced-authorized grant, two creatives with an unequal quantity
   split, exact resulting Lift quantities/status, duplicate click, reopen/reload,
   and cancellation exclusion. Then exercise a normal customer-capability grant
   (not merely the special demo bypass), one single approval, change request and
   the completed revised-art handoff. These tests mutate Lift; do not choose an
   arbitrary customer order or reuse cancelled historical test orders.
3. **Activation and deployment review.** Confirm launch customer/cohort and
   Advanced policy, inspect live configuration drift and a scoped change set,
   build identified artifacts, record rollback and run authenticated post-deploy
   smoke. Customer access remains off today. No production changes were made.

## Deployment evidence and plan (not executed)

Read-only live baseline:

- Stack `vornan-proof-dev`; public Lambda `vornan-proof-public-dev`.
- Live public revision `6803b36e-69fa-4f5a-b007-86f858158a2f`, timeout 15 seconds.
- Live environment size 1,284 bytes; new gate absent; normal customer scope
  `false|false|false`. Recheck immediately before release.
- LTL Demo persistent QA is enabled separately. Actual upload runtime is enabled
  although the previously inspected stack parameter `ProofAssetUploadEnabled`
  was false. Preserve effective settings; do not blindly reapply defaults.
- Frontend bucket `vornan-pathfinder-proof-dev`, distribution `E381PLTIBZ9880`.
- Prior backend key `proof/dev/vornan-proof-lambdas-61b6ae1.zip`;
  previous live code hash `Rv5tguDfJ2zoAGPvLuLjfb+ePOcIzvmLiTAUzz+XRys=`.
- Prior index version `RcX49LmmhntkyxGj2T4MmPtQpmGfzDBB`, assets
  `index-B-4H8-OB.js` and `index-D8jT9g0h.css`. Reverify, not a promise of currentness.

Candidate public Lambda timeout is 60 seconds to accommodate authoritative reads
before one bounded action. Edge/client timeouts may occur earlier; receipts and
version claims remain the recovery boundary. No new tables or IAM expansion.
The new route has a 16 KiB JSON limit for up to 20 bindings plus a note; other
public routes retain 4 KiB. Review new CloudFormation gate/rule/timeout changes.

Candidate build fingerprints (rebuild/recheck if source changes):

- `apps/proof/dist/index.html` SHA-256:
  `f8d28314cefc92cad14370428d055d08da92df9e3d84043811fe754f284d74a6`
- `outputs/proof-lambdas/public-lambda.mjs` SHA-256:
  `aba2905c52714d2677a96fa77bd532bb134ffa2c04aa8c7f78202777a49bffde`

Deploy only reviewed Proof resources, with revision/concurrency preconditions.
Upload hashed frontend assets first, index last; retain previous hashed assets.
Do not use deletion sync. Do not deploy Pathfinder/Status as part of this change.

Rollback: turn the new gate off before rolling back public code/UI, preserving
all batch, claim and audit records. Old code does not enforce the new claims:
**pause customer decisions while unresolved batches exist** before any old-code
rollback. Resolve existing submitted actions by authoritative reads; never clear
claims or replay uncertain actions. Lift approvals/line splits are not undone by
rolling back application code.

## Dependency audit triage

The workspace npm audit has pre-existing advisories; no broad dependency update
was included. Proof's browser resolves its nested `pdfjs-dist` **4.10.38**, outside
the 5.6.83–6.2.107 range in
[GHSA-hq66-cqwq-w95j](https://github.com/advisories/GHSA-hq66-cqwq-w95j).
The root workspace's PDF.js advisory is not evidence that Proof uses that version.
`proxy-addr` 2.0.7 is present transitively in Express; the
[trust-subnet advisory](https://github.com/advisories/GHSA-jqcg-44mw-7w3h)
requires a particular proxy-trust configuration. Proof's public app does not set
`trust proxy` or use client IP as authorization. Track compatible dependency
patches separately across the shared workspace; this is scoped triage, not a
blanket security certification.

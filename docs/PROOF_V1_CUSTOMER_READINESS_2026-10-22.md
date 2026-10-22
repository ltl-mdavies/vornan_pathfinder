# Proof v1 customer-readiness candidate — 2026-10-22

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

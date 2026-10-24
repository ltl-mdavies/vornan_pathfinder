# Pathfinder Admin UX secondary acceptance

October 24, 2026. **Deployment remains on hold.** The second pass found no new runtime regression in the exercised scenarios, but it does not establish complete coverage of every workflow. Manual Import submission recovery requires a focused follow-up, and authenticated production checks and native 200% zoom remain unverified.

Follow-up: the [Manual Import recovery record](2026-10-24-manual-import-recovery.md) reproduces this gap in the real UI and records the narrow fix. This document remains the historical acceptance result for `9d27f5d`; independent acceptance of the replacement candidate is pending.

The reviewed implementation is `9d27f5d` on `codex/pathfinder-ux-shell`, at documentation checkpoint `017aac9`. No runtime source, production records, provider settings, feature flags or deployments changed during this pass. Pathfinder Development retains release ownership; Pathfinder UX retains the source freeze.

## Results

Browser checks used the actual Admin application in the isolated local harness at port 5210, with synthetic records and simulated provider responses. Screenshots were captured at 1366 × 768 unless stated otherwise. Passing a simulation verifies the UI response, not the corresponding live provider or authorization behavior.

| Step | Result | Observed behavior |
| --- | --- | --- |
| 1. Dashboard | Pass in isolated browser | Compact shared shell and meaningful data groups. Unknown system health remains explicitly unknown rather than appearing healthy. |
| 2. Jobs navigation | Pass in isolated browser | Silicon Pasture plus JSON API filters and page 2 survived opening a job drawer, full details and returning to Jobs. Results remained 12–22 of 31. |
| 3. Unsaved import-method edits | Pass in isolated browser | Both global navigation and customer switching presented the leave guard. Escape preserved the draft; keyboard focus cycled within the dialog. Discard then switch retained Import Methods and removed the prior customer's draft. |
| 4. Customer Proof boundary | Pass with synthetic cross-customer record | Silicon Pasture's Proof tools refused a Momentara order, disabled Sync Proofs and exposed no order details or access grant. |
| 5. Proof failure and recovery | Pass with simulated read failure | Unavailable counts displayed dashes, not zero. Retry loaded the queue and returned focus to Search proof queue. |
| 6. Proof pagination and grouping | Pass in isolated browser | After loading more, customer grouping traversed all 9 pages: 54 rows and 54 unique order-line actions, with no duplicate or omitted loaded records. Cache coverage remained disclosed. |
| 7. Denied method save | Pass with simulated denial | Failed REST-method save kept the edited name and unsaved state. Navigation still required an explicit draft decision. This is not verification of real account roles. |
| 8. Submission response loss | Pass with simulated reservation and network loss | Job details showed Response unknown, warned that the order may already exist and replaced Submit with Refresh job. Refresh exposed Confirmation Needed and one uncertain attempt. Simulated reconciliation produced confirmed Lift order A9000999 without another submit. |
| 9. Archive safety | Pass for confirmation and cancellation | Dialog identified JOB-000000 and explained preservation of Lift/history/status links. Cancel preserved the job. Changing search removed hidden selection actions. No archive request was executed. |
| 10. Automated regression suite | Pass | 1,366 tests passed, zero failed: API 800, public Proof 76, Order Status 17, Admin 233, packages 240. Some frontend tests are source/contract assertions rather than browser interactions. |

## Findings requiring follow-up

### Manual Import submission recovery is not fully covered

The Manual Import Submit to Lift button in `apps/web/src/App.tsx` at lines 16139–16157 still uses the earlier disable conditions: persisted preview, saving state, fingerprint, external-submit gate and sandbox confirmation. It does not use the new response-unknown state. The job-scoped warning is rendered in job details, not in the Manual Import panel. The shared submission handler resets feedback when invoked and sends the request.

The button conditions are identical in baseline `819454b0` at lines 16023–16040, so this is **an existing UX gap, not a newly demonstrated regression**. Source inspection supports the possibility of a repeat submit control remaining available after response loss; the full Manual Import path was not reproduced in this browser pass. Server reservation and idempotency behavior remain separate protections; no duplicate Lift order was observed or created.

Before declaring submission recovery complete, extend the isolated harness through persisted Manual Import preview → response loss → refresh/reconciliation. Verify that the user gets the same warning and recovery action as job details, that repeated activation cannot create another request while uncertain, and that explicit rejection and confirmed success still behave correctly. Make any necessary UI change narrowly, then rerun affected tests and rebuild the candidate manifest. Do not exercise this by submitting a live customer order.

### Authenticated production and native zoom checks remain blocked

Chrome's automation connection failed, and native screen capture failed even after Marcus confirmed the Mac was unlocked. No authenticated production-session acceptance is claimed. The release preparation's read-only production checklist still applies, including public Proof custom controls, Order Status and intake/reconciliation health.

Native 200% browser zoom was not available. A 683 × 384 viewport experiment produced an indeterminate scaled capture; it is not accepted as equivalent zoom or reflow evidence. Screen-reader speech and all real role/capability combinations also remain unverified. The recorded dialog keyboard check is narrower than an accessibility certification.

### Other limits

Successful live configuration writes, archive/restore persistence, live transport/reconciliation and customer email/Wrike writes were intentionally not exercised. Existing automated tests and prior acceptance records provide additional coverage, but do not turn these into live end-to-end passes. This pass also does not establish every race timing or every historical snapshot combination.

## Evidence

Screenshots are local review artifacts under `output/playwright/secondary-oct24`, not production assets. Relative links below resolve within this worktree. Preserve these artifacts with the release record before removing the temporary worktree.

| Step | Capture |
| --- | --- |
| Dashboard | [01 Dashboard](../../output/playwright/secondary-oct24/01-dashboard.jpg) |
| Jobs return | [02 Retained filters and pagination](../../output/playwright/secondary-oct24/02-jobs-return.jpg) |
| Draft protection | [03 Unsaved changes guard](../../output/playwright/secondary-oct24/03-unsaved-guard.jpg) |
| Customer boundary | [04 Cross-customer Proof refusal](../../output/playwright/secondary-oct24/04-proof-customer-boundary.jpg) |
| Failure state | [05 Proof unavailable](../../output/playwright/secondary-oct24/05-proof-unavailable.jpg) |
| Pagination | [06 Final Proof page](../../output/playwright/secondary-oct24/06-proof-final-page.jpg) |
| Save rejection | [08 Denied save preserves draft](../../output/playwright/secondary-oct24/08-denied-save.jpg) |
| Submission uncertainty | [09 Response unknown](../../output/playwright/secondary-oct24/09-response-unknown.jpg) |
| Reconciliation | [10 Confirmed recovery detail](../../output/playwright/secondary-oct24/10-confirmed-recovery.jpg) |
| Archive confirmation | [11 Exact-target confirmation](../../output/playwright/secondary-oct24/11-archive-confirmation.jpg) |

Capture 07 is retained only as the rejected narrow-viewport experiment. Capture 10 shows the recovery detail at the retained scroll position, not the complete header.

Full test output: `/private/tmp/pathfinder-secondary-regression-tests.log`. The suite exited 0. No candidate differences from baseline were present in `apps/api`, `apps/proof`, `apps/status`, `packages`, deployment workflows or the Admin deployment script. `git diff --check` passed. Frozen source hashes remained:

```text
d5ee2edc409814ae2ffd00d03fdc399102f0450fbf9ebb6bbd5f851bab309899  apps/web/src/App.tsx
f0cb203a0cea1faab5e2a6b989bfbf842ba4c1ce22d371db54074d220a0ed09e  tests/ux/submission-fixtures.ts
e98f927db52648884283f33c166fc4a952a261cba3336c1ee53bc45dd76db94b  tests/ux/src.tsx
```

## Release decision

Keep the deployment hold until the Manual Import recovery gap has a recorded disposition and the authenticated baseline and native zoom checks are completed or explicitly accepted as remaining risks. This is a verification hold, not a finding that the reviewed update damaged production. Continue using the [release preparation and rollback plan](2026-10-24-admin-ux-preparation.md); refresh main, live versions and artifact hashes immediately before any authorized release.

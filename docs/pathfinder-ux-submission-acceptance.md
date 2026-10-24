# Pathfinder submission recovery acceptance

This local Admin review covers certified submission, duplicate protection, uncertain outcomes and reconciliation presentation. It extends checkpoint `057f03f` without changing the production submit API, reconciliation worker, credentials or provider configuration.

## Corrections

1. Missing Lift confirmation now displays **Not confirmed**, not **Not in Lift**. The absence of an association does not prove that Lift failed to create an order. The customer job list also distinguishes awaiting confirmation from an unlinked order.
2. Job-detail submission refusals now display focused, job-scoped feedback. A changed reviewed payload previously failed silently in this view. A lost browser response explains that the order may exist and asks the operator to refresh the job before further action, rather than create a replacement.
3. A late submission response cannot replace the currently opened job's details or attempts, or insert its job into another customer's selected workspace. Shared feedback, preview and last-attempt updates are also guarded after independent browser review reproduced a prior customer's result appearing in LTL Demo Manual Import. Global job updates still receive the result.

The existing fingerprint, certification, submit reservation and replay rules remain authoritative on the server. No new submit permission or automatic retry has been added.

Independent review identified two additional presentation contradictions: a lost response still offered Submit, and a known certification refusal still displayed Ready to Submit. The candidate now replaces that action with a read-only **Refresh job** and a **Response unknown** or **Review required** indicator. Known certification blockers are visible alongside guidance to resolve them and refresh certification. These are presentation states; no persisted attempt or job outcome is invented.

## Evidence and boundaries

Current-run browser evidence is in `/private/tmp/pathfinder-submission-evidence/`:

- `baseline.png`: the prior unconfirmed detail incorrectly said Not in Lift.
- `hidden-rejection-before.png`: a simulated review mismatch showed no error.
- `visible-rejection-after.png`: the same refusal displays a focused alert beside the controls.
- `uncertain.png`: the simulated submit transitions to Confirmation Needed; another submit is not offered.
- `reconciled.png`: the confirmed Lift number and recovery message replace uncertainty while retaining one historical attempt.
- `network-recovery.png`: a lost response displays Response unknown and a safe Refresh job action instead of another submit. The subsequent read reveals the retained uncertain attempt.

The browser harness renders the actual Admin App. Its submission adapter is test-only and rejects unsupported writes. Mock responses and a local QA reconciliation control are not evidence that a live provider accepted an order. Nine additional Admin tests cover replay, reload, immutable attempt history, refusal, lost responses, customer isolation and feedback/action guards; the original API tests cover real integrity/reservation/reconciliation implementation against isolated storage and transports.

## Release baseline

On October 24, 2026, `git fetch origin main` resolved to `819454b0dcf563e0f28ca29db2d238ab4d95f73d`. This baseline is an ancestor of `057f03f`, with zero main-only commits and 18 local candidate commits before this slice. No merge was necessary.

The candidate has no file differences from that baseline in `apps/api`, `apps/proof`, `apps/status` or `packages`. This verifies source preservation against refreshed main, not the identity of currently deployed artifacts or undeployed work in other branches. Recheck the baseline immediately before release and coordinate any subsequent changes through Pathfinder Development.

## Release gates

- Local acceptance is complete. Independent Pathfinder UX accepted the uncertain/reconciled paths, changed-payload refusal, blocked certification and lost-response recovery. Its final delayed-response retest inspected LTL Demo Manual Import 21.4 seconds after a Momentara submit began: no prior-customer message or attempt appeared. The second job's detail also remained intact. Report: http://127.0.0.1:5206/submission-review/.
- Fresh-baseline integration, exact deployed-artifact identity, role/provider coverage and production release preparation remain separate gates. The main-baseline check above must be repeated if main advances.
- Follow `/Users/marcusdavies/Projects/ltl-workspace/docs/DEPLOYMENT_REQUIREMENTS.md` for exact artifacts, resources, rollback and release authorization. The Admin deployment script defaults the operations workspace and intake/pilot flags off; the reviewed build configuration must preserve the intended flags and existing customer restrictions. A successful local review does not authorize deployment.
- No push, deployment, live order submission, Wrike comment, email or credential change is part of this slice.

## Validation

Final local regression suite: **1,366 passed** — API 800, public Proof 76, Order Status 17, Admin 233, domain/adapter packages 240. Full workspace typecheck, strict standalone submission-fixture typecheck, and Admin production build passed. The existing large-bundle warning remains. Generated production JavaScript contains none of the submission simulator markers.

The first run caught an existing source assertion expecting the old Not in Lift wording. Its expected value was updated to Not confirmed; the final complete suite passed. API tests used isolated data/transports with temporary local socket access; no provider submission was made.

Frozen implementation SHA-256:

- `apps/web/src/App.tsx`: `d5ee2edc409814ae2ffd00d03fdc399102f0450fbf9ebb6bbd5f851bab309899`
- `tests/ux/submission-fixtures.ts`: `f0cb203a0cea1faab5e2a6b989bfbf842ba4c1ce22d371db54074d220a0ed09e`
- `tests/ux/src.tsx`: `e98f927db52648884283f33c166fc4a952a261cba3336c1ee53bc45dd76db94b`

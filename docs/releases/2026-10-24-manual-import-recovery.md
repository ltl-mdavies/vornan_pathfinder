# Manual Import submission recovery

October 24, 2026. The existing Manual Import recovery gap has been reproduced, fixed locally and independently accepted by Pathfinder UX. **Deployment remains on hold pending authenticated production checks, native zoom verification and a refreshed production release artifact.** No provider request, production mutation, push, merge or deployment was performed.

Frozen implementation checkpoint: `d67dc12` on `codex/pathfinder-ux-shell` in `/private/tmp/pathfinder-ux-shell`.

## Reproduction and change

The actual Manual Import page, using sample mappings and a simulated persisted preview, allowed a second Submit to Lift request after losing the first response. The visible simulator counter increased from 1 to 2. The simulator reused its reservation; this was an unnecessary repeat request, not evidence of a duplicated Lift order. [Before-fix capture](../../output/playwright/secondary-oct24/12-manual-before-fix.jpg).

The narrow Admin change adds:

- A synchronous, customer-and-job-scoped handler guard against rapid repeated activation and unknown responses. This complements unchanged backend certification, fingerprints, reservations and idempotency.
- State/attempt-aware Manual Import eligibility: uncertain, submitted and confirmed orders cannot become submittable merely because certification remains positive.
- An explicit **Refresh job** action that reads the authoritative job and attempts. Failed reads retain the lock and offer retry. Empty Ready snapshots, unrelated attempts and older Blocked/Gate Locked history do not resolve a lost response.
- Scoped feedback, confirmation labels and preserved historical timeout evidence. Certification refresh does not resolve uncertainty.
- Preview/workspace request epochs so delayed preview creation, certification, refresh or submission results cannot overwrite a replacement preview or another customer's current context.

Runtime scope is `apps/web/src/App.tsx` and new `apps/web/src/submission-recovery.ts`. No API, public Proof, Order Status, shared package, deployment workflow or provider configuration changes are included.

## Validation

| Check | Result |
| --- | --- |
| Focused behavior and fixture tests | 17 passed, including five executable guard tests and three new fixture recovery/identity tests. Existing source-contract assertions remain identified as such. |
| Full regression run | 1,374 passed, zero failed: API 800, public Proof 76, Status 17, Admin 241, packages 240. |
| Workspace typecheck | Passed. |
| Strict submission-fixture typecheck | Passed. |
| Final Admin test/typecheck/build | Passed; existing large-chunk warning remains. Build is validation-only, not the production-configured release artifact. |
| Lost-response browser flow | One submit request through failure, failed GET, retry, pending and confirmed reconciliation; Submit disabled throughout recovery. |
| Explicit rejection browser flow | 422 displayed; submit disabled by returned certification. No unknown-order warning. Fresh authoritative review restored eligibility in this simulated scenario. |
| Immediate-success browser flow | Confirmed order displayed; submit disabled despite positive certification. |
| Delayed same-customer response | Second preview remained Ready with distinct ID, no old response feedback or attempt attached. |
| Delayed job GET during direct regeneration | The replacement preview remained Ready with Submit and Refresh enabled after the old read completed; no inherited loading state or old feedback. |
| Customer switch during pending response | UX independently passed final d67dc12 after rapid double-click: LTL Demo retained no prior timeout/attempt and submitRequests remained 1. |
| Native zoom and production session | Still unverified; no change to the earlier browser-access limitation. |

[Final confirmation capture](../../output/playwright/secondary-oct24/16-manual-final-confirmation.jpg) shows the frozen candidate with one submit request, two job reads, confirmed order A9000999, disabled Submit and preserved historical timeout. [Failed-refresh lock capture](../../output/playwright/secondary-oct24/15-manual-failed-refresh-fixed.jpg) and [late-preview capture](../../output/playwright/secondary-oct24/14-manual-late-preview.jpg) record earlier iterations of the same behaviors. Captures 13–15 preceded the final copy/request-epoch refinement. Independent final screenshots should be retained with UX's acceptance result.

The full suite, Admin tests, Admin typecheck and build all passed on the final frozen source. The whole-workspace check also passed before the last Admin-only request-epoch refinement; final Admin typing was rerun afterward. Logs are `/private/tmp/pathfinder-manual-regression-tests.log`, `/private/tmp/pathfinder-manual-web-tests.log`, `/private/tmp/pathfinder-manual-typecheck.log`, `/private/tmp/pathfinder-manual-web-check.log`, and `/private/tmp/pathfinder-manual-web-build.log`. A broader ad-hoc strict compile of the whole harness entry initially reported existing Vite declaration/dynamic JSON-index typing issues; the supported workspace check and standalone submission-fixture strict check passed. This does not claim a newly clean standalone harness-entry typecheck.

## Independent review setup

Use a fresh review case at:

`http://127.0.0.1:5210/?submissionReview=network&manualImport&reviewCase=independent-manual-1`

Customers → Empirical – Momentara → Manual Import → Use Sample → Product key SKU → Order identity Order Number → Generate Preview Job in the upload panel. Wait for automatic certification, then Submit to Lift. The fixed QA panel exposes request counters and explicit local controls. Fail next job read → Refresh job → retry → Simulate reconciliation → Refresh job must leave submitRequests at 1.

Use `submissionReview=rejected` and `success` for the other outcomes. `submissionReview=ready&submissionSlow` delays the response eight seconds. Use Sample and generate another preview or switch customers before completion. `manualReadSlow` and `previewSlow` cover navigation during GET/preview creation. Detailed fixture boundaries are in [the harness README](../../tests/ux/README.md).

## Frozen source fingerprints

```text
3cc0b74a4cd500219748e4c1ec23769c19199bf98e19bfed4815cb28c80e8a2a  apps/web/src/App.tsx
3b0edef44108def0b29488178841e4ad76b65fbc146917c631d33e426e46b47e  apps/web/src/submission-recovery.ts
5c3f34eaed2ad3cd16ac4078f487ce0a02d220c3053131ef760393a13a66de1c  tests/ux/submission-fixtures.ts
4b31eac8368bef5f7f50c430a50494b8af7f0f72df8061b348a04758a05cb167  tests/ux/src.tsx
```

## Release disposition

Pathfinder UX independently accepted `d67dc12` for this focused local recovery scope. Its final core flow included lost response → failed GET → pending GET → simulated reconciliation → confirmed A9000999 with the original uncertain attempt, with counters 1 submit / 1 preview / 3 reads. The slow-read/direct-regeneration race passed with a distinct Ready preview, enabled refresh/submit, no old feedback and counters 1 submit / 2 previews / 2 reads. Its rejection, immediate-success and delayed-submit replacement checks passed on the preceding `e3350c8f` App fingerprint; only refresh-epoch handling changed afterward. UX reported no further implementation change needed.

The independent evidence report is complete at [Manual Import recovery review](http://127.0.0.1:5206/manual-import-recovery-review/). Its local source is `/Users/marcusdavies/.codex/visualizations/2026/10/23/01a16a35-2fc7-7a62-8945-f6c7f25a1638/manual-import-recovery-review/index.html`, with companion checks, findings, fingerprints and screenshots. UX confirmed the final slow-GET/direct-regeneration and customer-switch checks both passed on `d67dc12`, and updated its acceptance ledger. No further user decision is needed for this corrected local behavior; this acceptance does not authorize deployment or close the authenticated-production/native-zoom limitations.

The earlier production candidate manifest is marked `invalidated_do_not_deploy`; its source and artifact hashes no longer describe this candidate. Rebuild using the preserved production configuration and regenerate the manifest only after acceptance. Revalidate the rollback versions and live baseline then. Pathfinder Development remains the sole release coordinator, and Pathfinder UX owns independent browser acceptance of this frozen candidate.

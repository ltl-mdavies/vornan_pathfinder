# Pathfinder Catalog layout checkpoint

October 23, 2026. Local design candidate following accepted shell and Proof commits `facfa49` and `54cfb0e`. This checkpoint covers the customer Catalog list and selected-product panel. It is not complete Catalog workflow acceptance or release approval.

## Scope and ownership

Development owns repository changes and releases; Pathfinder UX owns design direction and independent review. The detailed Catalog was not part of the approved navigation prototype. UX supplied `CATALOG-LAYOUT-BRIEF.md` in its October 23 handoff directory and requested a focused list/detail candidate before further inner-workflow changes.

The existing internal pilot requires authentication, the Catalog pilot feature flag, and exact customer `1249`. Those checks remain unchanged. The compact candidate is enabled only under the existing operations workspace shell. No API, public Proof, Order Status, intake, reconciliation, provider, deployment configuration, dependency, or database changes are included.

## Existing capability inventory

| Control or surface | Actual current behavior | Preserve or clarify |
| --- | --- | --- |
| Catalog records | Five bundled sample products, not a provider query | Explicit sample context; no invented loading or provider error states |
| Search and Filters | Product/SKU/category search; lifecycle, inspection, approval filters in component memory | Preserve combinations, chips, clear behavior and full names |
| List and Cards | Alternate views of the same filtered sample records | Preserve selection and filter state between views |
| Product detail | Current version, specification, inspection, approval, sample order history | Keep inspection separate from approval |
| New product | No-op fixture callback | Unavailable in compact pilot, not a working creation promise |
| Open or Download source artwork | No-op fixture callbacks, including historical versions | Unavailable in compact pilot; local analysis preview/report are separate real capabilities |
| Version history | Select immutable sample versions and view bundled preview | No restore/delete/overwrite; sample previews do not establish different historical file bytes |
| Lifecycle | Confirmed in-memory override only | No server write or actual ordering eligibility change |
| Product configuration | Validated positive dimensions/DPI and color; in-memory override | Prototype-only action; manufacturing model remains unconnected |
| Full order history | No-op fixture callback | Unavailable in compact pilot; displayed history remains sample evidence |
| Check new artwork | Real browser-local PDF/PNG/JPEG analysis, review and progress/error states | No upload, storage, activation or current artwork replacement |
| Sample inspection | Exact product/current-version/inspection identity resolves bundled reference | Compact sample summary now agrees with the linked non-passing run; approval remains Approved |
| Local inspection | Byte-derived file identity and supported metrics; blob preview, JSON report | Do not fabricate heatmap/comparison when unsupported |
| Download report | Real for local analysis; no-op for bundled sample report | Sample-report action needs clarification in the later inspection pass |
| Customer navigation | Existing pilot availability only | Never enable Catalog for another customer as part of UX work |

Source: `ArtworkCatalogInternalPilot.tsx`, `ArtworkCatalogWorkspace.tsx`, `ArtworkInspectionResultsWorkspace.tsx`, `fixtures.ts`, and existing tests under `apps/web`.

## Captured baseline

Screenshots are local, synthetic-data evidence in `tests/ux/evidence/`; no live customer data or provider actions were used.

1. `catalog-audit-01-entry.png`, 1366 × 768 — shared shell is intact, but the automatically opened detail panel squeezes the table and clips columns. Repeated customer/title and summary cards consume working space.
2. `catalog-audit-02-list.png`, 1366 × 768 — closed detail exposes the columns; the list begins around 442px, leaving five sample rows almost flush with the viewport bottom.
3. `catalog-audit-03-cards.png`, 1366 × 768 — working view toggle, but large upper blocks leave card details below the fold.
4. `catalog-audit-04-history.png`, 1366 × 768 — current/version identities are explicit. Open/Download appeared actionable despite no-op callbacks.
5. `catalog-audit-05-specification.png`, 1366 × 768 — focused form and explicit prototype-only footer; behavior beyond layout needs the follow-through below.
6. `catalog-audit-06-local-check.png`, 1366 × 768 — correct local-only/no-replacement language, distinct from production upload.
7. `catalog-audit-07-inspection.png`, 1366 × 768 — specialized canvas and findings rail should be retained. The sample report contradicts the original current-version Passed summary. Returning remounts the Catalog and resets its browsing context.

The initial wide baseline capture was taken during resize settling and is not accepted as layout evidence. Candidate wide captures are measured against the actual DOM viewport.

## Focused candidate

- List-first entry; compact sample notice, one toolbar, simple count footer. Remove duplicate display heading and summary cards, including the unsupported readiness-by-subtraction claim.
- Keep all meaningful columns and independent inspection/approval states. Working text is 14px, metadata 12px, matching the accepted shell. Full product names wrap.
- Detail is 420px below customer tabs. Below 1700px it overlays an inert list; at wider widths it docks beside the list. Shell navigation remains available: this is a non-modal inspector, not a full-page modal.
- Selection focuses Close; Escape/Close restores the product opener. Nested dialogs wrap Tab in the compact candidate and make the detail panel inert while open.
- The initial detail view presents a labeled inspection/Proof approval pair before artwork. Its footer explicitly says the check is local and does not save or replace artwork.
- Fixture-only actions are disabled with explanation. Real browser-local analysis remains available.
- Filtered Cards retain grid tracks and a bounded preview instead of stretching a single result into a full-width image.
- Original standalone pilot composition remains unchanged when compact mode is off.

Evidence: `catalog-candidate-list-1366.png`, `catalog-candidate-detail-final-1366.png`, `catalog-candidate-detail-final-1920.png`. Earlier candidate detail captures retain the pre-review composition for comparison.

Measured: 1366 × 768 detail x922/y156/420×588; 1920 × 1080 detail x1472/y156/420×900 and table width1246. Document scroll width equals viewport width at both. The five existing sample records are not sufficient to certify eight-row density or long-name stress behavior; expanded synthetic review data remains a follow-up.

## Required before full Catalog acceptance

1. Pass the effective edited specification to local analysis. Currently the displayed override is not the product passed to the analyzer.
2. Preserve query, filters, list/card selection and applied local changes across the inspection round-trip, with meaningful return focus.
3. Complete sample-report clarity, modal keyboard coverage and inspection-canvas review. Compact summary/report mismatch is corrected; sample report download remains a no-op requiring accurate presentation.
4. Verify real local-file selection/review/processing/result/error and report download without uploading or replacing catalog artwork.
5. Add dense/long-name fixtures and review 1366, 1600 and1920 widths, narrow reflow, empty filtered results, customer-switch availability, and keyboard navigation.
6. Review Cards, history/configuration and inspection as their own continuation; do not call this candidate an end-to-end Catalog release.

## Verification and release gate

Initial focused baseline: 37 tests passed. Candidate Admin suite: 186 tests passed, including compact-entry, independent-status visibility and sample-run consistency tests. Full workspace typecheck and Admin build passed. Build retains the existing large-chunk warning. `git diff --check` passed. No browser console errors in the inspected candidate session.

Browser checks: search/empty results; non-modal detail with covered list inert; exact Escape return focus; history Shift+Tab/Tab wrapping and Escape return to Version history. UX independently requested the first-visible status pair and present-tense footer, then bounded filtered Cards. All corrections were implemented and re-captured.

Independent UX disposition: composition checkpoint passed for list/detail/cards/customer gate and checked history keyboard behavior. UX verified 1366 and1920, filtered-card recovery, switching to Empirical clears/hides LTL Catalog and switching back restores eligible content. Review evidence is `/private/tmp/pathfinder-ux-catalog-review/` (notably08 detail revised1366,09 wide1920,11 filtered card revised). This does not waive the full-workflow requirements above or certify screen-reader/zoom behavior. Root `design-qa.md` records comparison iterations.

Completed independent report: http://127.0.0.1:5206/catalog-review/index.html . Durable report and source fingerprints: `/Users/marcusdavies/.codex/visualizations/2026/10/23/01a16a35-2fc7-7a62-8945-f6c7f25a1638/catalog-review/`. The final review also includes populated Cards and a1600×900 overlay check; the latter is complete, not a remaining viewport requirement.

No push or deployment. Reconcile with fresh main, preserve intervening hotfixes, run the full regression suite and obtain explicit release approval after all agreed UX slices are complete.

## Workflow continuation — October 23 local candidate

This section supersedes the original technical blockers for the changed paths only; it is not a production Catalog release.

- Catalog stays mounted while inspection is displayed, with its hidden subtree inert and its keyboard listeners inactive. Search, filters, card/list mode, selected product, applied specifications and lifecycle overrides remain component-local and survive the round trip.
- Opening results focuses Back; closing restores the exact View results or Check new artwork origin. No hidden upload modal is left open after a successful local check.
- Analysis receives a copy of the selected product containing the applied specification snapshot. The review step displays those dimensions, DPI and color before analysis. Neither current artwork nor approval is modified.
- The real file input remains mounted during selection and review so Choose a different file works. Late local completion after component unmount is ignored and its preview blob URLs are released.
- Sample results explicitly say illustrative findings and disable the unconnected report download. Historical-version copy now states that previews are illustrative and source files are not connected. Local JSON report download remains real.

Development browser evidence: Pump search + Needs work filter + Cards survived a sample-results round trip, with View results focused on return. An applied 12 × 8 inch / 300 DPI configuration drove analysis of the bundled 192px PNG; the resulting JSON report contains those exact values and Proposed Version 8. Return focused Check new artwork; current Version 7 and Approved remained unchanged. A separately confirmed local Inactive override also survived the sample-results round trip. History Tab/Shift+Tab and Escape restoration passed.

Evidence: `catalog-workflow-sample-report-1366.png`, `catalog-workflow-file-review-1366.png`, `catalog-workflow-local-result-1366.png` under `tests/ux/evidence`. Local downloaded report: `upload_item_d2226f33-631e-4d11-968c-aace1a816c65.json` (user Downloads; synthetic bundled image only).

Initial engineering gate: 189 Admin tests, full-workspace typecheck, Admin build and diff whitespace check passed. The full regression run passed all non-API suites; the sandbox blocked temporary test-server sockets in 81 API cases. Re-running the unchanged API suite with local socket permission passed all 800 tests. Combined result: 1,322 tests passed (API800, public Proof76, Status17, Admin189, domain/adapters240). Independent UX workflow review is in progress; final disposition and narrow follow-up corrections will be recorded below. Dense/long-name data and broader inspection-canvas layout remain a separate acceptance requirement.

Final narrow corrections: native-hidden file input remains mounted but is disabled during processing, so it cannot become an invisible focus stop. Browser selection and replacement from `pathfinder-icon-192.png` to `pathfinder-icon-128.png` succeeded after that correction (`catalog-workflow-file-replacement-final-1366.png`). Compact configuration replaces the large future-manufacturing block with a read-only print-product line; legacy standalone mode retains its original composition. Before/after configuration screenshots were compared together at1366×768 and show the form/primary actions without the roadmap filler. Final Admin tests/typecheck/build passed again.

Independent UX completion is pending a tool approval in the UX chat. The reviewed source remains frozen for that continuation; no independent acceptance or deployment is claimed. Root `design-qa.md` separates Development's bounded verification from the still-open full Catalog gate.

## Inspection fit and recovery continuation — October 23

Development continued with fresh browser evidence while UX remained waiting on its tool approval. This section supersedes the PDF/JPEG and density coverage gaps above, not the independent acceptance gate.

- Fixed embedded inspection height: the standalone 100dvh layout previously extended beyond the customer shell, hiding summary/actions below the laptop viewport. A compact-only wrapper now budgets the available height, retains the existing artwork/controls, increases rail evidence text to 12px, and stacks with ordinary page scrolling below 1100px. Standalone composition and public Proof remain unchanged.
- Oversized files previously looked Ready before returning an unhelpful generic failure. Selection now rejects files over 250 MB (and zero-byte files) with a specific corrective action, without reading them or altering current artwork. Exact-limit and empty-file cases have unit coverage.
- Browser-verified actual bundled PDF rendering, processing-modal focus, JPEG preview, oversized selection and recovery to a valid JPEG, and return to unchanged Version 7 / Approved. No customer files, uploads, provider requests or persisted changes.
- Added test-only 40-row density fixtures. Long and unbroken names wrap fully in List and Cards. At1366×768, six complete mixed-length rows fit initially with a seventh partially visible; full-name legibility is intentionally favored over claiming a fixed eight-row density. The table's measured width and scrollWidth were both1140px. At1024, inspection stacks without horizontal overflow (800px content width/scrollWidth).

Evidence in `tests/ux/evidence`: `catalog-inspection-laptop-before.png` and `catalog-inspection-laptop-after.png` were compared together at identical1366×768 state; `catalog-inspection-pdf-local.png`, `catalog-file-size-error-before.png`, `catalog-file-size-error-after.png`, `catalog-jpeg-recovery.png`, `catalog-dense-list-1366.png`, `catalog-long-names-1366.png`, `catalog-long-names-cards-1366.png`, and `catalog-inspection-1024.png`.

Current engineering checks:191 Admin tests, workspace typecheck, Admin build and diff check passed. Existing build chunk-size warning only. The earlier1322-test cross-app baseline remains recorded above; the full API suite was not repeated for this narrowly scoped continuation. No API, intake, public Proof/Status, worker, dependency or deployment configuration changes.

Remaining: independent UX completion; deliberate long-running processing keyboard stress; malformed-file browser recovery; native zoom/screen-reader audit; fresh-main reconciliation and full release checks before deployment. No release authorization or complete Catalog production acceptance is implied.

## Independent error-path findings and isolated correction

UX identified two P2 issues during its resumed review: a corrupt file claimed green Aspect match PASS despite indeterminate dimensions, and the canvas displayed a broken image. Development reproduced both. Because UX requested a source hold while downloading its report, corrections were built separately in `/private/tmp/pathfinder-catalog-error-recovery` (`codex/catalog-error-recovery`, based on b771488), preview port5216. The original candidate at5210 remains frozen.

The correction displays neutral Indeterminate when geometry is unknown or integrity failed. Invalid parsed input is marked preview-unavailable; image decode/load failures also switch to a deliberate recovery message without a broken-image icon or spatial markers. PDF fallback and valid-artwork rendering remain supported; local checks still do not replace or approve artwork.

Browser evidence: `catalog-corrupt-file-before.png` / `catalog-corrupt-file-after.png`, same1366×768, same syntheticinvalid.pdf and specification (timestamps/run IDs differ). Compared together; false green PASS and broken preview eliminated. Valid JPEG then rendered192×192 after recovery; console errors none.192 Admin tests, Admin typecheck/build passed. Original prior full-workspace and cross-app regression evidence remains above; not a new full-suite claim.

This isolated correction requires integration into the UX shell branch after UX completes its current frozen test, plus independent retest. No push/deployment. Deliberate slow-processing keyboard stress, screen-reader/native zoom, fresh-main reconciliation and release checks remain open.

## Consolidated engineering checkpoint — October 23

Candidate source: `ebadb04da883186e5593efcc45fb883b35644ed1`, isolated branch `codex/catalog-error-recovery`. Freshly fetched `origin/main` remains `819454b0dcf563e0f28ca29db2d238ab4d95f73d`; candidate is six commits ahead and zero behind. No intervening-main changes require reconciliation at this checkpoint. Fetch again before an eventual merge/release.

- Full regression rerun: **1,325 passing, zero failures** — API800, public Proof76, Status17, Admin192, domain/adapters240. Full workspace typecheck and Admin build passed. The existing large-chunk warning remains.
- The first isolated run failed to resolve `@aws-sdk/client-s3` and `@aws-sdk/s3-presigned-post`: root dependencies were linked, but API-local dependencies were not. Linking the existing API dependency directory into this isolated worktree fixed resolution. No source, dependency manifest or lockfile change was needed. Both temporary dependency symlinks remain untracked and must not be committed.
- Logs: `/private/tmp/pathfinder-ux-release-tests-rerun.log`, `/private/tmp/pathfinder-ux-release-check-rerun.log`, `/private/tmp/pathfinder-ux-release-build.log`. The earlier failed-run logs are retained separately rather than overwritten.
- Scoped comparison contains only Admin frontend source/tests, UX harness and handoff documentation. No changes under API, public Proof, public Status, packages, infrastructure, deployment scripts, root dependency manifest or lockfile. `git diff --check` passed.
- The normal Admin build contains no matches for the test-harness markers `catalogStress`, `Local review · sample data`, `tests/ux` or `synthetic-fetch` in its JavaScript assets. This is a local build verification, not an approved production artifact or proof of production configuration parity.

Coordination: original `codex/pathfinder-ux-shell` at `b771488` / port5210 remains frozen during UX's requested file/report test. The corrected candidate is on port5216. UX has been sent the regression results and asked for independent retest plus explicit safe-to-integrate disposition. Its chat was still waiting on a tool approval at this checkpoint; no independent full-workflow acceptance is claimed.

Remaining gates are explicit: finish independent Catalog workflow review; perform deliberate slow-processing keyboard, native zoom and assistive-technology checks; integrate the correction only after the source hold is released; verify the then-current main and live build flags; prepare exact Admin-only resources/artifact hashes, rollback and authenticated smoke plan under the workspace deployment requirements; obtain release approval. Catalog remains the same restricted local-analysis pilot, not production catalog CRUD. No push, deployment, provider action or production configuration/data change occurred.

## Local integration after UX source-hold release

UX completed the held round trip on5210: an independently edited10×6inch/240DPI specification drove analysis of a192px PNG, reporting19.2 effectiveDPI. Returning from inspection restored focus to Check new artwork and retained Pump search, Needs work filter, Cards, selection, edited specification and current Version7/Approved. UX also completed the corrupt-report download; its report-file inspection and independent correction retest remain pending.

After UX explicitly released the source hold, the clean `codex/pathfinder-ux-shell` branch fast-forwarded from `b771488` to `1252387`, incorporating the already-verified `ebadb04` correction without conflict or reimplementation. The isolated5216 worktree remains unchanged for the independent retest. This closes the local integration gate only; it is not final Catalog acceptance or deployment approval.

Post-integration Admin tests192/192, Admin typecheck and diff whitespace check passed. The source is identical to the full1,325-test candidate; only this handoff record was subsequently amended.

## Independent bounded workflow acceptance

UX independently retested the frozen5216 candidate and reported no remaining P1/P2 findings in the tested changes:

- Corrupt50-byte PNG: neutral Aspect match Indeterminate, intentional Artwork preview unavailable and recovery guidance (`09-corrupt-file-corrected.jpg`,1280×720).
- Choose a different file recovered to a valid192×192 PNG preview (`10-valid-recovery.jpg`,1366×768).
- Review dialog Tab/Shift+Tab wrapped; Cancel restored Check new artwork focus.
- Illustrative sample findings and disabled sample-report download were correctly presented (`11`,1366×768).
- Downloaded corrupt JSON parsed successfully and matched the independently edited10×6inch/240DPI specification, unsupported/file-integrity findings and50-byte file identity.

This supersedes the pending independent error-path/report disposition above. UX is preparing its durable seven-step report; link and source fingerprints are pending. Original evidence is under `/private/tmp/pathfinder-ux-catalog-workflow-review/`. No further source correction was requested for this bounded review.

Coverage remains explicit: PDF/JPEG and dense layout checks have Development evidence, not independent UX browser coverage. Deliberate slow-processing keyboard/late completion, multipage behavior and broader accessibility are not certified by this review. Existing release gates and the restricted local-analysis pilot boundary remain; this is not production release approval or completion of the full Pathfinder redesign. The5216 source remains stable while UX finishes the report.

Completed independent seven-step report: http://127.0.0.1:5206/catalog-workflow-review/index.html . Durable folder: `/Users/marcusdavies/.codex/visualizations/2026/10/23/01a16a35-2fc7-7a62-8945-f6c7f25a1638/catalog-workflow-review/`, including `checks.json`, downloaded `corrupt-report.json` and `source-fingerprint.json`. The reviewed head is `12523877c3ccaa5881f66363e286a244b931938d`; all four recorded source SHA256s match the integrated candidate (InternalPilot, CatalogWorkspace, InspectionResultsWorkspace and shell CSS). Subsequent commits only amended this handoff documentation. Report completion closes the evidence-link gate, not the outstanding coverage or release gates. No tests were repeated solely for this documentation update.

## Slow processing and late completion follow-up

Following Marcus's request to proceed, Development exercised two deterministic test-only scenarios on5210;5216 stayed unchanged. `catalogSlow` delays a real synthetic PNG read by20seconds. `catalogLate` additionally remounts the actual App after1second and visibly reports temporary-preview cleanup. These browser API substitutions exist only in `tests/ux/src.tsx`, never the production entry point. Start each scenario with a fresh navigation to avoid stacking test overrides during HMR.

1. **Processing — passed, with a small clarity correction.** Tab and Shift+Tab stay on the dialog when it has no enabled controls; Escape does not dismiss processing. The original File selected heading was ambiguous during a slow read. It now says Reading artwork, in a polite atomic status live region. This is verified DOM semantics, not a claim about actual screen-reader speech. Before/after screenshots were captured and compared together at1280×720: `catalog-slow-processing.png`, `catalog-slow-processing-after.png`.
2. **Completion and return — passed.** The actual192px PNG rendered on completion, focus moved to Back to Artwork Catalog, and Close inspection restored Check new artwork. `catalog-slow-completed.png`.
3. **Late completion after unmount — passed in the explicit test remount.** The new App remained on Dashboard, no stale inspection appeared, and the visible test output recorded exactly one late preview URL released. `catalog-late-cleanup.png`. This tests the unmount guard, not every possible navigation action or a server cancellation mechanism.

Full regression after this follow-up: **1,326 passing** (API800, public Proof76, Status17, Admin193, domains/adapters240), full workspace typecheck and Admin build pass; existing large-chunk warning only. Logs: `/private/tmp/pathfinder-ux-slow-full-tests.log`, `/private/tmp/pathfinder-ux-slow-full-check.log`, `/private/tmp/pathfinder-catalog-slow-build.log`. Added a deferred-read unit test verifying no early preview or completion, plus the progress-live-region source assertion. Production code delta is only the progress label and live-region attributes; customer gates, persistence, analysis results and public apps are unchanged.

UX requested a bounded independent follow-up and has the exact URLs/steps. Source on5210 is frozen during that review; earlier acceptance fingerprints do not cover these two small source edits. Native browser zoom, actual screen-reader verification and multipage behavior remain unverified. No production release approval, push or deployment.

Independent follow-up complete: UX passed all three steps at1366×768 on `ef258719a651bdccfc05edf470cd8f2ded96bb07`, with no P1/P2 findings. Report: http://127.0.0.1:5206/catalog-processing-review/index.html . Durable evidence folder: `/Users/marcusdavies/.codex/visualizations/2026/10/23/01a16a35-2fc7-7a62-8945-f6c7f25a1638/catalog-processing-review/`, including screenshots, `checks.json` and `source-fingerprint.json`. All three recorded source hashes match the integrated candidate. The earlier workflow report links this gap-closure addendum.

UX released the5210 source hold. Slow-processing keyboard/completion and the explicitly simulated late-remount cleanup now have independent evidence. Actual screen-reader announcements, native zoom and multipage behavior remain outside this acceptance. No further code correction or test rerun is required solely to attach this report. Local acceptance is not release approval; production remains unchanged.

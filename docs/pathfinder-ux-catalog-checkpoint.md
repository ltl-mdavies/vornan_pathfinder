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

# Customer workflow UX checkpoint

October 24, 2026. Reviewed local checkpoint on `codex/pathfinder-ux-shell`, based on `cdd34d0`. This slice reorganizes existing Admin views; it does not deploy or alter intake, public Proof, Order Status, API contracts, credentials, runtime gates or workers. Independent bounded UX review passed after the three corrections below. This is not full end-to-end workflow or deployment acceptance.

## Local review

Open `http://127.0.0.1:5210/?customerWorkflows`, then Customers. Momentara has populated job activity; LTL Demo has no jobs. Both have isolated density fixtures for the method list and mapping table. The actual App handles navigation, parsing, validation and guards. All mutations are blocked by the fixture adapter; successful provider writes are not simulated.

The Product Design audit and the UX thread's `CUSTOMER-WORKFLOWS-LAYOUT-BRIEF.md` guided this composition. Existing shared navigation and fonts remain the baseline. Before/after screenshots are in `tests/ux/evidence/customer-*.png` (local evidence, ignored by Git).

## Capability map

| Surface | Presentation change | Retained controls and boundaries |
| --- | --- | --- |
| Overview | KPIs first; compact customer/route context; operational jobs before method summary | Customer record disclosure; account status and warnings; route setup; all method actions; original job predicates, ranking and five-row limit; View all jobs and job detail |
| Import Methods | Consistent working text, wrapping long names, compact section spacing | Full existing editor, all source types, schema/workbook/composite rules, Dropbox settings, connections, new/duplicate/archive/discard/save and dirty-navigation guards |
| Output Product Map | Diagnostics share the heading; visible destination/environment; catalog shortcuts disclosed; bulk toolbar appears after selection; table actions fit at 1366px | Search/state/route filters, source identity, dimensions, identifiers, editable names, row assignment/save, preload/catalog/detail, bulk review, replacement checkpoint/rollback and migration queue |
| Manual Import | Progress and eligibility summary, then source upload plus validation; detailed readiness and raw payloads are expandable | Full preflight before submit/certification; production-sandbox confirmation; masked packet; import basis/profile; workbook parsing; field/product resolution; visible source grid; duplicate/integrity/authorization/retry gates |

Workspace feedback now appears directly on Methods, Mapping and Manual Import. Previously the shared shell could hide a failed-save message inside Workspace tools. A failed write leaves edits unsaved and visible.

Independent review found and prompted three corrections: mapping density, contradictory credential messaging, and exposed raw payloads. The refined mapping table starts at y451.5 rather than y589 at 1366×768, showing three complete rows without reducing working text. Final Width/Height each have 6% of the table and no broken heading words. The catalog disclosure is a shortcut to catalog lookup, not an invented active catalog filter. Both raw payload disclosures are closed by default and keyboard-operable; Source Grid remains visible.

Credential preflight previously treated any nonempty user/password as Present, while certification correctly rejected setup placeholders. Preflight now displays the existing certification credentials item's status and message (Configured, Needs setup, or Not verified). This fixes a real display-predicate mismatch, not merely a fixture inconsistency. No certification, submission authorization, runtime gate or credential-storage predicate changed; packet-export presence fields are retained.

## Existing metric contracts

No metric selector or ranking algorithm changed. Display-only unavailable/stale messaging prevents failed initial reads from appearing as successful zero counts.

| Display | Unit and source | Time and scope |
| --- | --- | --- |
| Tracked Orders | Length of `activeCustomerJobs`, selected customer, non-archived | All loaded records; not a dated chart or proof of complete upstream coverage |
| Confirmed in Lift | Jobs whose `jobOperationalState` is Order Confirmed | All loaded non-archived jobs; subtitle counts valid `order_confirmed_at` timestamps at/after now minus 7×24h |
| Ready to Submit | Existing operational-state predicate | Current loaded jobs; no new certification or submission authority inferred |
| Needs Attention | Existing sum of intake task IDs, aged Ready jobs, confirmation-needed jobs and blocked jobs | Current issues across dates; intake tasks can exist without jobs. Not a count of unique orders. Ready aging remains 30 minutes from `created_at` |
| Recent operational jobs | `rankRecentOperationalJobs(activeCustomerJobs)` | Original five-row limit; issues first, then trustworthy Lift creation and intake timestamps. Table preserves separate intake, Lift-created and last-activity fields |

The seven-day subtitle is a rolling instant window, not calendar-day buckets; existing selector has no upper bound for future timestamps. Timestamp rendering remains the existing display helper. No chart or new timezone aggregation was added. Existing `job-operational-times` tests cover ranking/time semantics; `customer-workflow-layout` tests protect retained predicates and the unavailable-data presentation. View all jobs retains existing customer Jobs navigation; no new KPI filter promises were introduced.

## Verification

- Full regression after refinements: **1,332 passed** — API 800, public Proof 76, public Status 17, Admin 199, domain/packages 240. Initial restricted run could not bind local API test ports; the isolated loopback-enabled rerun passed. Logs: `/private/tmp/customer-workflow-refined-tests.log`.
- Full typecheck passed: `/private/tmp/customer-workflow-refined-check.log`.
- Admin production build passed: `/private/tmp/customer-workflow-refined-build.log`. Existing large-chunk warning remains.
- Actual browser at 1366×768: populated/sparse Overview, full method name, editor, visible save rejection with draft retained, keyboard cancel returning focus to All Import Methods, discard restoring saved method, populated mapping and visible row actions, one-row bulk assignment disabled/two-row explicit review, customer switching clears selection while retaining tab, Manual Import sample load and unresolved-product validation. Preview and external submit stay disabled in the tested blocked state.
- Independent UX review verified the frozen hashes, expanded-width Overview, genuine empty/unavailable states, rejected-save draft retention and feedback, and customer switching. Mapping shows three complete rows at 1366×768 and seven at 1920×1080 without outer overflow. An actual synthetic CSV parsed two rows; SKU/Order Number choices work and unresolved product IDs keep preview/submit disabled. Credential explanations agree and raw evidence opens/closes with Enter. Report: `http://127.0.0.1:5206/customer-workflows-review/`; durable local file `/Users/marcusdavies/.codex/visualizations/2026/10/23/01a16a35-2fc7-7a62-8945-f6c7f25a1638/customer-workflows-review/index.html`.
- Named-function comparison against `cdd34d0` found only `App` changed; no named handlers/helpers changed. `git diff --check` passes.
- Native 200% zoom, screen-reader speech, live-provider operations, successful persistence, replacement/rollback and full end-to-end certified/duplicate/uncertain submission scenarios are **not browser-accepted by this checkpoint**. Existing automated business-rule coverage remains in place; those browser scenarios need richer isolated fixtures before full workflow acceptance.

Reviewed source SHA256: `App.tsx` = `86f048e27006bf16e70cf7d1020f2c72fb8c4ac4aa749063015f758372689fbb`; `pathfinder-shell.css` = `5cb1070dc809b5ee9953e4b8b5395759ca3c8859fc03ebf9b600b923299a4f3e`; `tests/ux/src.tsx` = `b495b3642ba67e48725b151d71947341a4cd104c22514bdc6d9b95606fe90af9`.

## Remaining app work and release boundary

Carry forward the bounded follow-ups: the inherited 376px source-grid height leaves spare space with two rows; the source editor's loaded-columns hint can mislead before a source is loaded; source-type-specific editing and successful mutation/retry/replacement need richer isolated fixtures. No user design decision is required for these follow-ups. Customer setup/Settings, Targets, Audit, global Settings and final Dashboard consistency still need their own coverage. The accepted Catalog and internal Proof slices are unchanged.

Release stays with Pathfinder Development: reconcile against fresh main and concurrent hotfixes, run the complete release gate, review the exact resource/configuration diff, document rollback and obtain deployment approval. This document is not production release authorization.

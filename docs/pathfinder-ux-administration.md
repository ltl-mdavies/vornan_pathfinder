# Pathfinder administration consistency review

This local continuation of `8710aec` aligns Targets, Audit, global Settings and customer Settings with the approved shared shell. It also closes the sparse Manual Import grid and misleading Source Setup copy findings. Dashboard composition, metric selectors and public Proof/Status are unchanged. This is not a deployment approval or production verification.

## Scope and preserved controls

| Surface | Preserved capabilities and boundaries | Presentation change |
| --- | --- | --- |
| Customer Settings | Account defaults, selected customer routes, source connectors and Wrike connection controls, Proof capability policy/identity/order overrides, Public Status policy and link controls | Compact panels, full route names, collapsed planned connectors, explicit unknown connection count on denied reads; no permissions or setup behavior changes |
| Targets list | Existing target list, creation, selection and status predicates | Compact summary; configured targets distinguished from observed health; route count names the selected customer |
| Target Environments | Name, active environment, date format, environment creation/configuration and guarded deletion; separate Proofing API credential setup and save boundary | Shared shell typography; active environment and customer route scope visible beside header actions |
| Output Templates | Template selection/creation, reset to Lift sample, field/header/body mapping and previews | Existing editor retained under compact section navigation |
| Output Routes | Customer-scoped route fields, identifier strategy, mapping/remap diagnostics and action links | Explicit selected-customer context; no cross-customer route save |
| Value Rules | Route-specific add/edit/remove rule drafts | Existing controls retained |
| Test and Health | Local setup diagnostics and body/request preview; actual submit remains in certified Manual Import | Readiness is not represented as a live provider health check |
| Target save and navigation | `saveTarget`, shared-save-unavailable guard, customer route save, dirty navigation guard and deletion gates | Guard explanation retained; section navigation does not create separate save scopes |
| Settings Canonical registry | JSON/CSV exports, draft creation, search/section filters, field editing, path rename, custom-field deletion and existing validation/usage safeguards | Compact metrics and table, full identifiers, focusable horizontal scroll region; section-owned feedback receives focus without clearing a failed draft or leaking into other tasks |
| Settings Transactional email | Existing status read, readiness items and Refresh | Initial failure says not verified; known log mode remains distinct from SES; stale read retains data and local last-success read time |
| Settings Governance | Snapshot retention, recent changes, latest snapshot opening and downstream comparison controls | Separate section with mounted inactive content; no snapshot storage changes |
| Audit | Existing read-only scope, target count, filtered loaded job count and selected customer context | Explicitly a summary, not an event-history interface |
| Import Methods and Manual Import | Source detection/origin, all mappings and submit gates | Source Setup uses existing source-origin computation; source grid fits sparse rows and caps at 376px with keyboard-scroll focus |

Settings uses native buttons with `aria-current`, not incomplete tab roles. Inactive sections remain mounted to preserve draft state but use HTML `hidden` plus the existing shell-scoped `display:none!important` rule so their controls are not exposed to keyboard navigation or the accessibility tree. Saving still uses the original field/route handlers and scope.

## Local review routes

Start `npm exec vite -- --config tests/ux/vite.config.ts` in `/private/tmp/pathfinder-ux-shell`. Open `http://127.0.0.1:5210/?customerWorkflows&adminReview` and use the shared navigation. Customers → Empirical – Momentara → Settings covers defaults/connectors/Proof/Public Status; Targets → Lift ERP covers all five editor sections. Global Settings has Canonical registry, Transactional email and Governance.

Email cases: `?adminReview&emailError`, `?adminReview&emailSlow`, `?adminReview&emailSes`, `?adminReview&emailStale&emailSes`. In the stale case, enter Settings, select Transactional email and Refresh. Connector denial: `?adminReview&connectionsError`. See `tests/ux/README.md` for existing job, membership and Proof empty/error/stale cases.

All fixture requests terminate in the in-memory adapter. Mutations return 423 except the existing browser-local workspace setup simulation. Unknown routes fail closed. Successful saves, provider tests, Proofing API credential reads/saves, real downloads, populated governance snapshots/comparisons, configured connector details and source-type-specific editors are not established by this fixture. Those remain release review items where applicable; do not bypass the isolation boundary to test them.

## Verification and release boundary

The corrected candidate passed all 1,341 tests (API 800, Proof 76, Status 17, Admin 208, shared packages 240). Full workspace typecheck and Admin production build also passed. Final logs: `/private/tmp/admin-consistency-final-tests.log`, `/private/tmp/admin-consistency-final-check.log`, `/private/tmp/admin-consistency-final-build.log`. The build retains its existing large-chunk advisory. Earlier runs exposed sandbox loopback restrictions and one transient socket reset; the isolated Wrike file, complete first-candidate rerun, and corrected-candidate full suite passed with local loopback access.

Independent UX review accepted the corrected, refrozen source for bounded local presentation and demonstrated behavior on October 24, 2026. Report: `http://127.0.0.1:5206/administration-review/`; durable local file `/Users/marcusdavies/.codex/visualizations/2026/10/23/01a16a35-2fc7-7a62-8945-f6c7f25a1638/administration-review/index.html`. Screenshots live in ignored `tests/ux/evidence/admin-*.png`. Source-contract tests cover mounted Settings sections, hidden controls, email unknown/stale semantics, target save boundaries, Audit count scope, sparse-grid behavior, isolated registry feedback, unavailable connector counts and derived route diagnostics; these supplement, rather than replace, browser interaction tests. Browser checks confirmed zero-row source grid height 52.5px, two rows 131px, and twelve rows capped at 376px with a 576px scrollable body; source-origin copy distinguishes no source from sample columns. A rejected route save retained the edited name across sections, and navigating away prompted for unsaved customer route changes. A rejected registry creation retained both path and label and focused its visible inline alert; switching to Transactional email or Customer Import Methods did not display that error. A denied connector read displayed an unknown count, not an empty configured list.

Independent checks also covered representative 1366×768, 1600×900 and 1920×1080 layouts without outer horizontal overflow, keyboard access to the rightmost Value Rules action, an explicitly unconfigured customer without automatic setup, and End reaching the last row of the capped Source Grid. Dashboard composition and count predicates were retained. Native 200% zoom, screen-reader speech and live-provider operations remain unverified; this acceptance is not a release authorization.

The review corrections keep available connectors prominent, move planned placeholders into a closed disclosure, widen Target Type, and replace unconditional Test and Health success text with the existing route's blocker/warning counts. The registry's shared feedback setter is used only in legacy mode; the shell uses section-owned feedback.

Refrozen source SHA256: `App.tsx` = `860cbb779671ec72e0c27922b7a6ebdb24882941871d96d7e12354e4fcc2bd8a`; `pathfinder-shell.css` = `d480bf2a28f9aeb92a3febed931553ab0773320d40fbf57d7ccf5feb585dadc4`; `tests/ux/src.tsx` = `086fae3ca04d5420795f73b6fb45423d39ab7f0a7f5bc197cd5335bc84c4a856`.

Before any release, reconcile this branch against current main and concurrent fixes, run the full regression suite and build, complete the repository deployment requirements, and record exact Admin-only resources and rollback. No API, worker, intake, credential, public Proof/Status or production resource changes belong to this checkpoint.

## Remaining work

1. Close the accumulated browser coverage gaps with richer isolated fixtures: supported roles/gates, successful saves and reload persistence, configured connectors, source-specific editors, populated governance history, Proofing API reads, and certified/duplicate/uncertain submission outcomes. Verify existing behavior rather than introducing product changes or granting new permissions.
2. Complete integrated cross-page acceptance, retaining the approved Dashboard composition and metric definitions. Preserve the separation between simulated browser acceptance and live-provider verification. Further visual redesign is not required for the accepted administration slice.
3. Prepare the combined Admin release only after reconciling fresh main, concurrent hotfixes, reviewed resources and rollback. Existing public Proof/Status releases and backend settings are not collateral deployment targets.

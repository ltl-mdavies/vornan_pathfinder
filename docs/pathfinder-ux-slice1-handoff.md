# Pathfinder UX — shared shell and Jobs candidate

Date: 2026-10-23. Development owns implementation/release; Pathfinder UX owns design acceptance. Marcus owns deployment approval.

## Acceptance and next checkpoint

Pathfinder UX formally **accepted the local Slice1 candidate** with no blocking findings in the reviewed scenarios: http://127.0.0.1:5206/slice1-acceptance.html. Its evidence directory contains32 inspected screenshots, measurements, keyboard/delayed-read results and a staged-source fingerprint snapshot. The local `design-qa.md` contains Development's comparison and test record (intentionally Git-ignored by repository policy).

Nonblocking note: the global stale-error banner can move pagination about6px below the768px viewport; it remains reachable in the workspace scroller. Native200% browser zoom and exhaustive assistive-technology verification remain release work. No source changes were requested by final acceptance.

Next bounded checkpoint: **global and customer Proof queues**, preserving the accepted shell, permissions, public-link behavior, mixed states, grouping, cache/freshness, pagination and operator tools. Review populated/empty/stale/error/restricted states at1366 before conversion expands. Catalog inner workflows follow separately; do not bundle imports, mapping or Overview redesign into that next checkpoint.

## Baseline and boundaries

- Dedicated branch: `codex/pathfinder-ux-shell`.
- Dedicated worktree: `/private/tmp/pathfinder-ux-shell`.
- Freshly fetched implementation base: `819454b0dcf563e0f28ca29db2d238ab4d95f73d`.
- Design contract: Pathfinder UX `prototype/handoff/PATHFINDER-DEVELOPMENT-HANDOFF.md`, October 23.
- No API, worker, package dependency, access policy, runtime gate, data migration, deployment configuration or public Proof/Status changes.
- No production writes, push or deployment in this milestone.

## Retained capability map

| Capability | Candidate destination |
| --- | --- |
| Global navigation | One shared masthead/rail on all destinations, including loading/setup and legacy editors |
| Existing customer record | Customer directory row; no new activation action on the row |
| Workspace setup | Existing explicit setup screen and handler; directory membership remains independent of Lift status |
| Customer switching | Header switcher; current tab preserved; previous workspace/source/detail responses invalidated |
| Catalog | Display name Catalog, internal key Artwork Catalog, after Proof; existing eligibility unchanged |
| Intake Exceptions | Customer Jobs → More → Intake follow-up, available with zero jobs; original mount and customer gate retained; global exception selector retained |
| Search | Existing job/full/display IDs, source order, customer, Lift order fields |
| Jobs filters | Scope/customer, intake method, attention; date, archive visibility, sorting and reset in More |
| Queue refresh | Existing bounded polling; visible refresh control; last-success timestamp; stale/error state |
| Bulk archive/restore | Selection controls call original `requestJobsArchive`; original exact-target confirmation remains |
| Triage, intake review, older queue controls | Explicit More entry to existing tools; no handler removed |
| Staff order lookup | Global Jobs More → existing lookup/tools |
| Scan a job | Read-only 340px inspector; modal below1550, docked at larger widths |
| Complete job detail | Inspector → Open full job details; original lines, attempts, comparison, history, evidence and contextual actions |
| Mapping, certification, submit/recovery | Existing job-detail action handlers and predicates unchanged |
| Lift association/replacement | Existing verification, reason, confirmation and audit history unchanged |
| Status links and Wrike comment | Existing eligible detail actions unchanged; inspecting a job does not issue links/write comments |
| Back to queue | Queue remains mounted while full detail is visible; filters, sorting and page retained; focus restored |
| Dirty method/target changes | Original save/discard/cancel decisions; explicit modal focus containment and Escape/cancel restoration |
| Customer utilities | Workspace tools disclosure retains existing environment/notification/utility controls |

## Intentional differences from illustrative mock data

Real operational columns (Lift order, processing, production, last activity) remain. Catalog is absent for ineligible customers even where a mock showed it. The inspector uses only actual list-record fields and links to complete detail; it does not invent illustrative line data. Existing inner-editor layouts remain for later UX slices, but never revert the outer shell.

The current Admin application uses in-memory navigation, not a general hash/URL router. Existing internal view keys and callers remain compatible. No new browser deep-link/history contract is claimed or introduced by this slice.

## Verification

- Whole-workspace typecheck passed.
- Full regression run: 1,312 tests passed, including API800, Proof76, Status17 and Admin179. See `design-qa.md` for final rerun status and evidence.
- Admin production build passed; Vite reports large chunks over500kB. No bundling change was made here.
- Local actual-App walkthrough covered all global destinations/customer tabs, workspace setup, customer switching, delayed reads, unsaved editing, inspector/back, selection confirmation and viewport density.
- Synthetic review is not a live provider integration test. Production smoke and runtime-state comparison remain release requirements.

## Coordination and release gate

1. UX must accept this actual-app candidate, including residual findings listed in `design-qa.md`. No parallel edits to Development's worktree.
2. Before any merge, fetch current main again and reconcile all newer fixes. Re-run full checks on the combined candidate; never replace current main or a deployment artifact with an older UX checkout.
3. Review a narrowly scoped diff. Require no unintended changes under API, public Proof, Status, intake adapters, infrastructure, runtime gates or credentials.
4. Preserve live Catalog/customer eligibility and all Proof capabilities. Test-only Vite flags must never become release environment defaults.
5. Development prepares the release manifest, known-good rollback SHA/artifact and exact Admin-only deployment plan. Obtain Marcus's deployment approval.
6. Deploy through the existing release workflow only. Smoke shared navigation, customer isolation, job details/actions and directory/setup; verify public Proof/Status and intake/API health without manufacturing orders or sending test customer comments.
7. UX owns later page-design acceptance; Development owns merge sequencing and production release. This first slice is not completion of the entire app redesign.

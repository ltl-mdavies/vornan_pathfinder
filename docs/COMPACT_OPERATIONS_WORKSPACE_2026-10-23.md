# Compact operations workspace — implementation record

## Baseline and ownership

- Approved visual targets: compact Dashboard, Jobs, global Proof, Customer → Proof, designed at 1366 × 768.
- Source baseline: `47246a0` (PR #360); branch `codex/compact-operations-workspace`.
- Development-only. No production deployment, grants, Lift requests, submissions, Wrike messages, configuration changes, or migrations authorized by this implementation checkpoint.
- Coordination notices sent to Vornan Proof Development, Pathfinder JSON Intake & Webhooks, and Pathfinder Live Support.
- Preserve unmerged Proof v1 allocation work and JSON shipping-callback preparation; do not cherry-pick either into this branch.

## Boundaries

1. Reuse existing job details, recovery actions, archive controls, and source-order deduplication. Global filters must never inherit customer setup context.
2. Queue visibility does not authorize approval or grant creation. Open Proof must use existing operator access controls; no guessed public URLs or implicit grant creation.
3. Proof list reads cached normalized state; do not contact Lift once per row. Preserve cancellation, reference artwork, backward line-step transitions, and decision context.
4. Do not infer integration health from configuration or absence of errors. Missing coverage/freshness must be explicit.
5. Additive authenticated read routes only. Existing request and mutation contracts stay unchanged.
6. Existing route environment explanations, customer primary-route semantics, method/job route precedence, and customer setup controls stay intact.

## Delivery slices

- Shared compact Admin components and global navigation; functional filters, pagination and exact job detail links.
- Shared customer/global Proof queue; read-only cached coverage and freshness contract, guarded operator drilldown.
- System-wide Dashboard using unfiltered jobs and explicit observed health.
- Production queue indexing/discovery coverage and notification/exception aggregates require verified source contracts before claiming exhaustive totals. Bounded cached reads are labelled as such.
- Tests, typechecks, local 1366 × 768 visual review, and current-main integration review before release approval.

## Release gates (not yet satisfied)

- [x] Source and regression tests, full workspace typecheck (see release-preparation checkpoint below).
- [x] Local browser review of all four screens, filtering, empty/error/stale states, long labels, keyboard access; authenticated production checks remain part of rollout.
- [x] Proof owner review of queue classification/access; independent v1 changes remain intact.
- [ ] Durable indexed coverage/discovery plan validated; no false complete queue or health claims.
- [ ] Latest-main merge review and explicit API/Admin artifact diff.
- [ ] Deployment resource inventory, current revisions, rollback artifacts and cross-app smoke plan.

No release should be described as ready while these gates remain open.

### Approved rollout validation

The user approved completing release checks and deployment on October 23. The refreshed full typecheck caught an incorrect local-store property in the new minimal reader; it was corrected to the existing `workspace.customer` schema before the final successful run. Final full workspace tests pass (including 768 API, 173 Admin, 76 Proof and 17 Status), all 169 deployment-contract checks pass, and all 17 existing Proof browser regressions pass. No provider transport was used by those tests. The Proof owner independently reviewed the queue projection/access and reported no blocker; isolated `50d109f` remains excluded.

The candidate template was evaluated with actual current production parameters and compared to the deployed template: the only configuration difference is the added operations flag on the primary API. All other evaluated resources, settings, schedules, permissions and worker properties match. The complete Admin bucket was downloaded to a restricted local rollback directory before release. Authenticated live Pathfinder was available and the pre-release Dashboard showed existing confirmed Momentara and JSON orders and healthy configured scheduled intake. Post-deploy checks must verify the new screens, reads and retained access paths without triggering approvals, submissions, grants, or writebacks.

## Release-preparation checkpoint — October 23

Local candidate only: no push, deployment, production flag changes, grants, intake submissions, or Wrike writebacks performed. Latest fetched `origin/main` remains `47246a0a1abe30032792bde4b607e0bc94e8679a`.

### Corrections included during review

- Read-only Proof projection distinguishes approved, reference, cancellation requested, and revised-art-expected states. Mixed-state lines retain counts and remain discoverable in relevant queue filters. Cancellation requests do not masquerade as confirmed cancellations.
- The queue's timestamp is labeled **Last updated**, not a fabricated duration in the current state.
- Customer eligibility reads only saved workspace membership and customer records, not the entire store; it does not hydrate secrets, seed data, or call providers.
- Global Proof has an interactive **Group by: Order / Customer** selector. Customer mode sorts before pagination and retains customer → order → line hierarchy. Group identities include the customer boundary. Customer-scoped Proof remains grouped by order. Browser checks at 1366 × 768 verified both modes, pagination, customer filtering, and collapse behavior; no console warnings/errors observed.

### Verification evidence

- Full workspace typecheck passed.
- Full workspace test suite passed after classification/read corrections, including API 768, Proof 76, Status 17 and Web 172. The subsequent grouping refinement passed the Web suite at 173 tests.
- All 169 deployment-contract tests passed. Historical infrastructure hashes remain unchanged after removing only this release's additive flag fields for comparison; a new test separately verifies the enabled-template delta.
- Full workspace build, final Admin build with operations enabled, and API Lambda packaging passed. Existing bundle-size advisory remains.
- Logs: `/tmp/compact-release-{check,tests,web,deploy-tests,build,admin-build,package}.log`.
- Local preview uses labeled sample data. It is not an authenticated production/API smoke test. No claim of exhaustive Lift proof coverage: queue scope remains the loaded cache, with coverage text and load-more controls.

### Deployment boundary and configuration preservation

- Deploy only the primary API and Admin frontend. Exclude public Proof/Status frontends, dedicated Proof services, scan-worker artifact, intake workers, schedules, tables, IAM, capability settings, and independent Proof commit `50d109f`.
- New API CloudFormation parameter `OperationsWorkspaceEnabled` defaults false and requires Firebase authentication when enabled. Admin build flag `VITE_ENABLE_OPERATIONS_WORKSPACE` defaults false; CI reads `PATHFINDER_ENABLE_OPERATIONS_WORKSPACE_UI`.
- Use a reviewed, parameter-preserving change set: retain every existing parameter via `UsePreviousValue` except the explicitly approved API artifact and new operations flag. Do not replay deployment script defaults over current production settings.
- Release API first, verify authenticated reads and existing contracts, then publish the enabled Admin artifact. No schema migration or data backfill is required.

### Read-only production baseline captured

- AWS account `744016783602`, region `us-east-1`; stack `vornan-pathfinder-api-prod`, `UPDATE_COMPLETE`.
- API artifact: `s3://vornan-pathfinder-artifacts/api/pathfinder-api-lambda-e8b0f591e9177aaad6f354a2762c21d3545583e1.zip`.
- Scan-worker artifact **must remain** `api/pathfinder-api-lambda-7e987eaf0020f216f3376f748f91c8201a5b53fe.zip`.
- API revision `d81cbf3b-ca97-4991-84c7-3d72c387204d`; code SHA256 `NnMFvuFbU+SyxozptqXlZrduK4baZlZTK0rSuafS2yg=`.
- Environment fingerprint `02627f8a8152d03f7ccbb8b74bf690976fecefa6eaee9188266f5c42f83afd87`; 63 variables, 3840 serialized bytes. Adding only the operations flag estimates 3888 bytes. Secret values were not recorded. Recheck before deployment.
- Admin bucket `vornan-pathfinder`: `index.html` version `xb0X12pL0weqijgSiMncOVzxKp5EBggF`, ETag `f652b2a67969276f8aee3d03d9f8ba77`, last modified `2026-10-23T14:04:28Z`.

### Remaining gates and rollback

- Obtain final Proof-owner review of the classification corrections; earlier coordination confirmed the independent Proof work is isolated, not release signoff.
- Complete authenticated application/browser regression checks for intake/job recovery, customer setup, Proof access/custom controls, and Order Status. Local sample-page verification does not replace these checks.
- Freeze an exact candidate commit and artifact checksums; refetch main and recheck live revisions/configuration for concurrent changes.
- Preserve the full existing Admin asset set and entrypoint before publishing (the index version alone is not a sufficient rollback). Review the change set for unrelated resource/configuration differences.
- Roll back Admin first to its complete prior asset set, then restore the primary API artifact and operations flag while preserving all other parameters. Do not roll back unrelated Proof/Status/intake deployments or data.

## Customer navigation checkpoint

- Customers navigation opens a searchable, paginated directory backed by the existing customer directory read. Search supports names and identifiers; status filtering is available.
- Customer records expose a compact quick switcher and breadcrumb back to the directory. Switching preserves the selected tab, including Proof and Jobs, and goes through the existing unsaved-change guard.
- Workspace and source-connection request generations prevent late responses from a previous customer overwriting the next selection. Old workspace, source connection, job detail and proof drilldown are cleared while loading.
- Restricted tabs remain restricted. A preserved unavailable tab displays an explanation rather than silently enabling the feature.
- Local browser verification with sample data: directory search by ID, switcher search by name, Proof and Jobs tab retention, breadcrumb return, no-result state, Escape dismissal and restored trigger focus passed. This is not a production authentication or integration smoke test.
- Web typecheck, 157 web tests and the operations-enabled production web build passed. Existing bundle-size advisory remains. No deployment performed.

### Full Lift directory clarification

- The initial local fixture contained only three active examples, not the actual Lift directory. Added explicitly labelled inactive and not-yet-configured sample records; the preview never activates real customers.
- Clarified that the filter reflects Lift status, not Pathfinder workspace setup. The authenticated application continues to load `/api/lift/customers?refresh=1` without an active-only filter and passes all returned customers to the directory.
- Existing missing-workspace handling and explicit `Set up workspace` POST remain unchanged. Selecting an inactive record does not change its Lift status or enable intake.
- Inactive filtering and record selection browser-verified. Web typecheck and 159 web tests passed, including full-directory retention and explicit-setup integration guards.

### Separate Pathfinder setup status

- The directory now makes Pathfinder setup primary: `Workspace set up`, `Not set up`, or `Checking/Unknown`, alongside the independent Lift status column and secondary filter.
- New default-dark authenticated GET `/api/operations/customer-workspaces` returns only saved workspace customer IDs and a check timestamp. The DynamoDB reader projects customer IDs from the workspace table, follows all pages and never loads jobs, hydrates secrets, seeds storage or performs provider calls. Failure is 503, never an empty success.
- `Set up workspace` opens the selected customer through the existing unsaved-change guard and missing-workspace confirmation. Creation still uses the existing explicit POST; no new activation or intake mutation path was added. Returning to the directory refreshes setup membership.
- A workspace is not evidence that scheduled intake or Proof access is enabled. We deliberately use `Workspace set up`, not an invented account activation flag.
- Browser-verified setup filtering, independent Lift status, simulated confirmation, updated membership and preserved Proof tab. The preview labels its setup action as local-only; no production activation was performed.
- API and web typechecks passed; 766 API regression tests and 160 web tests passed. Enabled web build passed, with the existing bundle-size advisory. Production configuration and deployment remain untouched.

### Simplified customer views (supersedes directory filters above)

- Default view: **Pathfinder customers**, limited to saved workspace membership.
- Alternative: **All Lift customers**, with existing-workspace links and explicit **Set up workspace** actions for customers without a workspace.
- Removed both status dropdowns and Lift status column. Setup information appears only in the all-Lift view. Search remains available in both views.
- Membership lookup failures remain explicit; no inference from Lift Active/Inactive. Existing setup confirmation and intake safeguards are unchanged.
- Browser-verified default membership, all-Lift coverage and setup actions; web typecheck and 161 web tests passed. Local only.

### Approved customer directory refinement (supersedes row actions above)

- Implemented both approved list designs: a contained two-view switch and search, customer name over Lift ID, a single keyboard-accessible row navigation target, and no action column or setup button in the directory.
- All Lift customers adds quiet `In Pathfinder` / `Not set up` membership text. Missing/failed membership reads remain unknown, never inferred from Lift status. One-page results show a simple count; larger directories retain pagination.
- Selecting any row opens its record through the existing navigation guard. Existing setup confirmation remains in the record, and switching retains the selected customer tab. No changes to setup or API mutation handlers in this refinement.
- Verified production typography against the public live `index-DQlcMrOm.css`: Plus Jakarta Sans headings, inherited body/control stack. Removed Georgia overrides across Dashboard, Jobs, global Proof and customer headers. Shared production styles and brand assets remain unchanged.
- Image-to-code and design-QA comparison recorded in project-root `design-qa.md`, with normalized approved references and local browser captures. Both views reviewed at 1366 × 768, and All Lift at 1180 × 768.
- Web typecheck, all 163 web tests and operations-enabled build passed. No browser errors/warnings in the reviewed pages. Existing bundle-size advisory only. No push/deployment or live customer changes.

### Approved Dashboard refinement

- Replaced the sparse two-bar Dashboard with one activity summary and four compact panels: Recent orders, Needs attention, Awaiting proof approval and System health. Preserved deployed typography, brand assets, sidebar and other approved pages.
- Recent orders use the five newest active loaded jobs across customers/intakes. Actionable job failures/mapping/retry states are separated from routine confirmation-in-progress. Counts state their loaded-record scope; pre-job intake exceptions remain in Jobs rather than being invented or miscounted.
- Proof preview reads one authenticated page from the existing operations cache endpoint, with cancellation/stale-response protection and retained results on refresh error. No Lift sync, approval mutation or grant creation. Pending lines are deduplicated and grouped by customer/order; partial coverage, stale state and unknown dates are explicit. Existing customer-checked Proof opening is reused.
- System health displays observed scheduler state only where available. Lift endpoint health, JSON API monitoring and notification coverage are not inferred from unrelated activity. Details explain the evidence boundaries.
- Local sample fixture includes normal, empty, unavailable and stale/partial scenarios. The authenticated component uses existing live reads; the preview is explicitly labeled sample data and performs no production actions.
- Browser acceptance at 1366 × 768 and 1180 × 768: five recent orders, three proof groups and four health services remain visible; no horizontal overflow. Jobs/Proof navigation, order/customer handoff, health disclosure, refresh and customer directory smoke checks passed.
- All 170 web tests, TypeScript and operations-enabled build passed. Browser warnings/errors empty; existing bundle-size warning only. Design QA evidence is in `design-qa.md` and `artifacts/dashboard-implementation/`. No backend changes in this refinement, no deployment or feature-flag enablement.

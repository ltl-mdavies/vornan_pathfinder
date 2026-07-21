# Pathfinder Build Log

This is the living implementation record for Pathfinder. It tracks completed milestones, product decisions, and verification against the master directive in `PATHFINDER_MASTER_SPEC.md`.

## 2026-07-21 - Production Job Submit Access Hotfix

- Restored the Ready/Submit Failed job's primary `Submit to Lift` / `Retry Submit` action directly in the Job Detail header, including the explicit PROD-to-LTL-Demo confirmation control.
- Kept post-submit diagnostics in the compact Actions menu, removed the duplicate buried submit control, and made the popover viewport-bounded and vertically scrollable. Job Detail no longer clips the menu with `overflow: hidden`.
- Import Methods now displays the current Output Route `name` resolved by `output_route_id`; it no longer reconstructs an outdated target/account/template label after a route rename.
- Lift payload validation now blocks a missing `order.order_title`. Submit readiness independently rechecks the title so a previously persisted Ready job cannot bypass the current Lift order-name requirement.
- Job Detail explains the exact recovery when an old preview has no order title: enable Order Name Resolution on the Import Method and generate a new preview job.
- Added focused Lift adapter regression coverage for missing and resolved order titles.

## 2026-07-21 - Demo Auth Recovery And Durable Lift Submit Gates

- Pathfinder API requests now obtain the current Firebase ID token instead of continuing to reuse the token captured when the workspace first opened.
- A 401 from the Pathfinder API forces one Firebase token refresh and retries the interrupted request once. If authorization still fails, the app signs out visibly and presents a session-expired message requiring Google sign-in rather than silently leaving saves unsatisfied.
- The API CloudFormation stack now owns the external Lift submit gate, transport mode, and live-customer permission as explicit parameters, preventing later API deployments from silently reverting them to process defaults.
- The production deploy workflow defaults to the approved certified sandbox lane: external submit enabled, live transport, and live-customer profiles disabled. Target, preview certification, credentials, product mapping, environment, submit-profile, and explicit PROD sandbox confirmation gates remain required.
- Added focused browser-client regression coverage for token refresh, failed refresh handoff, and prevention of bearer-token leakage to non-Pathfinder origins.
- Manual Import now reads the authenticated API submit-runtime posture before building an unpersisted preview certification, eliminating stale hard-coded disabled/dry-run blockers after a deployment gate change.

## Current Build Snapshot

**Date:** 2026-07-10  
**Phase:** MVP vertical slice  
**Primary focus:** Customer workspace, manual XLSX/grid import, field mapping, product resolution, Canonical Order preview, Lift payload preview, and local persistence.

## Master Spec Alignment

| Master Spec Area | Current Status | Notes |
| --- | --- | --- |
| Canonical Order model | Implemented for MVP preview | Shared TypeScript package defines order, line, shipping, validation, and processing-state types. |
| Input templates and mapping | Implemented for manual XLSX/grid slice | Source columns can map to canonical fields; mappings can be saved per import method. |
| Lift Standard Graphics adapter | Implemented through preview request | Generates Lift payload and masked submit request; real QA1 submission is intentionally gated. |
| Customer workspace | Implemented for local MVP | Lift customers can be selected; workspace loads persisted import methods, target, and jobs. |
| Target configuration | Implemented for local MVP | Targets now separate platform, environments, output templates, and output routes; Lift QA1/PROD behavior remains seeded. |
| Processing jobs | Implemented as persisted preview jobs | Preview jobs include source grid, mappings, canonical validation, Lift validation, payload, and masked request. |
| Product mapping | Implemented for local MVP preview | Product keys can be derived/composited from source rows, mapped to Lift `unit_number`, and gated before Ready state. |
| QA1 submission | Deferred by design | Waiting on credentials, final endpoint confirmation, and header-name confirmation. |

## Completed Milestones

### 1. Master Specification and Lift Contract

- Consolidated Pathfinder product direction into `PATHFINDER_MASTER_SPEC.md`.
- Created Lift Standard Graphics sample payload and field/request mapping notes.
- Locked MVP Lift header rules:
  - `Content-Type: application/json`
  - `Ext_ID` must match body `order.ext_id`
  - `User`, `Password`, and `Company` headers configured through target settings
  - Company value defaults to `91`

### 2. Vornan/Pathfinder App Shell

- Imported Vornan brand assets and Plus Jakarta Sans heading font.
- Built the Vornan-aligned Pathfinder shell:
  - dark left navigation
  - customer selector
  - customer workspace header
  - target summary
  - KPI cards
  - import methods and jobs panels
- Refined the shell through multiple design passes to match the approved mockup direction.

### 3. Lift Customer Directory

- Added API integration/fallback for the Lift customer CSV endpoint.
- Added parsing for Lift customer ID, name, customer number, status, sales rep, type, created date, and invoice email.
- Customer selection now drives the workspace and Lift customer ID used in payloads.

### 4. Manual Import and Preview Workflow

- Added XLSX/CSV/grid parsing.
- Added field mapping from source columns into Canonical Order targets.
- Added Canonical Order generation and validation.
- Added Lift payload generation and masked submit-request preview.
- Added local persistence for:
  - customer workspaces
  - import methods
  - field mapping templates
  - Lift target config
  - preview processing jobs

### 5. Persistent Customer Import Workflow

- Added file-backed local API store for development.
- Added workspace, import method, target, jobs, and preview-job endpoints.
- Wired the UI to persisted API state.
- Added editable Import Method setup.
- Added editable Lift Target settings.
- Added persisted preview job creation from Manual Import.
- Added customer/global jobs lists backed by persisted preview jobs.

### 6. Product Resolution and Multi-Tab Workbook Handling

- Added Product Resolution config per import method:
  - derived key
  - composite key
  - direct Lift unit number
  - mapped-to-Lift-unit or send-derived-unit modes
- Added persistent customer product mappings with `Mapped`, `Unmapped`, `Ambiguous`, and `Inactive` statuses.
- Extended XLSX parsing to inspect all workbook tabs, classify rows with valid `Print QTY` as order lines, retain no-quantity rows as reference/catalog candidates, and preserve sheet name plus row number.
- Preview jobs now include source sheets, parsed order rows, reference rows, product resolution results, unresolved products, and Lift payload lines populated from resolved unit numbers.
- Added `Needs Mapping` processing state so unresolved products are distinct from hard validation failures.
- Added Product Resolution setup controls and a Manual Import mapping approval table.
- Added workbook sheet summaries and product mapping health signals in the customer workspace.

### 7. Import Method Management and Source Expansion

- Added import method operational statuses for `Active`, `Inactive`, `Draft`, `Paused`, and soft-deleted `Archived`.
- Added import method row actions for edit, duplicate, and delete/archive.
- Added source types for XLSX, Google Sheet, PDF PO, Clipboard, REST API, and SFTP.
- Added source-specific setup fields for Google Sheet URL/tab/range, PDF PO review mode, REST endpoint, and SFTP path.
- Preview generation now requires an Active import method.
- Reworked field mapping into a found-input-elements table with source field names, sample values, and any canonical target selectable per row.
- Refined Product Resolution setup so resolver strategies show only relevant controls, and composite columns are selected as chips from detected input fields.
- Promoted Product Resolution strategy selection into its own hierarchy with plain-language guidance and stable downstream field alignment.
- Simplified Product Resolution by removing operator-facing fallback behavior, clarifying resolution mode, and adding a live example of customer key and Lift `unit_number` output.
- Clarified the recommended resolution mode as a customer-specific crosswalk to Lift unit numbers, while keeping Lift as the product source of truth.
- Reduced Product Resolution example output to only the cards relevant to the selected strategy and resolution mode.
- Added an Example Output test-value input so users can type a sample source value and immediately see the generated customer key.

### 8. Customer Lift Unit Map

- Added a customer-level Lift Unit Map page for managing the crosswalk between customer-submitted product values and approved Lift `unit_number` values.
- Added searchable/filterable mapping review across `Mapped`, `Unmapped`, `Ambiguous`, and `Inactive` statuses.
- Added bulk assignment controls so multiple customer keys can be assigned to one Lift unit number and product name in a single action.
- Added one-to-one inline editing for Lift `unit_number`, product name, and mapping status.
- Added last-seen source examples so operators can understand which sheet/row produced each customer key.
- Added customer mapping health metrics for unmapped keys, mapped keys, seen examples, and current selection count.

### 9. Output Route Scoping

- Promoted the mapping concept from a Lift-only unit map to a route-scoped Output Product Map.
- Added `OutputRoute` as the customer-level scope that combines target system, destination account/company, output template, and product identifier type.
- Seeded the current route as `Larger Than Life · Lift / 91 · Standard Graphics`.
- Attached import methods to an output route while preserving existing target/template fields for the current Lift workflow.
- Scoped product mappings to output route so the same customer-generated product key can resolve differently for Lift/91, another Lift company, or a future ecommerce output.
- Updated the customer UI to show Output Product Map route filters, route context, and route-specific product identifier labels.
- Kept Lift Standard Graphics behavior intact: the route-specific product identifier is still Lift `unit_number`.

### 10. Targets and Output Template Management

- Refactored Targets from one Lift settings panel into a destination-management workspace.
- Added target setup sections for:
  - Overview
  - Environments
  - Output Templates
  - Output Routes
  - Test & Health
- Expanded local target data models with `TargetEnvironment`, `OutputTemplate`, and route links to environment/template IDs.
- Seeded Lift ERP with QA1 and PROD environments, the existing Lift Standard Graphics JSON template, and the `Larger Than Life · Lift / 91 · Standard Graphics` output route.
- Preserved Lift requirements:
  - Company ID defaults to `91`
  - QA1/PROD endpoints remain configurable
  - credentials and password-like secrets are masked in API responses
  - `Ext_ID` equality remains the expected template rule
- Added output template editor basics for destination method, output format, body template, header template, canonical mapping count, and filename format tags.
- Kept customer import methods pointed at an Output Route so downstream mapping and preview behavior consume the target/environment/template bundle consistently.
- Added a local-only Test & Health panel that previews the selected target configuration without sending external requests.
- Refined Targets into an overview/detail workflow:
  - overview lists all targets
  - selected target detail owns Environments, Output Templates, Output Routes, and Test & Health
  - Save Target moved into the selected target detail
  - Add Target creates a draft target and opens its setup
- Seeded `ThinkDifferentPrint` as a draft Ecommerce target to validate multi-target behavior.
- Reworked Output Templates into a template list/detail flow with Add Template, status control, and selected-template editing.
- Added template placeholder detection so pasted body/header tokens can be mapped through selectable Canonical Order fields.
- Added mapped body/header previews that show the Canonical Order values currently assigned to each template token.

### 11. Sandbox Submit Profile

- Added submit profiles to output routes so an order can be previewed as either:
  - the selected live customer
  - a sandbox/test customer override
- Seeded the Lift Standard Graphics output route with:
  - `Live Customer`
  - `Sandbox · LTL Demo`
- Added the LTL Demo sandbox customer override:
  - Lift CustomerID `1249`
  - Customer Name `LTL Demo`
- Kept sandbox submit scoped to the output route, not the target environment, so QA1/PROD still represent infrastructure while submit profiles represent customer identity.
- Updated Manual Import preview to show source customer versus submit customer before preview generation.
- Updated preview job persistence to record submit profile, submit mode, sandbox flag, source customer, and submit customer.
- Updated Canonical Order and Lift payload generation so sandbox previews preserve the source workspace/customer but submit the outbound Lift payload under `LTL Demo / 1249`.

### 12. Output Template Field Detection

- Reworked Output Template mapping from token-first to JSON-field-first.
- Body and header editors now support pasting normal JSON with blank or example values instead of requiring `{{...}}` tokens up front.
- Added JSON field detection for nested objects and repeatable arrays such as `lines[].unit_number`, `lines[].quantity`, and `lines[].dimensions.final_width`.
- Added a field mapping table that lists detected Body/Header fields, sample values, selected value source, and preview token.
- Mapping a detected field now rewrites the corresponding JSON value to the selected token, such as `{{order.external_order_id}}`.
- Header mapping now supports non-Canonical value sources:
  - static/example value
  - Canonical Order
  - environment credentials/settings
  - output route values
  - generated values
- Lift default header behavior remains non-technical:
  - `Content-Type` can stay static
  - `Ext_ID` maps to the order id
  - `User` and `Password` map to environment credentials
  - `Company` maps to environment/header settings
- Seeded Lift Standard Graphics template now uses a normal example body/header shape plus saved field mappings, matching the intended paste-and-map workflow.

### 13. Route-Aware Submit Readiness

- Added route-aware Lift submit request generation for preview jobs.
- Preview now derives endpoint, Company header, and credentials from the selected Output Route and Target Environment instead of only target-level defaults.
- Added submit-readiness validation messages for:
  - missing endpoint
  - `Ext_ID` header/body mismatch
  - missing Company header
  - placeholder import username/password
  - selected submit profile
  - selected output route
- Confirmed the intended first external-test path is supported structurally:
  - Target Environment: `PROD`
  - Submit Profile: `Sandbox · LTL Demo`
  - Submit Customer: `LTL Demo / 1249`
  - Destination account: `Larger Than Life / 91`
- Added editable Output Route controls for environment, destination account, company id, output template, and route status.
- Added an API endpoint to persist customer output route edits:
  - `PUT /api/customers/:liftCustomerId/output-routes/:routeId`
- Updated Manual Import target preview so it displays the active import method route/environment/template rather than assuming the primary QA1 route.

### 14. Submit Certification Checklist

- Added a submit certification model to preview jobs.
- Certification is separate from preview state so a job can be payload-ready while still blocked from real external submission.
- Certification checklist currently evaluates:
  - preview state
  - Canonical Order validation
  - Lift payload validation
  - product resolution completeness
  - output route status
  - selected endpoint
  - `Ext_ID` header/body equality
  - Company header
  - Lift import credentials
  - submit profile
  - explicit external-submit feature gate
- External Lift submit remains disabled unless `PATHFINDER_ENABLE_LIFT_SUBMIT=true`.
- Added a Manual Import `Submit Certification` panel with pass/blocking checklist rows and submit-gate status.
- Updated validation rows so warnings no longer look like hard failures.

### 15. Actionable Submit Certification and Gated Submit Endpoint

- Added action keys to submit certification checklist items so blockers can route the user to the correct setup surface.
- Added `Fix this` controls in the Manual Import certification panel.
- Certification actions currently route to:
  - Manual Import / Field Mapping for canonical and general preview issues
  - Output Product Map for product resolution issues
  - Target Environments for endpoint and credential issues
  - Target Output Routes for route status and Company ID issues
  - Target Output Templates for `Ext_ID` mapping issues
  - Target Test & Health for external submit gate issues
- Added guarded submit endpoint:
  - `POST /api/customers/:liftCustomerId/jobs/:jobId/submit`
- The submit endpoint currently:
  - loads the persisted preview job
  - requires submit certification
  - returns `409` for unresolved certification blockers
  - returns `423` when only the explicit external-submit feature gate remains locked
  - does not call Lift yet
- This prepares the real submit path without risking an accidental external order creation.

### 16. Submit Attempt Audit and Idempotency

- Added local submit attempt records to the file-backed store.
- Submit attempts capture:
  - attempt id
  - idempotency key
  - preview job id
  - output route
  - submit profile
  - sandbox/live mode
  - endpoint
  - Ext_ID
  - Company ID
  - masked request
  - certification snapshot
  - blocking items
  - normalized response placeholder
- The guarded submit endpoint now persists attempts for blocked, gate-locked, and dry-run submit requests.
- Repeated submit requests with the same idempotency key return the existing attempt instead of creating a duplicate.
- Manual Import now shows the latest submit attempt audit summary after a submit request and reloads the latest workspace attempt after refresh.
- This establishes the audit/replay foundation needed before external Lift transport is enabled.

### 17. Lift Transport Dry-Run Adapter

- Added a real Lift submit transport boundary in the Lift adapter.
- The transport supports two modes:
  - `dry_run`: normalize and audit a certified submit attempt without sending an external request.
  - `live`: POST the Lift request to the selected route environment endpoint.
- Added normalized Lift response handling for accepted, rejected, and transport-error outcomes.
- The guarded submit endpoint now:
  - still requires submit certification
  - still respects `PATHFINDER_ENABLE_LIFT_SUBMIT`
  - rebuilds the unmasked submit request from the selected output route and target environment at submit time
  - keeps persisted job records masked
  - writes the normalized transport response into the submit attempt audit trail
- `PATHFINDER_LIFT_TRANSPORT_MODE=live` is required before the API will make an external POST. Without it, a certified submit records a dry-run attempt.
- No external Lift request is sent by default.

### 18. Submit Failure Translation and Origin Acknowledgement

- Added Lift submit error translation rules in the Lift adapter.
- Translated submit failures now include:
  - category
  - operator-facing message
  - suggested action
  - retryable flag
  - original source message
- Submit attempts persist translated error details with the normalized response.
- Accepted submit attempts now promote the job state to `Submitted`.
- Rejected or transport-error submit attempts now promote the job state to `Submit Failed`.
- Manual Import now shows translated submit failure guidance in the Submit Certification panel.
- Added `docs/ORIGIN_ACKNOWLEDGEMENT_MODEL.md` to record the recommended origin-system contract:
  - return `202 Accepted` when Pathfinder receives and persists an inbound order
  - track downstream Lift submission separately
  - surface `Submit Failed` jobs for manual correction and replay
  - add optional outbound callbacks later for `received`, `submit_failed`, `submitted`, and `completed`

### 19. Job Detail and Replay Controls

- Added a job detail API endpoint:
  - `GET /api/customers/:liftCustomerId/jobs/:jobId`
- Job detail returns the persisted preview job and submit attempts for that job.
- Job IDs are now clickable from:
  - Customer Overview recent jobs
  - Customer Jobs
  - Dashboard recent jobs
  - Global Jobs
- Added an in-app Job Detail panel showing:
  - job/customer/source summary
  - submit profile and submit customer
  - latest submit attempt
  - submit attempt history
  - submit certification snapshot
  - product resolution results
  - source sheet/row summary
  - Canonical Order JSON
  - Lift payload and masked headers
- Added deliberate retry behavior from Job Detail:
  - retry is enabled for `Ready` and `Submit Failed` jobs
  - retry sends a fresh idempotency key so it records a new attempt
  - prior attempts remain available in history
- Added `order_lookup_url` to Output Routes and the Output Routes UI as the future home for Lift flush/order lookup configuration.

### 20. Lift Order Number and Lookup Endpoint Groundwork

- Expanded Lift submit response normalization to detect Lift-style order number fields, including:
  - `ORDER_NUMBER`
  - `order_number`
  - `orderNumber`
  - `lift_order_number`
  - nested response objects such as `rowset`
- Added `target_order_number` to persisted preview jobs.
- Accepted submit attempts now promote the returned Lift order number onto the Pathfinder job.
- Jobs tables and Job Detail now display the Lift order number when available.
- Added `docs/LIFT_ORDER_LOOKUP_ENDPOINTS.md` to record the AS360 Orders, AS360 Proof Report, and Package Details endpoints, filters, returned data, and shared `ORDER_NUMBER` / `ORDER_LINE_ID` join model.

### 21. July 11 Submit Path Audit

- Audited the Manual Import path from uploaded/source grid data through preview, product resolution, submit certification, and guarded Lift submit.
- Changed the submit profile fallback to prefer an enabled sandbox profile before a live customer profile.
  - This makes `Sandbox · LTL Demo / 1249` the default for Monday's first real submit path.
  - Live customer submits remain blocked unless explicitly enabled with `PATHFINDER_ALLOW_LIVE_CUSTOMER_SUBMIT=true`.
- Local API smoke results:
  - preview defaults to submit profile `Sandbox · LTL Demo`
  - generated Lift payload uses `customer.lift_customer_id = 1249`
  - `Ext_ID` header equals body `order.ext_id`
  - `Company` header remains `91`
  - passwords remain masked in API responses
  - unmapped product keys keep preview state at `Needs Mapping`
  - approved product keys allow preview state to reach `Ready`
  - guarded submit refuses to call Lift until credentials, live transport mode, and the external submit gate are enabled
- Documented the Monday test checklist in `docs/FIRST_LIFT_SANDBOX_SUBMIT_READINESS.md`.

## Current Verification

Most recent verification for the July 11 submit path audit:

- `npm run check` passed.
- `npm run build` passed.
- API smoke check passed:
  - generated a preview job with the sandbox submit profile fallback
  - confirmed submit customer and Lift payload customer `1249`
  - confirmed `Ext_ID` header equals body `order.ext_id`
  - confirmed Company header `91`
  - confirmed password masking
  - confirmed unresolved product mappings block submit readiness
  - approved a generated Momentara product key and regenerated a `Ready` preview
  - confirmed the guarded submit endpoint still blocks without credentials/live transport/feature gate

Previous verification for the Lift order number and lookup endpoint groundwork slice:

- `npm run check` passed.
- `npm run build` passed.
- Adapter smoke check passed:
  - direct `ORDER_NUMBER` response detected as the Lift order id
  - nested `rowset[0].ORDER_NUMBER` response detected as the Lift order id

Previous verification for the actionable certification / gated submit slice:

- `npm run check` passed.
- `npm run build` passed.
- API smoke check passed:
  - generated a preview job
  - called the guarded submit endpoint
  - confirmed `409` response for unresolved blockers
  - confirmed response includes actionable blocker keys such as `product-map`, `field-mapping`, and `target-environments`
  - confirmed no external Lift request is made

Previous verification for the submit certification checklist slice:

- `npm run check` passed.
- `npm run build` passed.
- API smoke check passed:
  - generated a preview job
  - confirmed `submit_certification.can_submit = false`
  - confirmed route-level endpoint, `Ext_ID`, and Company checks pass
  - confirmed unresolved preview/product/credential/gate blockers are visible

Previous verification for the route-aware submit readiness slice:

- `npm run check` passed.
- `npm run build` passed.
- API smoke check passed:
  - switched the customer output route to the `PROD` Lift environment
  - generated a preview with `Sandbox · LTL Demo`
  - confirmed submit customer `1249`
  - confirmed endpoint `http://prod-lifterp/lifterp/ords/lifterp/lift/erp/api/create_order`
  - confirmed Company header `91`
  - confirmed password remains masked
  - restored the local route to QA1 after the smoke test

Previous verification for the output template field detection slice:

- `npm run check` passed.
- `npm run build` passed.

Previous verification for the sandbox submit profile slice:

- `npm run check` passed.
- `npm run build` passed.
- API smoke check passed:
  - posting a preview job with `submit_profile_id = sandbox-ltl-demo-1249` keeps source customer `Empirical - Momentara / 284619`
  - generated submit customer is `LTL Demo / 1249`
  - Lift payload customer id is `1249`
  - Canonical Order keeps Pathfinder/source customer id as `lift:284619`
  - job records `sandbox: true`

Previous verification for the target/output-template management slice:

- `npm run check` passed.
- `npm run build` passed.
- API smoke checks passed:
  - targets load with environments, output templates, and routes
  - target environment changes save through `/api/targets/:targetId`
  - output template changes save through `/api/targets/:targetId`
  - password-like values remain masked in target responses
  - Lift/91 route settings remain available for preview generation
- UI checks passed:
  - Targets tabs render for Overview, Environments, Output Templates, Output Routes, and Test & Health
  - Environment settings expose QA1/PROD endpoint, auth, company, user, password, and header fields
  - Output Templates expose body/header editor areas and filename supported tags
  - Output Routes shows the Lift/91 Standard Graphics route
  - Customer Import Method route selector still uses the route model
  - Output Product Map remains route-scoped
  - Targets Overview lists both Lift ERP and ThinkDifferentPrint
  - selected target detail scopes Environments, Output Templates, Output Routes, and Test & Health to the chosen target
  - Add Target opens a draft target detail with scoped tabs and Save Target
  - selected output template detail shows detected placeholders and Canonical Order dropdowns
  - mapped preview renders template tokens as selected Canonical Order values

Previous verification for the product resolution slice:

- `npm run check` passed.
- `npm run build` passed.
- API smoke checks passed:
  - Momentara workbook parses all tabs
  - only rows with valid `Print QTY` become order lines
  - no-quantity rows are retained as reference/catalog rows
  - unresolved product keys produce `Needs Mapping`
  - approved product mappings regenerate as `Ready`
  - Lift payload lines use resolved `unit_number`
  - Lift `Ext_ID` header matches body `order.ext_id`
  - password remains masked in API responses
- Import method management smoke checks passed:
  - Google Sheet source settings persist
  - `Inactive` status persists
  - delete archives methods instead of hard-deleting them
  - visible method list excludes archived methods
- In-app browser QA passed for Import Methods:
  - edit/duplicate/delete controls render
  - Google Sheet, PDF PO, and Inactive options render
  - field mapping shows found input elements with sample values
  - product resolution switches between strategy-specific controls
  - composite columns render as selectable/removable chips instead of a free-text field
  - Product Resolution downstream controls remain aligned across Derived, Composite, and Direct Lift unit strategies
  - fallback controls are hidden and no hidden fallback key is generated during preview
  - live example output updates from current resolver settings and source sample values
  - example output shows only strategy/mode-relevant cards
  - typing `2 Sheet Poster` as a `SIGN TYPE` test value produces `MOMENTARA__2_SHEET_POSTER`
  - save buttons remain right-edge aligned
  - no console errors or horizontal overflow
- In-app browser QA passed for Lift Unit Map:
  - customer nav exposes the new Lift Unit Map page
  - search, status filter, bulk assignment controls, and inline row editing render in the Vornan interface
  - visible rows can be selected for bulk operations
- Route scoping implementation verification:
  - import methods now carry an `output_route_id`
  - product mappings normalize with route metadata and product identifier fields
  - preview jobs resolve product mappings against the import method's output route
  - the same customer product key can be stored separately per route
- Visual automation note: Playwright package was present, but the local Chromium executable was not installed, so browser screenshot capture was skipped for this slice.

Known non-blocking notes:

- Vite reports a large bundle warning due to the current bundled dependency shape.
- `npm install` reported one high severity audit item; not investigated in this slice.
- Local runtime state is intentionally ignored via `data/*.local.json`.

## Next Recommended Milestones

### Sprint 1: Stabilize The Current MVP

- Commit the current working state.
- Add a short architecture note for:
  - Target
  - Environment
  - Output Template
  - Output Route
  - Submit Profile
- Add a Canonical Order field dictionary so template mapping has a clear source of truth.
- Add a “Reset to Lift sample template” affordance for Output Templates.
- Add clearer warning states for unmapped output template fields.
- Start a light frontend refactor so the large `App.tsx` surface is split into customer, target, import, and mapping components.

### Sprint 2: Lift Product Catalog Groundwork

- Import or mirror searchable Lift product/unit-number data.
- Let Output Product Map search approved Lift unit numbers instead of relying only on typed values.
- Support bulk assignment from discovered customer values to real Lift unit numbers.
- Show product source/status so operators know whether a unit number is approved and current.
- Keep preview jobs out of `Ready` unless route product identifiers resolve to valid approved values.

### Sprint 3: Preview Job Maturity

- Add a real job detail screen.
- Show the full review chain:
  - source rows
  - parsed rows
  - field mapping
  - product resolution
  - Canonical Order
  - target payload/body
  - headers
  - validation messages
- Add clearer workflow states:
  - Ready
  - Needs Mapping
  - Needs Field Mapping
  - Invalid Template
  - Failed
- Add regenerate-preview behavior after mappings, product maps, or target settings change.

### Sprint 4: Real QA1 Submit

- Add real external Lift transport behind the existing submit certification and feature gate.
- Start with Sandbox `LTL Demo / 1249` submit only, likely against PROD if the Lift integration mapping is first built there.
- Persist real Lift responses into the submit attempt record.
- Add retry/replay from persisted jobs.
- Expand from sandbox submit to live customer submit only after sandbox behavior is proven.

### Sprint 5: Production Foundation

- Replace the local JSON store with a production database layer.
- Add auth, users, and roles.
- Move credentials/secrets into proper secret storage.
- Add audit history for config changes, mappings, previews, and submits.
- Split backend behavior into clearer services:
  - customer directory
  - import parser
  - product resolver
  - template renderer
  - target adapter
  - job submitter

### Current Recommendation

Proceed next with Lift transport response handling and credential readiness, then run a controlled sandbox submit once credentials, product mappings, and integration-team mapping expectations are confirmed.

## 2026-07-11 - First Lift Sandbox Submit Readiness

Implemented a submit-readiness pass focused on the first real Lift submit through Momentara's Manual XLSX import using the sandbox lane.

What changed:

- Added [First Lift Sandbox Submit Readiness](./FIRST_LIFT_SANDBOX_SUBMIT_READINESS.md).
- Submit certification now blocks unless the selected Target Environment is Active.
- Submit certification now blocks unless `PATHFINDER_LIFT_TRANSPORT_MODE=live`.
- Submit certification now requires the sandbox submit profile by default.
- Live customer submit now requires explicit `PATHFINDER_ALLOW_LIVE_CUSTOMER_SUBMIT=true`.
- Submit attempts now recompute the current certification from the current route, target environment, submit profile, endpoint, headers, and credentials at submit time instead of trusting a stale preview snapshot.
- The local UI certification fallback was updated to match the new API gates.

Verification:

- `npm run check`
- `npm run build`

Known readiness note:

- The current Lift submit body is still generated by Pathfinder's Lift Standard Graphics payload builder. Confirm this generated payload matches the JSON body mapped by the Lift integration team before the first production-endpoint sandbox submit.

## 2026-07-11 - Preload Customer Product Map

Implemented a production-oriented preload utility for expected customer product lists.

What changed:

- Output Product Map now includes a **Preload Customer Product List** workflow.
- Operators can paste delimited data or upload `.xlsx`, `.xls`, or `.csv` product lists.
- Preload preview uses the selected route/import method Product Resolution setup to generate customer product keys.
- Preview rows are classified as `New`, `Update`, `Duplicate`, or `Missing key` before saving.
- Operators can save all valid rows or select specific preload rows.
- Preloaded records persist into the same route-scoped product map used by order previews.
- Product map records now track source metadata:
  - `Observed order`
  - `Preloaded catalog`
  - `Manual entry`
- Output Product Map table now shows each mapping source and source file/name.

Verification:

- `npm run check`
- `npm run build`

Next useful enhancement:

- Add a searchable Lift unit-number picker so preloaded rows can be assigned from an approved Lift product catalog instead of typed manually.

## 2026-07-11 - Approved Lift Unit Catalog Picker

Implemented a route-aware approved Lift unit picker for Output Product Map.

What changed:

- Added a local-file-backed `LiftUnitCatalogItem` model.
- Seeded the first approved unit catalog entries for Lift company `91`.
- Added `GET /api/lift/unit-catalog` with target, company, search, and active/inactive filters.
- Output Product Map now includes an **Approved Lift Unit Catalog** search panel.
- Operators can:
  - search approved unit numbers by unit, product name, category, or description
  - fill the bulk assignment fields from a catalog item
  - assign a catalog item directly to selected customer keys
  - use a catalog item as the preload default identifier

Verification:

- `npm run check`
- `npm run build`

Next useful enhancement:

- Replace or augment the local catalog seed with a Lift-backed unit/product endpoint once available.

## 2026-07-11 - Manual Import To Submit Plumbing Audit

Audited the path from Manual Import through product resolution, route-scoped product mapping, Canonical Order, Lift payload generation, submit request construction, and submit certification.

Fixes made:

- Workbook previews now respect parser output when no valid order rows are detected. If the workbook parser sends an empty `parsed_order_rows` array, the API no longer falls back to treating all grid rows as order rows.
- Lift payload generation now receives the real persisted `job_id` and canonical order id instead of defaulting to `job_preview` / `co_preview`.
- `direct_lift_unit_number` product resolution now uses the source value directly as the route product identifier instead of requiring an unnecessary product-map approval.
- Product map observation history now preserves existing examples and prepends the newest seen order row, instead of replacing preload/manual history.
- Submit certification now includes a generic submit request validation gate.
- Sandbox submit certification now blocks if the current sandbox submit profile customer does not match the customer in the stored Lift payload.
- Operator-facing copy now describes the unit picker as a local unit-number library rather than implying a live Lift-verified catalog.

Verification:

- `npm run check`
- `npm run build`

Remaining known concern:

- Output Template body rendering is still not the submit engine; Lift submit uses the generated Lift Standard Graphics payload. Confirm the generated payload remains aligned with the Lift integrator's mapped body before first live sandbox-lane submit.

## 2026-07-11 - Customer Overview Header Controls

Wired the customer overview header controls so the polished shell now performs useful workspace actions.

What changed:

- Renamed **Recent Processing Jobs** to **Recent Jobs** on the customer overview.
- Routed **View all jobs** to the selected customer's Jobs tab.
- Turned the header Environment control into a primary output-route environment selector.
- Environment changes persist to the selected customer's primary route and prompt the operator to regenerate previews.
- Added a workspace notifications popover with actionable items for product mapping gaps, failed jobs, submit gate blockers, missing endpoint setup, and workspace messages.
- Added a customer Actions menu for Manual Import, Preview Job generation, Product Map, Import Methods, Customer Jobs, and Output Route management.

Verification:

- `npm run check`
- `npm run build`

## 2026-07-11 - Output Product Map Declutter Pass

Refocused the Output Product Map page around the core mapping rows and search workflow.

What changed:

- Moved **Preload Customer Product List** out of the default page flow into a modal launched from the product map header.
- Moved **Local Unit Number Library** into a modal launched from the product map header.
- Kept the unit library functional for filling bulk assignment values, assigning selected rows, and setting preload defaults.
- Kept preload parsing, previewing, selection, and save behavior intact while removing it from the default mapping workspace.
- Added compact header actions so the primary visible surface is now search/filter, route context, bulk assignment, and the product mapping table.

Verification:

- `npm run check`
- `npm run build`

## 2026-07-11 - Template Constants And Manual Import Flow

Clarified two operator-facing areas that were creating unnecessary uncertainty.

What changed:

- `source.platform` now maps to an explicit **Pathfinder platform** system value instead of looking like an unresolved pasted/static value.
- Header `Content-Type` now maps to an explicit `application/json` header preset.
- Template previews render those constants as literal values, not `{{...}}` dynamic tokens.
- Manual Import now starts with a four-step workflow guide: load source, generate preview, fix blockers, submit to Lift.
- Manual Import cards now use a dedicated layout that gives the upload/preview action the lead role and treats validation, certification, and Lift target as supporting readiness context.

Verification:

- `npm run check`
- `npm run build`

## 2026-07-11 - Manual Import Visual Polish

Tightened the Manual Import flow layout after reviewing the working page.

What changed:

- Upload Order Source, Preview Validation, and Lift Submit Target now share the same top-row visual height.
- Submit Certification now sits below as the next readiness section instead of creating a staggered card rhythm.
- Fixed the Submit Profile status chip so the Customer/Sandbox label is vertically centered and keeps its proper status color.

Verification:

- `npm run check`
- `npm run build`

## 2026-07-13 - Canonical And Lift Field Expansion

Added the fields identified with the Lift integration team as additive canonical and Lift Standard Graphics payload fields.

What changed:

- Added top-level `contacts[]` with first name, last name, title, email, mobile, office, home, Slack, and fax fields.
- Added `customer.crm_id`.
- Added `order.due_date` and `order.order_attachment`.
- Added shipping account billing ZIP/country fields on the shared shipping shape.
- Added `lines[].product_id`.
- Extended the manual field mapping target list and source-column aliases so these fields can be mapped from imports.
- Extended Lift Standard Graphics payload generation and examples so the fields are sent to Lift.
- Added a standard-template normalization pass so existing local Lift Standard Graphics templates pick up missing fields/mappings without replacing configured template values.

Verification:

- `npm run check`
- `npm run build`
- Local payload smoke confirmed the new fields are present in the generated Lift payload.
- Local target-template smoke confirmed the existing standard template exposes the new fields and mappings.

## 2026-07-13 - Lift Customer Status Enrichment

Added the Lift CustomerStatusJSON endpoint as a second customer-directory enrichment source.

What changed:

- Customer refresh now merges Lift customer status data into the existing customer list by Customer ID or customer number.
- Added CRM ID, terms, terms status, credit limit, credit hold, unpaid total, and available credit to the customer model.
- Normalized the endpoint's `AVILABLE_CREDIT` field spelling into Pathfinder's `available_credit`.
- Customer Overview now surfaces the enriched values, and customer search includes CRM/terms fields.
- Canonical order generation can now populate `customer.crm_id` from the enriched selected customer when the source file does not provide it.
- The enrichment endpoint is non-blocking; if it fails, the customer list still loads with a warning.

## 2026-07-13 - Lift Standard Graphics Body Shape Cleanup

Aligned the Lift Standard Graphics output body with the current Momentara/Lift mapping expectations.

What changed:

- Standard body template order is now `customer`, `contacts`, `source`, `order`, `lines`.
- `order.due_date` and `order.order_attachment` now sit inside `order` before `order.shipping`.
- Removed `lines[].shipping` from the Standard Graphics body template, sample payload, template mappings, and generated Lift payload.
- Existing saved Standard Graphics templates are normalized into the cleaned hierarchy when loaded.

## 2026-07-13 - Output Route Value Normalization

Added route-scoped value rules for controlled Lift field values.

What changed:

- Output routes now store `value_normalization_rules`.
- Seeded Lift / 91 Standard Graphics with shipping method aliases: `UPS Ground`, `Ground`, and `UPS GND` normalize to `UPS Ground`.
- Added a Target setup **Value Rules** tab for editing route-specific field, customer aliases, Lift value, match mode, fallback behavior, and status.
- Lift preview generation applies route value rules before validation, submit-request preview, job persistence, and external submit.
- Strict value rules add blocking validation messages when an unmapped controlled value would be sent to Lift.

## 2026-07-14 - Lift Proof Report Lookup

Added internal proof-report lookup plumbing for Lift orders.

What changed:

- Output routes now store an optional Lift Proof Report URL alongside the Lift Order Lookup URL.
- Added a shared Lift adapter URL builder for the AS360 proof report endpoint using `p1` for order number and optional `p2` for order line ID.
- Added `GET /api/customers/:liftCustomerId/jobs/:jobId/proof-report` to fetch proof records for a submitted Lift order.
- Proof report rows are grouped by order, line, attachment, and proof filename so repeated comment rows appear as comment history on a single proof.
- Job detail now includes a **Lookup Proofs** action and displays proof filename, line, product, approval status, comment count, and low/high proof links.
- The first implementation is internal-only; a public customer order status page remains a later phase.

## 2026-07-14 - Output Route Diagnostics

Added route-scoped readiness diagnostics for target/output-route setup.

What changed:

- Added a local route diagnostics model that evaluates route status, environment status, create-order endpoint, saved credentials, company/account value, output template state, template mappings, product identifier strategy, submit profiles, order lookup URL, proof report URL, product catalog readiness, and value rules.
- Targets → Output Routes now shows a diagnostics summary, pass/warning/block counts, and actionable fix buttons per route.
- Customer Overview Primary Target and Manual Import Lift Submit Target now show compact route readiness details.
- Dashboard route scope now uses the selected route diagnostics so route/environment changes are reflected consistently.
- Masked saved credentials now count as configured for route diagnostics, avoiding false warnings after secrets are saved.

## 2026-07-14 - Lift Package Details Lookup

Added internal PackageDetails lookup plumbing for Lift orders and shipments.

What changed:

- Output routes now store an optional Lift Package Details URL alongside order lookup and proof report URLs.
- Added a shared Lift adapter URL builder for the PackageDetails endpoint using `p0` for order number and optional `p1` for order line ID.
- Added `GET /api/customers/:liftCustomerId/jobs/:jobId/package-details` to fetch package and tracking rows for a submitted Lift order.
- Package rows are deduped by order, line, shipping id, box number, and tracking number.
- `NEGOTIATED_RATE` is redacted server-side from both normalized package rows and the debug/raw payload returned to the UI.
- Job detail now includes a **Lookup Packages** action and displays line, box, product, tracking number, ship method, and tracker message.
- Route diagnostics now warn when the Package Details URL is missing or invalid.

## 2026-07-14 - Internal Order Snapshot

Added a unified internal order snapshot for submitted/submit-ready jobs.

What changed:

- Added `GET /api/customers/:liftCustomerId/jobs/:jobId/order-snapshot` to combine the Pathfinder preview job, submit history, Lift order lookup, proof report, and package details into one payload.
- Snapshot lines now summarize product identifiers, quantities, proof counts, package counts, latest proof status, and latest tracking message.
- Missing or failed lookup sources are returned as structured snapshot issues instead of blocking the full snapshot when partial data is still useful.
- Package data continues to redact internal `NEGOTIATED_RATE` values before it reaches the UI or snapshot payload.
- Job detail now includes an **Order Snapshot** action with a compact summary and full internal JSON payload.
- The snapshot includes an explicit visibility policy marking it internal-only while public customer order status remains a future phase.

## 2026-07-14 - Lift Product Catalog Picker Polish

Improved the Output Product Map workflow for mapping customer keys to Lift products.

What changed:

- Lift product catalog cache lookup now supports product type, accounting item code, parent product id, catalog id, product id, status, route, company, and text search filters.
- Lift API refresh translates Pathfinder's `Active` / `Inactive` product filters to Lift's `A` / `I` status query values.
- Output Product Map's row-level **Map Product** action now opens the catalog picker in focused mode for that customer key.
- The catalog picker now shows the mapping target, route-aware product identifier behavior, and filters for status, product type, and catalog.
- Selecting a catalog item can map one focused customer key or continue to bulk-assign selected keys.

## 2026-07-14 - Product Identifier Strategy Copy Cleanup

Tightened product identifier language across customer setup and dashboards.

What changed:

- Product Resolution examples now label the submitted value using the active output route's product identifier strategy.
- Direct product identifier setup now shows `Lift unit_number Column` or `Lift product_id Column` based on the selected route instead of always saying unit number.
- Dashboard route scope now labels the route choice as **Product Mapping Strategy** rather than generic Product ID.
- Placeholder text for direct identifier examples now follows the selected route strategy.

## 2026-07-14 - Canonical Registry Foundation

Added the first production-grade foundation for canonical schema management.

What changed:

- Added a shared Canonical Field Registry to `@pathfinder/canonical` with stable field IDs, paths, labels, sections, data types, required/repeatable flags, statuses, and aliases.
- Pointed template mapping field lists at the shared canonical registry field paths instead of maintaining a separate hardcoded list.
- Added `GET /api/canonical-registry` for registry metadata, sections, field count, and field definitions.
- Replaced the placeholder Global Settings panel with a Canonical Order registry screen showing metrics, section chips, search, filters, and field rows.
- Kept schema editing disabled in this slice while establishing the stable read model needed for future add/rename/reorder/remove workflows.

## 2026-07-14 - Canonical Registry Dropdown Consumers

Connected mapping dropdowns to the Canonical Field Registry.

What changed:

- Import Method field mapping and Manual Import mapping now show grouped canonical field options by registry section.
- Output Template field mapping now shows canonical registry fields with readable labels while retaining compatibility tokens for existing template mappings.
- Value Rule canonical field selection now uses the same grouped registry options.
- This keeps existing stored mapping values intact while improving usability for non-technical setup work.

## 2026-07-14 - Canonical Registry Draft Field Edits

Added the first safe editing layer for canonical field metadata.

What changed:

- Added local JSON persistence for Canonical Registry field overrides.
- Added `PUT /api/canonical-registry/fields/:fieldId` for label, description, aliases, and status updates.
- Updated the Global Settings Canonical Order registry table with inline edit controls.
- Kept canonical field IDs and paths locked so existing input mappings, output template mappings, and value rules continue to resolve without breaking.
- This establishes the editable registry pattern before moving into higher-risk schema operations such as add, rename path, reorder, deprecate, and remove.

## 2026-07-14 - Canonical Registry Custom Draft Fields

Added local custom field creation for the Canonical Order registry.

What changed:

- Added custom canonical fields to the local registry store alongside source-defined fields.
- Added `POST /api/canonical-registry/fields` for Draft field creation with path, section, data type, alias, required, and repeatable metadata.
- Updated the Settings registry screen with a compact Create Draft Field panel.
- Returned custom fields through the same registry API used by mapping dropdowns, so newly created fields become selectable mapping targets.
- Added supplemental canonical order mapping support so custom mapped paths are preserved in generated canonical order previews without changing the typed core schema.

## 2026-07-14 - Web Bundle Chunk Split

Removed the Vite production chunk-size warning by lazy-loading workbook parsing.

What changed:

- Changed workbook parsing in `@pathfinder/templates` to dynamically import `xlsx` only when a workbook is uploaded.
- Updated manual import and preload catalog upload flows to await the async parser.
- Reduced the initial web JavaScript chunk from roughly 764 KB to roughly 429 KB.
- Split the XLSX parser into a separate on-demand chunk, keeping dashboard and setup pages lighter on first load.

## 2026-07-14 - Canonical Registry Field Lifecycle Guardrails

Added guarded lifecycle controls for custom canonical fields.

What changed:

- Marked registry fields as Core or Custom in API responses and the Settings registry table.
- Added `DELETE /api/canonical-registry/fields/:fieldId` for safe removal of Draft custom fields only.
- Protected source-defined Core fields from deletion through the API and UI.
- Added a Remove action only when a custom field is still Draft; active fields should be deprecated instead of removed.

## 2026-07-14 - Canonical Registry Rename Safety

Added usage visibility and guarded custom field path renaming.

What changed:

- Added usage counts to Canonical Registry API responses for import method mappings, saved mapping templates, output template mappings/tokens, and value rules.
- Added a custom-field path rename endpoint that migrates saved mapping references from the old path to the new path.
- Kept historical preview/submission job snapshots unchanged for audit accuracy.
- Added inline path rename controls for custom fields in the Settings registry table.
- Preserved the old path as an alias on renamed custom fields so users can still search by the previous name.

## 2026-07-14 - Canonical Registry Versioning and Export

Added a lightweight governance layer for canonical schema changes.

What changed:

- Added local registry change history for field metadata edits, custom field creation, draft removal, and custom path renames.
- Added bounded local registry snapshots so each saved schema change records the effective field contract at that moment.
- Added `GET /api/canonical-registry/export?format=json|csv` for downloadable registry exports.
- Updated Settings with export actions and a Registry Governance panel showing the latest snapshot and recent schema changes.
- Kept export responses focused on schema metadata and mapping usage; credentials and target secrets remain outside the registry export.

## 2026-07-14 - Canonical Registry Impact Review

Added review and recovery controls around canonical schema changes.

What changed:

- Added snapshot detail, snapshot-specific JSON/CSV export, and current-vs-snapshot comparison endpoints.
- Added an Impact Review modal before canonical field metadata edits, custom path renames, and Draft custom field removals.
- Replaced browser confirm prompts with an app-native review step showing affected mappings, template tokens, and value rules.
- Added a Settings snapshot detail modal with export actions, diff counts, and captured field preview.
- Kept restore destructive actions out of scope; compare is read-only groundwork for future recovery workflows.

## 2026-07-16 - AWS Production Hosting and Public Status Plan

Documented the recommended production rollout for Pathfinder hosting, authentication, durable API infrastructure, and public order status links.

What changed:

- Added `AWS_PRODUCTION_HOSTING_AND_STATUS_PLAN.md`.
- Defined `pathfinder.vornan.co` as the authenticated internal Pathfinder app.
- Recommended `status.vornan.co` for public tokenized order status pages, with `go.vornan.co` reserved for future short-link or redirect workflows.
- Captured the AWS target architecture: S3, CloudFront, API Gateway, Lambda, DynamoDB, Secrets Manager, CloudWatch, and optional queue/scheduler services.
- Captured Firebase Google Auth requirements for `ltlco.com` and `vornan.co` users.
- Captured public status token rules, sanitized customer-facing order payloads, and the rule that internal shipping-rate data must never be exposed.
- Broke the work into early-next-week implementation phases covering hosting, auth, API shell, durable storage, Lift submit, and public status foundations.

## 2026-07-16 - Lift Catalog Fuzzy Search

Improved Lift product catalog lookup so Pathfinder can provide a forgiving search experience even though the Lift API only supports exact query parameters.

What changed:

- Added fuzzy-ranked product catalog matching for cached Lift catalog results.
- Kept Lift API filters as the upstream scope control, such as catalog ID, product ID, exact product name, product type, and status.
- Changed the Output Product Map catalog search field to filter the already-loaded result set locally instead of sending every typed search term back to Lift.
- Ranked exact product IDs, unit numbers, and accounting item codes first, followed by product-name phrase, token, and fuzzy matches.
- Preserved the pinned catalog workflow so users can fetch a known catalog, then quickly narrow products with forgiving search terms.

## 2026-07-16 - Mapping-First Lift Catalog Drawer

Reorganized the Output Product Map Lift catalog drawer around the actual mapping workflow instead of generic catalog browsing.

What changed:

- Made row-driven `Map Product` the primary workflow for assigning a Lift product to a Pathfinder customer key.
- Added an explicit `Map Selected` bulk action for assigning one Lift product to several selected customer keys.
- Moved fuzzy product search into the results section so it clearly filters the already-loaded Lift result set.
- Collapsed catalog presets, exact Lift API filters, status, product type, and cached catalog controls into a quieter `Lift catalog scope` section.
- Added a compact mapping context strip showing the Pathfinder key, source value, and current mapping before a user chooses a Lift product.

## 2026-07-17 - Lift Catalog Scope Simplification

Cleaned up the Output Product Map catalog scope controls after live mapping review.

What changed:

- Replaced the noisy catalog scope drawer section with a simpler catalog selector, Catalog ID field, and single `Refresh from Lift` action.
- Moved less common status, product type, cached catalog, and exact API parameter controls behind `Advanced filters`.
- Removed manual catalog-name entry from the workflow; catalog names now come from Lift product payloads or existing saved presets.
- Prevented duplicate pinned catalog display for the same output route/catalog ID.
- Updated product details to show Lift payload fields directly when available, avoiding duplicated normalized fields like `unit_number` and `unit_numbers`.

## 2026-07-17 - Import Method Source-First Setup

Reworked Import Methods so source structure is explicit before product resolution and field mapping.

What changed:

- Added a selected-method workspace strip so the page reads as a list first, then setup sections for the active import method.
- Added a Source Setup panel showing whether column options come from sample/demo data or a loaded workbook.
- Added persisted parser controls for header row, quantity column, embedded/repeated header handling, and no-quantity reference rows.
- Wired workbook uploads to the active method parser settings so saved source setup affects the next XLSX parse.
- Improved workbook parsing to ignore embedded header-like rows such as Momentara's hardware subtable header inside the order sheet.
- Added source context directly above Product Resolution so users can see which columns and parser rules the resolver is using.

## 2026-07-17 - Import Methods List-First Navigation

Adjusted Import Methods to behave like a true setup workspace instead of showing every configuration section at once.

What changed:

- Made the Import Methods main page show only the method list and primary method actions.
- Changed method row and edit actions to open a selected-method detail view.
- Moved Method Setup, Source Setup, Product Resolution, and Field Mapping behind that selected-method detail view.
- Added an `All Import Methods` back action so users can return to the clean method list.
- Updated sidebar and overview links so they return users to the list view by default.

## 2026-07-17 - Import Method Single-Save Detail Flow

Simplified the Import Method detail workspace so users save the selected method as one coherent setup instead of saving each panel separately.

What changed:

- Added a method-level `Save Changes` action and saved/unsaved state chip in the selected import method header.
- Removed separate `Save Method`, `Save Source Setup`, `Save Resolver`, and `Save Field Mapping` buttons from individual panels.
- Kept panel-level actions focused on navigation or task flow, such as opening Manual Import.
- Made field mapping edits update the active method draft so they are included in the single save action.
- Cleared draft indicators after save, delete, or customer workspace reload to avoid stale unsaved states.

## 2026-07-17 - Persistence Guards And Target Single-Save Flow

Hardened the setup editing workflow so saved values persist predictably and draft state cannot silently leak into future sessions.

What changed:

- Fixed the customer header Environment control so changing QA1/PROD persists the target active environment and synced output route, not only the local route selection.
- Added explicit dirty tracking for target settings and customer output routes.
- Changed Targets detail to use one header-level `Save Changes` action for environments, templates, output routes, and value rules.
- Removed section-level save buttons from Targets panels and replaced them with notes that edits save from the target header.
- Added unsaved-change prompts when leaving Import Method detail or Target detail, with options to save, keep editing, or continue without saving.
- Hardened the import method API so stale or partial PUT requests to unknown method IDs cannot create surprise draft methods.

## 2026-07-17 - AWS Admin Web Deploy Foundation

Added the first production hosting implementation scaffold for `pathfinder.vornan.co`.

What changed:

- Added production-aware web API configuration through `VITE_API_BASE_URL`, preserving the local `http://127.0.0.1:3000` fallback.
- Added environment-configurable API CORS origins through `PATHFINDER_ALLOWED_ORIGINS`.
- Added `infra/aws/production-hosting.json` as the checked-in deployment manifest for Pathfinder admin, public status, API domain, and DNS targets.
- Added `scripts/deploy-admin-web.sh` and `npm run deploy:admin-web` to build and sync the admin app to `s3://vornan-pathfinder` with CloudFront invalidation support.
- Added a manual GitHub Actions workflow scaffold for deploying the admin web app once AWS deploy role, bucket, and distribution variables are configured.

## 2026-07-17 - Firebase Auth Gate Foundation

Added the first production auth gate for the Pathfinder admin app.

What changed:

- Added Firebase web auth support with Google sign-in and `ltlco.com` / `vornan.co` domain enforcement.
- Kept local development unblocked by bypassing the auth gate unless Firebase config or `VITE_AUTH_REQUIRED=true` is present.
- Added an opt-in API Firebase ID token verifier behind `PATHFINDER_REQUIRE_AUTH=true`, leaving `/health` public.
- Added bearer-token forwarding from the web app to the API once a signed-in Firebase user is available.
- Added `.env.example` entries and deploy workflow environment wiring for Firebase web config and API verification.

## 2026-07-17 - API Lambda Shell Foundation

Added the first Lambda-ready production API shell while preserving local Express development.

What changed:

- Exported the Express app from `apps/api/src/server.ts` and guarded `app.listen` so Lambda imports do not start a local server.
- Added `apps/api/src/lambda.ts` using `serverless-http` as the API Gateway/Lambda bridge.
- Added `npm run build:api-lambda`, which bundles the API handler with esbuild into `outputs/api-lambda/lambda.mjs`.
- Added a deploy-time customer seed file override through `PATHFINDER_CUSTOMER_SEED_FILE`.
- Documented the Lambda handler and required environment variables in README and `.env.example`.

## 2026-07-17 - API Gateway Deploy Scaffold

Added the first AWS deploy scaffold for the production API domain path.

What changed:

- Added `infra/aws/api-cloudformation.yaml` for API Gateway HTTP API, Lambda, IAM role, proxy routes, and stack outputs.
- Added `npm run package:api-lambda` to zip the generated Lambda bundle.
- Added `npm run deploy:api-lambda` to upload the artifact and deploy the CloudFormation stack.
- Added a manual GitHub Actions workflow for API deployment using `AWS_DEPLOY_ROLE_ARN` and `PATHFINDER_API_ARTIFACT_BUCKET`.
- Documented the required deployment environment variables in `.env.example` and README.

## 2026-07-17 - API Custom Domain + GoDaddy DNS Runbook

Extended the API deployment scaffold so the production API can be mapped to `api.pathfinder.vornan.co`.

What changed:

- Added optional API Gateway custom domain and API mapping resources to `infra/aws/api-cloudformation.yaml`.
- Added CloudFormation outputs for `CustomDomainRegionalTarget`, `CustomDomainRegionalHostedZoneId`, and custom-domain health URL.
- Wired `PATHFINDER_API_DOMAIN_NAME` and `PATHFINDER_API_CERTIFICATE_ARN` through local deploy and the manual GitHub Actions API deploy workflow.
- Added `docs/AWS_GODADDY_DNS_RUNBOOK.md` with GoDaddy DNS instructions for `pathfinder`, `api.pathfinder`, and `status` records.
- Linked the DNS runbook from README and the production hosting plan.

## 2026-07-17 - DynamoDB and Secrets Manager Infrastructure Foundation

Added the first durable storage and secret-management foundation for production hosting.

What changed:

- Added purpose-specific DynamoDB tables to `infra/aws/api-cloudformation.yaml` for customers, workspaces, targets, import methods, routes, product mappings, jobs, submit attempts, Lift product cache, order status tokens, order status snapshots, and canonical registry.
- Enabled pay-per-request billing, server-side encryption, and point-in-time recovery on production tables.
- Added scoped Lambda IAM permissions for the Pathfinder tables and the `/vornan/pathfinder/` Secrets Manager prefix.
- Added `PATHFINDER_STORAGE_DRIVER` and `PATHFINDER_SECRETS_DRIVER` deployment parameters that default to local behavior until the production adapters are implemented.
- Added `docs/AWS_STORAGE_AND_SECRETS_RUNBOOK.md` to document table names, secret naming, deployment variables, and flip criteria.

Follow-up hardening:

- Added runtime persistence driver metadata to `/health` so deployed environments can be checked quickly.
- Added explicit guards that block `dynamodb` and `secrets-manager` driver values until their adapters are implemented, preventing accidental production misconfiguration.

## 2026-07-17 - Secrets Manager Target Credential Adapter

Added the first production persistence adapter without moving the whole local JSON store.

What changed:

- Added a Secrets Manager-backed target credential store for saved target environment credentials.
- Preserved the existing local sidecar secret file for development.
- Kept DynamoDB storage guarded until the larger store migration is implemented.
- Updated the storage/secrets runbook with the one-secret-per-target shape and production driver setting.

## 2026-07-17 - AWS Bucket Bootstrap Script

Added a repeatable bootstrap step for Pathfinder production S3 buckets.

What changed:

- Added `scripts/bootstrap-aws-buckets.sh` and `npm run bootstrap:aws-buckets`.
- Standardized the production bucket names as `vornan-pathfinder`, `vornan-pathfinder-status`, and `vornan-pathfinder-artifacts`.
- The bootstrap script creates missing buckets and applies public-access blocking, AES256 server-side encryption, and versioning.
- Updated README, `.env.example`, the AWS storage runbook, and the production hosting plan so local and CI deployment commands use the same bucket names.

## 2026-07-17 - CloudFront Web Hosting Scaffold

Added the first deployable CloudFront hosting stack for Pathfinder web surfaces.

What changed:

- Added `infra/aws/web-cloudformation.yaml` for admin and public status CloudFront distributions backed by private S3 origins.
- Added Origin Access Control and bucket policies so public reads flow through CloudFront rather than direct S3 access.
- Added SPA fallback behavior for both distributions.
- Added `scripts/deploy-web-hosting.sh` and `npm run deploy:web-hosting`.
- Kept domain aliases and ACM certificate optional so hosting can be deployed before DNS validation is complete.

Deployment note:

- Deployed API Gateway/Lambda stack `vornan-pathfinder-api-prod`.
- Temporary API health URL: `https://dvhbk1kezg.execute-api.us-east-1.amazonaws.com/health`.
- Deployed CloudFront web stack `vornan-pathfinder-web-prod`.
- Admin CloudFront distribution: `E34F508KID3LHW` / `dgpk5x391g0c3.cloudfront.net`.
- Public status CloudFront distribution: `E13RHNZTC6PRRC` / `d2x5lokt6c28c4.cloudfront.net`.
- Deployed the current admin web build to `s3://vornan-pathfinder` using the temporary API Gateway base URL.

Follow-up:

- ACM certificate `arn:aws:acm:us-east-1:744016783602:certificate/86d6d1a5-669d-4f30-86c2-da57e802aa99` issued successfully after Cloudflare validation records were added.
- Redeployed CloudFront hosting with aliases for `pathfinder.vornan.co` and `status.vornan.co`.
- Redeployed API Gateway with `api.pathfinder.vornan.co`; final CNAME target is `d-dtf1ffa6fe.execute-api.us-east-1.amazonaws.com`.
- Redeployed the admin web app with `VITE_API_BASE_URL=https://api.pathfinder.vornan.co`.

## 2026-07-17 - First-Class Pathfinder Login Screen

Replaced the simple Firebase Auth gate with a polished Vornan/Pathfinder login surface for production access.

What changed:

- Added a responsive two-panel login screen using Vornan wordmark, Pathfinder source-faithful lockups, and compass artwork.
- Preserved Google Auth behavior, `ltlco.com` / `vornan.co` domain enforcement, loading state, configuration-missing state, and denied-domain state.
- Added clearer sign-in error handling and a disabled in-progress state for the Google sign-in action.
- Copied brand assets into `apps/web/public/brand/` from approved source assets without modifying source masters.
- Updated the admin web deploy script so production builds carry through `VITE_AUTH_REQUIRED`, `VITE_AUTH_ALLOWED_DOMAINS`, and Firebase web config environment variables instead of only `VITE_API_BASE_URL`.

Verification:

- `npm run check`
- `npm run build`

Deployment note:

- Local shell did not have Firebase web config environment values loaded, so the production login build should be deployed from an environment with the `VITE_FIREBASE_*` values available, such as the GitHub Actions deploy workflow secrets.

## 2026-07-17 - Production Auth Fails Closed

Tightened the admin web auth gate so the production portal cannot accidentally deploy open to the public.

What changed:

- Production web builds now require auth by default when `VITE_AUTH_REQUIRED` is omitted.
- Local development still remains open by default unless `VITE_AUTH_REQUIRED=true` is explicitly set.
- If production auth is required but Firebase web config is unavailable, the public app shows the private preview/coming-soon gate rather than the portal.
- Updated README production auth notes to document the fail-closed behavior.

## 2026-07-18 - Secure Public Status Request Flow

Added the first customer-facing order status request path and an internal lookup utility for authenticated Pathfinder users.

What changed:

- Added `POST /public/status/request-link` so `status.vornan.co` can accept an order number and email address, then issue a private tokenized status link when Pathfinder can safely match the request.
- Kept the public request response neutral whether or not an order is found, so the endpoint does not reveal which order numbers exist.
- Added an email association check using known customer/order/contact emails before creating public links.
- Added `PATHFINDER_STATUS_EMAIL_MODE=log` as the current delivery mode, with `PATHFINDER_PUBLIC_STATUS_RETURN_LINK=true` reserved for local smoke testing.
- Added authenticated internal order lookup on the admin Jobs page for any Pathfinder job by Lift order number, source order number, or submit Ext_ID.
- Updated the public status app so the default page asks for order number + email, while token URLs still render the order, proof, and package snapshot.

## 2026-07-18 - Multi-Order Public Status Requests

Extended the secure public status flow so customers can request several orders and receive one private status view.

What changed:

- Added `order_numbers` support to `POST /public/status/request-link`, with case-insensitive deduplication and a 10-order request limit while retaining legacy `order_number` support.
- Added a bulk job lookup path that preserves the latest Pathfinder match per requested order.
- Extended status token records with optional order references while retaining the original single-order fields for backward compatibility.
- Updated public token lookup responses to return `snapshots` plus the legacy primary `snapshot`.
- Kept access policy checks order-specific, so one link includes only the orders that the requesting email is permitted to view and the public response remains neutral.
- Updated transactional status emails for single- and multi-order subjects, copy, order lists, and customer lists without logging raw order numbers.
- Replaced the public status order-number input with a multiline, deduplicating request control and added a responsive order summary selector for individual details.

Verification:

- `npm run check`
- `npm run build`
- Plural email render assertion against the compiled email module.
- Local API smoke tests for neutral multi-order acceptance, the 10-order server limit, and invalid-token behavior.
- Desktop and 390px mobile browser checks, including no horizontal overflow and the client-side 10-order guard.

## 2026-07-18 - Output Product Map Row-Level Mapping

Completed the guided `Map Product` workflow for individual Pathfinder product-map rows.

What changed:

- Kept a clear `Map Product` action on every Output Product Map row and made the active row visually distinct while its Lift catalog drawer is open.
- Scoped the drawer to the selected Pathfinder key and its fuzzy Lift product search while preserving route catalog presets, advanced filters, refresh behavior, and product details.
- Made the active Lift catalog scope and route product identifier strategy explicit in the drawer.
- Added an exact-row save path through the single mapping endpoint; selecting a Lift product now writes the product name, product ID, unit number, and route-specific identifier to only that mapping row.
- Enforced route strategy boundaries so `product_id` routes cannot silently use a unit number and `unit_number` routes cannot silently use a product ID.
- Updated resolver and UI status logic so mappings created for a different route identifier strategy are treated as unresolved unless the correct supplemental identifier exists.
- Replaced unit-centric search/catalog language with `route product identifier` where the route may use `product_id`.
- Restored the route identifier column in catalog results and disabled save actions when a Lift product lacks the identifier required by the route.
- Made the Lift catalog drawer responsive below 1100px without changing the existing bulk mapping workflow.

Verification:

- `npm run check`
- `npm run build`
- Isolated local browser validation using a temporary store and disabled auth gate; no external Lift submit flags were enabled.
- Exact-row save assertion: one selected mapping changed to `Mapped` with its Lift unit number while the neighboring row remained unchanged.
- `product_id` route assertion: unit-only catalog products displayed `Product ID unavailable` and could not be saved.
- 390x844 browser validation with a 390px drawer, single-column scope layout, and no horizontal overflow.
- No browser console warnings or errors.

## 2026-07-18 - Output Route Strategy Migration Assistance

Added an explicit migration workflow for routes that change between Lift `unit_number` and `product_id` mapping strategies.

What changed:

- Added route-level mapping readiness to Output Route cards, including counts for rows that already contain the selected route identifier and rows that need remapping.
- Made unsaved strategy changes show the previous and newly selected identifier types before save.
- Clarified that Pathfinder preserves stored identifiers from the previous strategy and does not silently substitute or rewrite them.
- Added a `Save Changes & Review Remap Queue` path that persists the route and opens Output Product Map scoped to the exact route.
- Added a focused remap queue that contains only active mappings missing the selected route identifier while retaining the existing row-level `Map Product` and manual save behavior.
- Made the queue update automatically after exact-row saves and show an explicit completion state when every active mapping has the required route identifier.
- Kept bulk mapping, catalog presets, product details, and real Lift submit behavior unchanged.

Verification:

- `npm run check`
- `npm run build`
- `git diff --check`

- Local browser workflow against a disposable store:
  - a `unit_number` route with three mapping shapes reported `2 identifier ready / 1 need remap`
  - switching to `product_id` reported `2 identifier ready / 1 need remap` with the strategy-change warning
  - save-and-review opened a focused one-row queue
  - saving the missing Product ID removed that row and produced the clear-queue state
- Isolated API persistence assertion confirmed the remapped row retained `UNIT-ONLY-001` while adding `PROD-UNIT-001` and changing the route strategy to `lift_product_id`.
- Browser console contained only Chrome extension message-channel noise; no Pathfinder application error was observed.
- No real Lift submit flags were enabled and no external Lift request was sent.

## 2026-07-18 - Import Methods Single-Save Workflow

Hardened Import Methods into a list-first setup workflow with an explicit persistence boundary.

What changed:

- Kept the main Import Methods page focused on the method list and opened source, product-resolution, and field-mapping settings only for the selected method.
- Added a clearer table header, row-specific accessible actions, and responsive list/detail layouts.
- Kept new and duplicated methods as local drafts until the operator explicitly selects `Save Method`; duplicating no longer persists immediately.
- Added distinct `Not saved yet`, `Unsaved changes`, and `Saved` states around the single method-level save action.
- Added method-name and output-route validation before persistence.
- Added guarded in-app navigation with save, discard, and keep-editing choices, plus a browser refresh/close warning while method changes are dirty.
- Made discard reload the persisted workspace and added a local-only discard path for methods that have never been saved.
- Fixed method switching so an intentionally empty mapping set cannot inherit mappings from the previously selected method.

Verification:

- `npm run check`
- `npm run build`
- `git diff --check`
- Isolated local browser validation against a disposable store with auth disabled and real Lift submit flags left off.
- Confirmed a duplicate was absent from the API before save and persisted only after `Save Method`.
- Confirmed `Keep Editing` retained local changes and `Continue Without Saving` restored the persisted method.
- Confirmed blank-name save attempts did not alter persisted state.
- Confirmed both list and method-detail views had no horizontal overflow at 390x844.
- No browser console warnings or errors.

## 2026-07-18 - Persisted Import Source Schemas

Added customer-template detection to Import Methods so source columns can come from a saved workbook schema instead of only the current session or seeded samples.

What changed:

- Added an Import Method source-template drop zone for XLSX, XLS, and CSV files.
- Reused the existing workbook parser and current method parser settings to detect sheets, columns, order/reference row counts, and the selected sheet.
- Persisted schema metadata inside the method's `source_config` through the existing single `Save Method` boundary.
- Kept raw workbook rows and sample cell values out of persisted schema data; only file name and structural metadata are retained.
- Preserved canonical mappings for matching column names and auto-mapped recognized new columns when a template is detected.
- Added a deliberate `Use Sample Columns` reset that remains a guarded local draft until save.
- Hydrated the exact method's detected columns, sheet summary, and mappings when its detail workspace opens.
- Updated Manual Import workbook loading to reuse the active method's saved mappings for matching columns.
- Added responsive source-schema, sheet-summary, and parser layouts.

Verification:

- `npm run check`
- `npm run build`
- `git diff --check`
- Parser assertion against the existing CSV fixture confirmed the workbook parser detected the expected sheet and columns.
- Disposable API persistence assertion confirmed three columns and two sheets survived reload with no `rows` property in the saved schema.
- Local browser validation confirmed the saved schema, counts, and mappings hydrate into the selected method with no retained sample values.
- Confirmed `Use Sample Columns` did not change the API before save and that guarded discard restored the persisted template schema.
- 390x844 browser validation confirmed a single-column schema layout and no horizontal overflow.
- No browser console warnings or errors.

## 2026-07-19 - Multi-Row Header Detection And Schema Refresh

Hardened workbook header parsing and prevented saved Import Methods from drifting out of sync with their detected source schemas.

What changed:

- Added automatic header-row scoring so title and instruction rows above the real field headers can be skipped without a manual row number.
- Added explicit single-header and two-row grouped-header modes.
- Combined duplicated lower-level grouped labels with their parent heading, such as `Shipping Address` and `Billing Address`, while preserving recognized standalone field names.
- Continued filtering repeated/secondary header rows and now records their original row numbers for audit visibility.
- Added detected header row, header span, ignored-header rows, and the parser configuration snapshot to persisted schema metadata.
- Changed the Header Row override to optional; leaving it blank uses automatic per-sheet detection.
- Added schema freshness comparison across header row, header span, quantity column, repeated-header handling, and reference-row handling.
- Treats previously saved schemas without a parser snapshot as needing one refresh before further method saves.
- Marked mismatched schemas as `Refresh required`, disabled `Save Method`, and added `Re-detect Schema` when the local template is still available or `Upload Template Again` after reload.
- Kept sample-column reset as the explicit way to remove a detected schema without re-uploading.

Verification:

- `npm run check`
- `npm run build`
- `git diff --check`
- Generated-workbook parser assertions:
  - automatic single-row detection selected row 3 below title/group rows
  - automatic two-row detection selected rows 2-3
  - a repeated header at row 5 was ignored and recorded while two order rows remained
  - duplicated grouped labels produced `Shipping Address`, `Shipping City`, `Billing Address`, and `Billing City`
- Disposable API assertion confirmed header row, span, ignored-row audit data, and parser configuration persisted.
- Local browser validation confirmed saved audit metadata, stale-schema warning, upload-again fallback, disabled save, guarded sample reset, and discard restoration.
- 390x844 browser validation had no horizontal overflow.
- No browser console warnings or errors.

## 2026-07-19 - Per-Sheet Header Overrides And Parser Regression Suite

Extended Import Method source parsing for customer workbooks whose tabs use different header layouts.

What changed:

- Added optional header row and header span overrides keyed to exact workbook sheet names.
- Kept quantity-column selection, repeated-header filtering, and reference-row handling global so only layout-specific settings vary by sheet.
- Added a focused Import Method control that shows the active workbook sheet, its inheritance/override state, and the number of configured overrides.
- Applied the same per-sheet configuration during source schema detection and Manual Import parsing.
- Included the normalized override map in schema freshness checks, so changing an override requires re-detection before `Save Method` is available.
- Persisted only parser settings and detected schema metadata; workbook rows and cell values remain excluded.
- Added a workspace-level `npm test` command and durable workbook parser regression tests for automatic single-row headers, two-row grouped headers, repeated-header audit rows, blank header cells, and exact-sheet overrides.

Verification:

- `npm test` (4 passing parser regressions)
- `npm run check`
- `npm run build`
- `git diff --check`
- Production build retained the existing Vite advisory for the admin bundle exceeding 500 kB; no build failed.
- Disposable API persistence verification confirmed the exact `Catalog` header-row/span override and matching detected-schema parser snapshot survived reload.
- Local browser validation confirmed the saved override hydrates on the exact sheet, changing it marks the schema `Refresh required`, and `Save Method` remains disabled until re-detection.
- 390x844 browser validation confirmed the override controls collapse to one column with no horizontal overflow.
- No browser console warnings or errors were observed.
- No real Lift submit flags were enabled and no external Lift request was sent.

## 2026-07-19 - Import Method Persistence Regression Coverage

Added focused store/API-boundary regression coverage for detected source schemas and field mappings.

What changed:

- Added Import Method persistence tests that save and reload detected schema metadata, parser configuration, per-sheet overrides, and field mappings through the same `updateImportMethod` boundary used by the API route.
- Verified the matching saved field-mapping template updates with the active method while a neighboring method retains its own mappings.
- Added legacy parser normalization so methods saved before per-sheet overrides hydrate with empty override maps.
- Hardened source configuration persistence with a metadata allowlist.
- Raw workbook rows, parsed rows, cell values, and unrecognized nested payload fields are now removed even if a client includes them in an Import Method save request.
- Added the API test suite to the existing workspace-level `npm test` command.

Verification:

- `npm test` (2 Import Method persistence regressions and 4 workbook parser regressions passing)
- `npm run check`
- `npm run build`
- `git diff --check`
- Production build retained the existing Vite advisory for the admin bundle exceeding 500 kB; no build failed.
- Tests use an isolated temporary local store and remove it after completion.
- No production deployment or external Lift request is part of this slice.

## 2026-07-19 - Import Method Source Schema History

Added bounded structural history and comparison for detected Import Method source schemas.

What changed:

- Saving a structurally changed detected schema now archives the previous saved schema with the Import Method.
- Re-detecting an identical structure does not create a duplicate history entry, even when the file name or detection timestamp changes.
- History is deduplicated by schema structure and capped at the five most recent previous versions.
- Historical schemas use the same metadata allowlist as the current schema; workbook rows and cell values are never retained.
- Added an inline Schema History comparison in Source Setup showing added/removed columns, added/removed/changed sheets, column-order changes, and parser-setting changes.
- Kept history read-only; restoring an old schema is intentionally out of scope for this first slice.
- Expanded Import Method persistence coverage to verify structural deduplication, the five-version cap, order, and metadata-only storage.

Verification:

- `npm test` (3 Import Method persistence/history regressions and 4 workbook parser regressions passing)
- `npm run check`
- `npm run build`
- `git diff --check`
- Isolated local API/browser validation showed a v1-to-v2 comparison with `PO Number` added and the Orders layout changed.
- 390x844 browser validation confirmed a single-column comparison layout and no horizontal overflow.
- No browser console warnings or errors were observed.
- No production deployment or external Lift request is part of this slice.

## 2026-07-19 - Bulk Product Mapping Confirmation

Separated multi-row product assignment from the primary row-level `Map Product` workflow and added an explicit review boundary.

What changed:

- Bulk product mapping now requires at least two selected Pathfinder rows; a single row directs the operator back to its row-level `Map Product` action.
- Added removable selected-row chips so the active bulk scope is visible before opening Lift catalog search or entering an identifier manually.
- Manual identifiers and Lift catalog products now open the same confirmation modal instead of saving immediately.
- The modal shows every exact Pathfinder row, its current identifier, the identifier after save, the output route, route strategy, Lift product ID/unit metadata, and active catalog/result scope.
- Confirmation rechecks that the route strategy and selected rows have not changed before saving.
- `product_id` and `unit_number` routes continue to require their matching identifier; incompatible catalog products remain unavailable.
- Successful catalog confirmation closes the catalog drawer and clears the selection; cancellation leaves every row unchanged.
- Added an automated persistence regression confirming the reviewed rows update while an unselected neighboring row remains untouched.

Verification:

- `npm test` (4 API persistence/product-map regressions and 4 workbook parser regressions passing)
- `npm run check`
- `npm run build`
- `git diff --check`
- Isolated local browser validation confirmed two selected rows received `BULK-REVIEW-001` while the neighboring row remained `Unmapped`.
- Confirmed both manual identifier entry and Lift catalog selection open the exact-row review modal.
- 390x844 browser validation confirmed a single-column modal and no horizontal overflow.
- No browser console warnings or errors were observed.
- No production deployment or external Lift request is part of this slice.

Planned follow-up:

- Added `docs/LIFT_ORDER_NAME_STRATEGY.md` with the recommended `order.order_title`, composite/fallback, duplicate safety, retry, and output-template approach for Lift order names.
- The first implementation should add Import Method configuration and live preview while preserving the existing Lift `order.order_title` adapter/template path; cross-job reservations remain a later contract-dependent phase.

## 2026-07-19 - Import Method Order Name Resolution

Added deterministic Lift order-name setup and preview to Import Methods while retaining the existing canonical and output-template contract.

What changed:

- Added persisted per-method Order Name Resolution configuration with customer-provided, composite, and provided-with-composite-fallback strategies.
- Reused canonical `order.order_title`; the existing Lift adapter and output template continue to emit the same value to Lift JSON `order.order_title`.
- Composite rules use ordered canonical paths rather than raw workbook headers and support optional components, `yyyyMMdd` date formatting, prefix, suffix, separator, casing, and an optional maximum length.
- Added a live Import Method preview showing the source mapping, component sample values, final resolved name, canonical destination, Lift JSON destination, and active output template.
- Placed Order Name Resolution before Field Mapping in the Import Method workflow and expanded the step guide to five explicit stages so naming is configured before downstream mappings are reviewed.
- Added an explicit enablement gate. Previously saved methods normalize to disabled legacy pass-through, so this slice does not introduce a new title requirement or silently generate names until an operator opts in.
- New/configured methods default to customer-provided title with deterministic composite fallback using destination customer ID, external order ID, and optional ship date.
- API preview jobs now run the same shared resolver as the browser preview, persist the resolution result, and include blocking validation for missing required components or configured length limits.
- Added case-insensitive current-batch duplicate detection for use by multi-order import paths; cross-job/global reservations remain out of scope until Lift's real uniqueness contract is confirmed.

Verification:

- `npm test` (5 API persistence/product-map regressions and 9 template/parser regressions passing)
- `npm run check`
- `npm run build`
- `git diff --check`
- Isolated local API preview resolved `1249-AS360-30904511`, stored it in canonical `order.order_title`, emitted the identical Lift `order.order_title`, and returned `ORDER_NAME_RESOLVED` as passing validation.
- The isolated preview remained `Needs Mapping` only because its product map was intentionally empty.
- Live browser verification confirmed Order Name Resolution renders before Field Mapping and the Import Method detail view has no horizontal overflow.
- Hardened the login root and auth-stage width rules so the page cannot collapse to a narrow left-aligned column when the browser viewport is wide.
- Distributed the three dark-panel access chips evenly across the desktop panel and centered their responsive wrap on mobile.
- Removed the redundant `Vornan Pathfinder` eyebrow from the mobile brand panel while retaining the Vornan and Pathfinder wordmarks.
- Restored the desktop app shell to a viewport-height frame: the sidebar now remains bounded to the viewport with its own overflow safety, while the workspace owns long-page scrolling.
- Set workspace grid rows to max-content so tall Import Method panels retain their full height inside the scroll container rather than shrinking and clipping their contents.
- Moved the composite `Choose canonical field` selector into the shared labeled setup-control system so it matches the Resolution Strategy select on desktop and stacks cleanly with its action on mobile.
- Desktop Chrome verification at 1904x1009 confirmed a centered 1160px two-column login stage; 390x844 verification confirmed an edge-to-edge single-column layout with a 342px action card and no horizontal overflow.
- No production deployment, external Lift request, or real Lift submit behavior is part of this slice.

Planned follow-up:

- Simplify the naming workflow around customer identifiers, configured text, and submission date; keep Ext_ID identity separate from the readable order name.

## 2026-07-19 - Simplified Order Identity Resolution

Reframed the uncommitted Lift naming follow-up around the operator's actual workflow and removed the oversized route-level naming-contract setup.

What changed:

- Added fixed-text components alongside canonical-field components, enabling patterns such as `123987 - Empirical Web Order - 20260819`.
- Changed the recommended new-method composite to customer external order ID, editable `Web Order` text, and `source.submitted_at` formatted as `yyyyMMdd`.
- Added an explicit per-Import Method Lift Ext_ID source: the backward-compatible customer external order ID or a persisted Pathfinder-generated order ID.
- Strengthened preview job and canonical-order IDs with random entropy and added a compact collision-resistant Pathfinder order ID to each persisted job snapshot.
- Kept customer order, PO, and contract identifiers in the canonical record when Pathfinder supplies Lift Ext_ID.
- Split duplicate order-name errors from duplicate Ext_ID errors. Only a verified duplicate-name rejection prepares the next retry with `-1`, then `-2`; Pathfinder does not automatically resubmit.
- Removed the speculative Lift Order Name Contract UI and left unknown length/character constraints undefined.

Verification:

- `npm test` (8 API regressions and 11 template/parser regressions passing)
- `npm run check`
- `npm run build` (existing Vite chunk-size advisory only)
- `git diff --check`
- Isolated API preview resolved `123987 - Empirical Web Order - 20260719`, persisted a compact Pathfinder order ID, and emitted that identical ID in Lift header `Ext_ID` and body `order.ext_id`.
- The isolated preview returned passing `ORDER_NAME_RESOLVED` validation and remained `Needs Mapping` only because the isolated product map was intentionally empty.
- Confirmed the local admin and API servers remain available at `http://127.0.0.1:5183` and `http://127.0.0.1:3108`.

The production deployment updates Pathfinder configuration, preview, and guarded retry preparation only. It does not enable external Lift submission or automatically submit an order.

## 2026-07-19 - Globally Reserved Pathfinder Order Numbers

Simplified Lift order identity around one Pathfinder-managed number that operators do not need to compose or police for uniqueness.

What changed:

- Added a dedicated DynamoDB reservation table keyed by `pathfinder_order_id`; production creation uses a conditional write and retries candidate generation on the unlikely event of a collision.
- Added local-development reservation tracking plus persisted-job checks so local previews also avoid reusing an Order Number.
- Reserved the Pathfinder Order Number when a preview job is created, persisted it in the job snapshot, and retained the existing retry behavior that reuses the saved payload and identifier.
- Made Pathfinder Order Number the recommended default Lift `Ext_ID` source for newly created Import Methods while preserving saved legacy method choices.
- Continued to write the exact same resolved value to Lift header `Ext_ID` and body `order.ext_id`.
- Kept customer order, PO, and contract identifiers in the canonical record for traceability and readable order-name composition.
- Reframed the Import Method panel around the recommended managed identity and moved customer-title composition and formatting into an optional Advanced section.
- Surfaced the persisted Pathfinder Order Number in preview target details and persisted job details.
- Did not enable real Lift submission.

Deployment note:

- The API CloudFormation stack must be updated to provision `Pathfinder-OrderIds-prod` and inject `PATHFINDER_ORDER_IDS_TABLE` before deploying this API code to a DynamoDB-backed environment.

Verification:

- `npm run check`
- `npm test` (21 tests passed)
- `npm run build` (existing Vite chunk-size advisory only)
- `git diff --check`
- Created a local preview and confirmed its 14-character Pathfinder Order Number exactly matched Lift header `Ext_ID` and body `order.ext_id`.
- Verified the simplified closed-by-default Advanced section at desktop and 390px mobile widths with no horizontal overflow.

## 2026-07-19 - Truthful Workspace Loading And Bundle Splitting

Removed the initial seeded-data flash and split the admin application into deliberate production chunks.

What changed:

- Lazy-loads the main Pathfinder workspace after the authentication surface, keeping the sign-in path independent from the large workspace module.
- Splits React, Firebase, and the icon library into stable vendor chunks while preserving the existing on-demand XLSX parser chunk.
- Reduced the prior 542.87 kB main production chunk to a 323.98 kB workspace chunk; every emitted JavaScript chunk is now below Vite's 500 kB warning threshold.
- Starts customer and source state empty instead of briefly presenting Empirical, seeded Import Methods, or sample workbook values as current data.
- Shows an accessible skeleton workspace until the customer directory, selected customer workspace, routes/jobs, and canonical registry are ready.
- Clears the previous customer workspace immediately during customer changes and ignores stale workspace responses, preventing cross-customer data flashes.
- Keeps explicit sample workbook actions available, but no longer loads sample columns automatically when opening an Import Method without a detected schema.
- Adds a retryable load-failure state instead of falling back to credible-looking sample values.

Verification:

- `npm run check`
- `npm test` (21 tests passed)
- `npm run build` with no chunk-size advisory
- Delayed the local API by 1.5 seconds and confirmed only the loading skeleton appeared until the complete current workspace replaced it.
- Confirmed loading and loaded states at 390px with `scrollWidth === innerWidth` and no horizontal overflow.
- Real Lift submission remains disabled.

Production deployment:

- Committed and pushed as `64d48ec Add unique order IDs and truthful loading`.
- API workflow `29698121590`, admin workflow `29698120929`, and status workflow `29698123724` completed successfully.
- CloudFormation stack `vornan-pathfinder-api-prod` reached `UPDATE_COMPLETE` and now includes `Pathfinder-OrderIds-prod`.
- Verified the Order ID table is `ACTIVE`, uses `PAY_PER_REQUEST`, has server-side encryption enabled, and has point-in-time recovery enabled.
- Verified the production Lambda is `Active`, its last update succeeded, and `PATHFINDER_ORDER_IDS_TABLE=Pathfinder-OrderIds-prod` is present.
- Verified `https://api.pathfinder.vornan.co/health`, `https://pathfinder.vornan.co/`, and `https://status.vornan.co/` return HTTP 200.
- Verified the live admin entrypoint references the split vendor assets and the 323,993-byte lazy workspace asset.
- The explicit Lift-submit environment gate remains unset, so external Lift submission remains disabled and defaults to dry-run behavior.

## 2026-07-19 - Destructive Action Confirmations

Added explicit review steps before removing Import Method or Target configuration.

What changed:

- Import Method list and detail actions now open a named confirmation before discarding an unsaved draft or archiving a saved method.
- Target overview and detail actions now open a named confirmation before discarding a draft or permanently deleting an unreferenced saved Target.
- Target-environment removal uses the same confirmation pattern and explains that the draft change is not persisted until the Target is saved.
- Saved Target deletion is protected in the API: any reference from a customer workspace, output route, or Import Method returns a conflict instead of leaving dangling configuration.
- API error responses now surface their human-readable message in the admin interface rather than displaying raw JSON.
- Added a focused regression test proving referenced Targets cannot be deleted and unreferenced Targets can be removed.

Verification:

- `npm run check`
- `npm test --workspace @pathfinder/api` (12 tests passed)
- `npm run build` with every emitted JavaScript chunk below the 500 kB advisory threshold
- `git diff --check`
- Browser-tested the Import Method confirmation, cancel path, and confirmed removal of a test-only local draft.
- Browser-tested the saved Target confirmation and cancel path without deleting persisted Target data.
- Real Lift submission remains disabled.

## 2026-07-19 - Production Google Popup Authentication Hotfix

Restored the previously working Firebase popup flow after the production redirect flow returned authenticated users to the signed-out screen.

What changed:

- Removed the production-only `signInWithRedirect` branch and redirect-result handler introduced by `6e7cd6f`.
- All environments now use `signInWithPopup`, retaining explicit Google account selection and the existing approved-domain gate.
- The Google console self-XSS warning was identified as standard Google console safety copy, not a Pathfinder application error.

Verification and deployment:

- `npm run check --workspace @pathfinder/web`
- `npm run build --workspace @pathfinder/web`
- Committed and pushed as `eaf12af Restore popup authentication for Pathfinder`.
- Admin production workflow `29699177429` completed successfully, including CloudFront invalidation.
- The live production entrypoint references `/assets/index-I64bNW4C.js`; inspection confirms it calls `signInWithPopup` and contains no redirect-result branch.
- Browser verification confirmed clicking `Continue with Google` leaves `https://pathfinder.vornan.co/` in place while opening the Google sign-in surface.

## 2026-07-20 - Vornan Proof Dark DNS Handoff

Made the next read-only Proof slice safe to hand off for DNS without creating a record or enabling public customer reads.

What changed:

- Paired every Proof CloudFront alias with an issued `us-east-1` ACM certificate and reserved `proof.vornan.co` as the production alias.
- Added CloudFormation outputs for the exact CNAME name, target, initial DNS-only proxy mode, and TTL.
- Added a read-only DNS readiness command that checks stack completion, CloudFront deployment and alias, certificate status and coverage, the public-read-off gate, and explicit dark-smoke confirmation.
- Updated the protected workflow to smoke the CloudFront distribution hostname before DNS exists and to publish the exact DNS handoff in the job summary.
- Documented the Cloudflare cutover sequence and added Proof to the production hosting manifest.
- Queried the `dev`, `qa`, and `prod` Proof stack names; none exists yet, so no real CloudFront CNAME target is currently available.
- Kept customer grant creation, public read, and every Lift approval/revision/undo write disabled.

Verification:

- `npm run test:proof-deploy` (14 tests passed)
- `npm run check`
- `npm run test` (55 workspace tests passed)
- `npm run build`
- `npm run package:proof-lambdas`
- `sam validate --template-file infra/aws/proof-cloudformation.yaml --lint` (template valid; the sandbox prevented SAM from updating its unrelated user-level metadata file)
- `bash -n scripts/deploy-proof-stack.sh scripts/deploy-proof-web.sh scripts/package-proof-lambdas.sh`
- `git diff --check`

## 2026-07-20 - Vornan Proof Queued Customer Refresh

Closed the remaining Phase 2 manual-refresh gap without crossing into approval or revision implementation.

What changed:

- Added an authenticated `POST /api/public/proof/order/refresh` endpoint that queues read-only synchronization and returns immediately with `202`.
- Kept all Lift traffic out of the public request path; the existing worker remains the only refresh executor and uses Lift `GET` requests only.
- Added an IP rate rule and metric for the manual-refresh path to the managed Proof WAF.
- Updated the customer SPA to keep cached proofs usable while refresh is queued, show truthful queued/completed/error states, and avoid replacing cached content if the follow-up read fails.
- Extended telemetry, automated smoke coverage, API tests, the Phase 2 contract, and the isolated QA runbook.
- Removed the redundant HTML meta CSP that blocked Vite's development-injected stylesheet. Production remains protected by the stricter CloudFront response-header CSP.
- Browser-verified the styled demo and refresh lifecycle at desktop and 390×844; the mobile document width matched the viewport and produced no console errors.
- Lift approve, revision, undo, and generic Proof writes remain literal `false`.

Verification:

- `npm run check`
- `npm run test:proof-deploy` (14 tests passed)
- `npm run test` (57 workspace tests passed)
- `npm run build`
- `npm run package:proof-lambdas`
- `sam validate --template-file infra/aws/proof-cloudformation.yaml --lint` (template valid; the sandbox prevented SAM from updating its unrelated user-level metadata file)
- `git diff --check`

## 2026-07-20 - Vornan Proof Session Terminal States

Completed the read-only customer session lifecycle required by the Phase 2 route and expiry contract.

What changed:

- Added distinct `#/link-unavailable` and `#/session-ended` customer states without exposing order, session, grant, or token details.
- Added the short-lived session expiry deadline to the already-authenticated order response so the SPA proactively removes proof content when the browser session expires.
- Routed authenticated `401` responses, revocation, expiry, and explicit logout to the session-ended state.
- Canonicalized invalid and malformed access fragments to `#/link-unavailable`, removing token-shaped input from the visible URL.
- Added a typed public API error boundary and pure session-route/deadline helpers with focused tests.
- Preserved one generic unavailable presentation for unknown, expired, revoked, reused, and malformed grant links.
- Browser-verified explicit logout, both terminal routes, malformed-fragment cleanup, zero proof content after termination, mobile width at 390×844, and a clean console.
- Lift approve, revision, undo, and generic Proof writes remain literal `false`.

Verification:

- `npm run check`
- `npm run test:proof-deploy` (14 tests passed)
- `npm run test` (60 workspace tests passed)
- `npm run build`
- `npm run package:proof-lambdas`
- `git diff --check`

## 2026-07-20 - Vornan Proof Queue Accessibility And Empty States

Completed the next read-only Phase 2 acceptance slice without adding a customer decision or Lift write surface.

What changed:

- Fixed queue filtering so a task hidden by the selected filter can never remain visible in the detail pane.
- Added a single selected-option contract plus wrapping Arrow/Left/Right/Home/End keyboard navigation for desktop and horizontal mobile queues.
- Added distinct no-proof, no-open-proof, and filter-empty presentations in both the queue and detail canvas.
- Added independent desktop queue/detail scrolling, 44 px filter targets, visible detail focus, and narrow-layout overflow protection.
- Limited embedded document preview to browser-native images and PDFs; non-previewable files now present an explicit full-resolution open/download fallback.
- Routed an authenticated manual-refresh `401` through the existing session-ended cleanup so cached proof content cannot remain after session invalidation.
- Kept Lift approve, revision, undo, and generic Proof writes literal `false`.

Verification:

- `npm run check`
- `npm run test` (63 workspace tests passed, including 6 Proof SPA tests)
- `npm run test:proof-deploy` (14 tests passed)
- `npm run build`
- `npm run package:proof-lambdas`
- `git diff --check`
- Browser-tested filter integrity and keyboard focus/selection at desktop and 390×844.
- Browser-tested independent scrolling and 44 px controls at 1366×768.
- Browser-tested zero horizontal document overflow at 390×844 and 320×568 with a clean console.

## 2026-07-20 - Vornan Proof Full-Viewport Review Frame

Aligned the read-only Proof review surface with the Adspace workflow reference while preserving the Vornan visual system and every write gate.

What changed:

- Added contained proof thumbnails to each desktop inbox row with a safe fallback for non-image assets.
- Rebuilt the desktop shell around the full browser viewport so the inbox, artwork viewer, and stable action transport share the available height at large and compact window sizes.
- Kept inbox overflow independently scrollable while the artwork remains fully contained without crop, warp, or forced enlargement; the existing full-size action remains available.
- Moved feedback and version history into native modal dialogs with keyboard focus restoration, freeing the main viewer for artwork.
- Added the critical decision transport to desktop and mobile as an intentionally disabled QA surface. It has no approval or revision handlers and emits no Lift write request.
- Replaced the narrow queue/detail treatment with an Instagram-like stacked proof-review feed, sticky inbox filters, per-proof actions, and 44 px mobile targets.
- Added a design QA comparison record at `design-qa.md`; the final pass has no P0, P1, or P2 findings.
- Kept Lift approve, revision, undo, and generic Proof writes literal `false`.

Verification:

- `npm run check`
- `npm run test` (63 workspace tests passed, including 6 Proof SPA tests)
- `npm run test:proof-deploy` (14 tests passed)
- `npm run build`
- `npm run package:proof-lambdas`
- `git diff --check`
- Browser-tested exact full-viewport sizing and artwork containment at 1758×1201.
- Browser-tested independent queue overflow, visible locked transport, and artwork containment at 1366×768.
- Browser-tested the stacked feed, contained artwork, disabled decision controls, 44 px targets, and zero horizontal overflow at 390×844 and 320×568.
- Browser-tested feedback dialog open/close behavior and focus restoration.

## 2026-07-20 - Vornan Proof Read-Only Queue Discovery

Closed the remaining Phase 2 queue-discovery and short-landscape acceptance gaps without entering participant, approval, or revision implementation.

What changed:

- Added compact Open, Reviewed, and Total counters sourced from the complete proof packet rather than the active filter.
- Added one synchronized proof search across desktop and mobile that matches product, line, filename, or state after the selected queue filter is applied.
- Added a distinct search-empty presentation in both the queue and detail canvas so hidden proofs cannot remain visible.
- Added an explicit clear action that restores the filtered queue and selects its first visible proof.
- Converted feedback/history dialogs into bottom sheets on narrow layouts with focus restoration unchanged.
- Routed 844×390 and similar short-landscape windows to the mobile review feed instead of squeezing the desktop split.
- Kept every Lift approval, revision, undo, and generic Proof write path disabled.

Verification:

- `npm run check --workspace @pathfinder/proof`
- `npm run test --workspace @pathfinder/proof` (7 tests passed)
- `npm run check`
- `npm run test` (64 workspace tests passed)
- `npm run test:proof-deploy` (14 tests passed)
- `npm run build`
- `npm run package:proof-lambdas`
- `git diff --check`
- Browser-tested search by filename/product, search-empty detail clearing, clear/restore behavior, and accurate `4 / 1 / 5` counters at 1366×768.
- Browser-tested the 390×844 feedback bottom sheet anchored 10 px above the viewport edge with focus returned to the exact opener.
- Browser-tested the stacked feed at 844×390 with no horizontal overflow, fully contained artwork, 44 px controls, disabled decisions, and no new console warnings or errors.

## 2026-07-20 - Vornan Proof Private Link Delivery Foundation

Added the architecture-defined Proof notification path without enabling customer reads, sending an external message, or entering Lift decision work.

What changed:

- Added a `proof_link` transactional email contract with Vornan sender identity, `support@vornan.com` Reply-To, accessible text and HTML bodies, expiry/view-only guidance, and no application opt-in to the general SES engagement-tracking configuration set.
- Added an independent `PATHFINDER_PROOF_ENABLE_LINK_EMAIL=false` runtime and CloudFormation gate. The template requires authenticated grant creation before link email can be enabled.
- Added authenticated `POST /api/proof/grants/{grantId}/email`. It accepts a link only when its fragment token hashes to the exact unused, active grant at the configured Proof origin.
- Added the operator recipient field and send control beside the one-time copy action. Log mode retains the raw link because no message was sent; SES success removes it from the screen.
- Added masked delivery responses and append-only delivery audit actions containing mode/status only. Raw recipient addresses, URLs, tokens, provider IDs, and email bodies are excluded from API responses, persistence, and logs.
- Added tests for email content/escaping, masked log behavior, bearer secrecy, grant/link mismatch rejection, redacted audit persistence, and the independent default-off gate.
- Updated the Phase 2 contract and QA runbook with the log-first, approved-recipient delivery sequence.
- Kept Proof public read, Lift approval, revision, undo, and generic Lift writes disabled. No deployment, DNS change, or external email occurred.

Verification:

- `npm run check`
- `npm run test` (69 workspace tests passed)
- `npm run test:proof-deploy` (14 tests passed)
- `npm run build`
- `npm run package:api-lambda`
- `npm run package:proof-lambdas`
- `sam validate --template-file infra/aws/api-cloudformation.yaml --lint` (template valid)
- `bash -n scripts/deploy-api-lambda.sh`
- `git diff --check`

## 2026-07-20 - Vornan Proof Reviewer Identity Foundation

Added the architecture-defined participant boundary to the read-only customer experience without adding any proof decision or Lift write route.

What changed:

- Added optional reviewer name/email capture while anonymous proof viewing remains available. The customer response exposes only the identity bound to the current session.
- Bound participant, manual-refresh, and logout requests to a session-specific double-submit CSRF token. Only its SHA-256 hash is persisted; the raw token is never returned in JSON or written to logs/storage.
- Added dedicated participant persistence under the access grant, plus redacted identified/updated audit actions containing participant and grant identifiers but no name or email.
- Added authenticated operator reviewer counts and a restricted reviewer-detail endpoint/panel. Customer identities do not enter the public order aggregate.
- Added a dedicated managed-WAF rate rule for participant identity requests.
- Added the reviewer control and accessible identity dialog to the full-viewport desktop and mobile Proof UI. Viewing and every disabled decision control remain unchanged.
- Extended the Phase 2 contract and isolated QA runbook with CSRF, identity, operator-visibility, and redacted-audit acceptance checks.
- Kept Proof public read, grant creation, and link delivery default off. Lift approve, revision, undo, and generic Lift writes remain literal `false`; no deployment, DNS change, external email, or Lift write occurred.

Verification:

- `npm run check`
- `npm run test` (71 workspace tests passed)
- `npm run test:proof-deploy` (14 tests passed)
- `npm run build`
- `npm run package:api-lambda`
- `npm run package:proof-lambdas`
- `sam validate --template-file infra/aws/proof-cloudformation.yaml --lint` (template valid)
- `bash -n scripts/deploy-proof-stack.sh scripts/deploy-proof-web.sh scripts/package-proof-lambdas.sh scripts/deploy-api-lambda.sh`
- `git diff --check`
- Browser-tested anonymous viewing, reviewer create/update presentation, exact full-viewport sizing, and disabled decision controls at 1763×1200.
- Browser-tested the 44 px reviewer control, bottom-sheet dialog, stacked feed, zero horizontal overflow, and disabled decision controls at 390×844 with no console warnings or errors.

## 2026-07-20 - Vornan Proof Feedback Acknowledgement Foundation

Added the architecture-defined current-feedback gate as an isolated Proof-local prerequisite without implementing a customer decision or Lift write.

What changed:

- Added a CSRF-protected participant-bound feedback acknowledgement route for the current task feedback.
- Persisted acknowledgements beneath the access grant using participant + task identity and the current internal feedback fingerprint.
- Made acknowledgement state automatically reset when the attachment/comment fingerprint changes; an unchanged repeated request is idempotent and does not duplicate audit activity.
- Added customer-safe `feedback_required` and `feedback_acknowledged` task fields without exposing acknowledgement IDs or internal fingerprints.
- Added append-only `proof.feedback_acknowledged` audit activity containing order/task/line/attachment/grant/participant identifiers but no comment text or feedback fingerprint.
- Added a dedicated managed-WAF rate rule for public task acknowledgement traffic.
- Extended the desktop modal and mobile bottom sheet with an explicit identity handoff, “Mark feedback reviewed” action, completed state, and clear copy that acknowledgement is not approval or revision.
- Kept Proof public read, grant creation, and link delivery default off. Lift approve, revision, undo, generic writes, JWT signing, uploads, and decision routes remain absent or literal `false`; no deployment, DNS change, external email, or Lift write occurred.

Verification:

- `npm run check`
- `npm run test` (72 workspace tests passed)
- `npm run test:proof-deploy` (14 tests passed)
- `npm run build`
- `npm run package:api-lambda`
- `npm run package:proof-lambdas`
- `sam validate --template-file infra/aws/proof-cloudformation.yaml --lint` (template valid)
- `bash -n scripts/deploy-proof-stack.sh scripts/deploy-proof-web.sh scripts/package-proof-lambdas.sh scripts/deploy-api-lambda.sh`
- `git diff --check`
- Browser-tested anonymous feedback, identity handoff, acknowledgement completion, full-viewport modal layout, and disabled decision controls at 1763×1200.
- Browser-tested the bottom-sheet acknowledgement state, 390×844 viewport fit, zero horizontal overflow, and disabled decision controls with no console warnings or errors.

## 2026-07-20 - Manual Import Mapping Synchronization

Corrected the Manual Import review state exposed by the first real Momentara order workbook.

What changed:

- Manual Import now refreshes its field mappings whenever the active Import Method's saved mapping set changes, including save responses whose workspace timestamp is unchanged.
- Saving an Import Method explicitly places the returned saved mappings into the active Manual Import state.
- Before a preview job exists, Product Resolution Review now generates the same customer product keys from the uploaded order and looks them up in the saved route-level Output Product Map.
- Saved Lift product IDs and product names render immediately instead of showing every row as `Unmapped` with a `Generate preview to resolve` placeholder.
- The local Canonical Order and Lift payload previews now apply those resolved route identifiers before validation, matching the persisted preview service and eliminating contradictory `product_id` failures while Product Resolution reports the same rows as mapped.
- Local submit certification now recognizes API-masked saved Lift credentials as configured, matching route health and preflight instead of presenting the secure `********` response as a missing password.
- Manual Import readiness and preflight now count mapping gaps only for products present in the uploaded order, rather than blocking on every unmapped item in the customer's broader preloaded catalog.
- The persisted preview job remains the certification boundary; pre-preview results are clearly labeled as saved-route lookups that still require preview validation.
- Preview generation is now disabled until an order source with at least one valid order row is loaded, and the action handler rejects empty-source requests defensively.
- The duplicate `Persist Preview Job` label now uses the same `Generate Preview Job` / `Regenerate Preview Job` language as the upload workflow so both entry points describe the same persisted preview action.
- The non-persisted Lift preview no longer presents `PF-PREVIEW` like a real Ext_ID. It explicitly marks the value as reserved-on-generation; a persisted preview still reserves one globally unique Pathfinder Order Number and uses it for both the Lift header and body Ext_ID.
- Product Resolution Review now shows the canonical quantity for every resolved order line so operators can visually confirm product identity and submitted quantity together before generating the persisted preview.
- A persisted Ready job with no prior attempt now presents `Submit to Lift` and uses the normal first-attempt idempotency path; `Retry Submit` and a fresh retry key appear only after an attempt exists.

Verification:

- Confirmed the saved Momentara Import Method has `FINISHING` ignored, `Notes` mapped to `lines[].line_note`, and `Creative` mapped to `lines[].artwork.file_url`.
- Browser inspection confirmed Manual Import is rendering the saved eight-field Momentara mapping and applying the contract number, description, quantity, dimensions, ship date, and line note to the local Canonical Order.
- Confirmed the saved route-level mappings for the test order are `ONE_SHEET_30_375X46_375 → 342219`, `PUMP_TOPPER_CLIP → 342197`, and `PUMP_TOPPER_AOM → 342197`.
- `npm run check --workspace @pathfinder/web`
- `npm run build --workspace @pathfinder/web`
- `git diff --check`
- No preview job, external Lift request, deployment, or real Lift submission was performed.

## 2026-07-20 - Vornan Proof Task History Read Slice

Completed the architecture-defined Phase 2 task history route and connected it to the existing file-history modal without entering any decision or Lift write work.

What changed:

- Added authenticated `GET /api/public/proof/tasks/{taskId}/history` on the isolated public router.
- Bound task lookup to the session's single granted order; unknown and cross-order task identifiers return the same customer-safe not-available response.
- Added a reusable public history serializer that excludes Lift attachment IDs, approver identity, detailed reports, feedback fingerprints, raw Lift rows, internal warnings, and customer-only order metadata.
- Changed the desktop modal and mobile bottom sheet to open from cached order history, lazily check the task route, retain cached versions on failure, offer an explicit retry, and terminate correctly on an expired session.
- Generalized the managed-WAF task-route rate limit so it covers both history reads and feedback acknowledgements.
- Corrected the mobile native-dialog max-width override so the history sheet has symmetric 10 px viewport margins.
- Extended the Phase 2 contract and isolated QA runbook with endpoint isolation, redaction, cache fallback, retry, and terminal-session acceptance checks.
- Kept Proof public read, grant creation, and link delivery default off. Lift approve, revision, undo, uploads, generic writes, and public decision routes remain absent or literal `false`; no deployment, DNS change, external email, or Lift write occurred.

Verification:

- `npm run test` (75 workspace tests passed)
- `npm run check`
- `npm run test:proof-deploy` (14 tests passed)
- `npm run build`
- `npm run package:proof-lambdas`
- `sam validate --template-file infra/aws/proof-cloudformation.yaml --lint` (template valid)
- `bash -n scripts/deploy-proof-stack.sh scripts/deploy-proof-web.sh`
- `node --check scripts/smoke-proof-read-only.mjs`
- `git diff --check`
- Browser-tested the two-version history modal at 1366×768 with no horizontal overflow and every decision control disabled.
- Browser-tested the bottom sheet at 390×844 with symmetric 10 px margins, 58 px version targets, zero horizontal overflow, exact focus restoration to the History opener, and no console errors.

## 2026-07-20 - Vornan Proof Customer-Safe Technical History

Completed the remaining Phase 2 file-history presentation gap for approval metadata and technical report results without exposing raw Lift report content or adding a write path.

What changed:

- Added bounded `technical_checks` to the customer-safe public version DTO for both the order packet and task history route.
- Projected only allowlisted Lift `DETAILED_REPORT` check names and statuses from array, `checks`, `results`, or `rowset` shapes, including JSON-encoded report payloads.
- Collapsed duplicate checks, capped the result set, and rejected URL/token-shaped or overlong values.
- Continued to exclude raw detailed reports, report details, internal IDs, signed URLs, Lift attachment IDs, feedback fingerprints, and approver identity.
- Expanded the history modal/bottom sheet with the selected version's approval status, approval date, and accessible technical-check result list.
- Added explicit pass, warning/notice, and failure treatments that pair text with color rather than relying on color alone.
- Extended the Phase 2 contract and isolated QA runbook with customer-safe technical-report acceptance and hostile-field redaction checks.
- Kept Proof public read, grant creation, and link delivery default off. Lift approve, revision, undo, uploads, generic writes, and public decision routes remain absent or literal `false`; no deployment, DNS change, external email, or Lift write occurred.

Verification:

- `npm run test` (76 workspace tests passed)
- `npm run check`
- `npm run test:proof-deploy` (14 tests passed)
- `npm run build`
- `npm run package:proof-lambdas`
- `sam validate --template-file infra/aws/proof-cloudformation.yaml --lint` (template valid)
- `bash -n scripts/deploy-proof-stack.sh scripts/deploy-proof-web.sh`
- `node --check scripts/smoke-proof-read-only.mjs`
- `git diff --check`
- Browser-tested current and prior version selection at 1366×768, including approval metadata, pass/warning states, no modal scrolling, no horizontal overflow, and disabled decisions.
- Browser-tested the 390×844 bottom sheet with symmetric 10 px margins, 58 px version targets, zero horizontal overflow, exact focus restoration, and no console errors.

## 2026-07-20 - Vornan Proof Customer-Safe Feedback Attachments

Completed the Phase 2 read-only feedback-attachment slice without adding any decision or Lift write capability.

What changed:

- Added bounded customer-safe attachment metadata to current feedback comments in the public proof DTO.
- Projected supported Lift `COMMENT_ATTACHMENT` shapes from arrays, nested objects, JSON-encoded payloads, URL-only strings, and filename-only metadata.
- Allowed only absolute HTTPS attachment URLs without embedded username/password credentials; unsafe schemes, opaque blobs, private IDs, thread identifiers, and arbitrary internal fields remain excluded.
- Derived safe filenames where possible, bounded text fields and result counts, and collapsed duplicate attachments.
- Added keyboard-operable feedback attachment actions to the desktop modal and mobile bottom sheet, with 44 px minimum targets and explicit metadata-only treatment when a safe URL is unavailable.
- Extended the Phase 2 contract and isolated QA runbook with attachment projection, redaction, accessibility, acknowledgement-reset, and audit acceptance checks.
- Kept Proof public read, grant creation, and link delivery default off. Lift approve, revision, undo, uploads, generic writes, and public decision routes remain absent or literal `false`; no deployment, DNS change, external email, attachment navigation, or Lift write occurred.

Verification:

- `npm run test` (77 workspace tests passed)
- `npm run check`
- `npm run test:proof-deploy` (14 tests passed)
- `npm run build`
- `npm run package:proof-lambdas`
- `sam validate --template-file infra/aws/proof-cloudformation.yaml --lint` (template valid)
- `bash -n scripts/deploy-proof-stack.sh scripts/deploy-proof-web.sh`
- `node --check scripts/smoke-proof-read-only.mjs`
- `git diff --check`
- Browser-tested the feedback attachment modal at 1366×768: 44 px attachment target, no dialog overflow, no horizontal overflow, and every decision control disabled.
- Browser-tested the 390×844 bottom sheet with symmetric 10 px margins, a 44 px attachment target, zero horizontal overflow, exact focus restoration to the Feedback opener, and no console errors.

## 2026-07-20 - Vornan Proof Read-Only Lifecycle States

Completed the Phase 2 lifecycle-state resilience slice without adding any customer decision or Lift write capability.

What changed:

- Added the normalized non-actionable `revised` task state for Lift revision-like approval statuses and presented it to customers as `Regenerating`.
- Kept regenerating and waiting tasks in the open queue while approved and production-reference tasks remain in history; queue counters and state-label search now use the same classification.
- Added bounded customer-facing explanations and text/icon treatments for waiting, regenerating, reference, cancelled, missing, and file-error tasks.
- Projected an old active packet as `stale` only in the public response, leaving the stored Lift-derived aggregate unchanged and retaining every cached proof while the bounded background refresh is requested.
- Added customer-safe cached-packet notices for stale, missing, and error aggregate health without exposing Lift or infrastructure details.
- Added a development-only `#/proof/lifecycle-qa` fixture for responsive acceptance of revised, waiting, reference, error, and stale states.
- Extended the Phase 2 contract and isolated QA runbook with revision-status normalization, non-actionability, cached-proof retention, counters, search, and responsive acceptance checks.
- Kept Proof public read, grant creation, and link delivery default off. Lift approve, revision, undo, uploads, generic writes, and public decision routes remain absent or literal `false`; no deployment, DNS change, external email, attachment navigation, or Lift write occurred.

Verification:

- `npm run test` (81 workspace tests passed)
- `npm run check`
- `npm run test:proof-deploy` (14 tests passed)
- `npm run build`
- `npm run package:proof-lambdas`
- `sam validate --template-file infra/aws/proof-cloudformation.yaml --lint` (template valid)
- `bash -n scripts/deploy-proof-stack.sh scripts/deploy-proof-web.sh`
- `node --check scripts/smoke-proof-read-only.mjs`
- `git diff --check`
- Browser-tested the stale/regenerating/waiting fixture at 1366×768: the workspace ended at 744 px in a 768 px viewport, cached-state notice was 44 px high, the queue stayed independently scrollable, no horizontal overflow occurred, and all decision controls remained disabled.
- Browser-tested the same lifecycle states at 390×844 and 320×568 with 10/12 px contained surfaces, no horizontal overflow, 44 px decision targets, customer-facing state search, and all five task states available through the All filter.
- Browser-tested 844×390 short landscape and confirmed the mobile feed remained active with zero horizontal overflow; no browser console warnings or errors were emitted.

## 2026-07-20 - Vornan Proof Customer-Safe Asset Preview

Completed the Phase 2 proof-asset descriptor and browser-preview slice without adding any customer decision or Lift write capability.

What changed:

- Added bounded proof content-type normalization from the supported Lift MIME fields and a server-owned `image`, `pdf`, `download`, or `unavailable` preview kind to the customer-safe DTO.
- Applied deterministic low/high asset precedence: the safe low-resolution browser-native asset remains the contained preview and the safe high-resolution asset remains the open/download target; a surviving browser-native high-resolution asset can act as the preview fallback.
- Accepted only same-origin paths or credential-free HTTPS asset references, rejecting HTTP, `javascript:`, protocol-relative, credential-bearing, malformed, and active SVG/HTML preview references.
- Added a second client-side URL validation boundary so the SPA never embeds or exposes an asset rejected by the customer-safe descriptor rules.
- Added contained PNG/JPEG/GIF/WebP rendering, a sandboxed contained PDF viewer with browser paging/zoom guidance and explicit Open/Download fallback, metadata/download treatment for non-browser-native prepress files, and an explicit conversion-unavailable state.
- Added a valid one-page no-JavaScript PDF fixture and a development-only `#/proof/assets-qa` packet covering PDF, an intentionally long filename, PSD download-only presentation, TIFF unavailable presentation, and a safe raster proof.
- Extended the Phase 2 contract and isolated QA runbook with URL-hostility, precedence, PDF controls/fallback, prepress-file, long-filename, responsive, and disabled-transport acceptance checks.
- Kept Proof public read, grant creation, and link delivery default off. Lift approve, revision, undo, uploads, generic writes, and public decision routes remain absent or literal `false`; no deployment, DNS change, external email, file navigation, or Lift write occurred.

Verification:

- `npm run test` (84 workspace tests passed)
- `npm run check`
- `npm run test:proof-deploy` (14 tests passed)
- `npm run build`
- `npm run package:proof-lambdas`
- `sam validate --template-file infra/aws/proof-cloudformation.yaml --lint` (template valid)
- `bash -n scripts/deploy-proof-stack.sh scripts/deploy-proof-web.sh`
- `node --check scripts/smoke-proof-read-only.mjs`
- `pdfinfo apps/proof/public/brand/proof-placeholder.pdf` (one page, PDF 1.4, unencrypted, JavaScript disabled)
- `git diff --check`
- Browser-tested the asset fixture at 1366×768: PDF preview stayed contained with explicit full-resolution fallbacks, PSD used the metadata/download card, TIFF exposed no preview or action, the queue filenames remained bounded, the shell had no document overflow, and all decision controls remained disabled.
- Browser-tested the same fixture at 390×844 and 320×568 with zero horizontal overflow, contained 368 px PDF presentation at the 390 px viewport, long-filename containment, and a 44 px minimum interactive target.
- Browser-tested 844×390 short landscape and confirmed the mobile feed remained active with zero horizontal overflow; no browser console warnings or errors were emitted.

## 2026-07-20 - Vornan Proof Read-Only Completion State

Completed the remaining Phase 2 complete/read-only-success presentation gap without creating a completion event, customer decision, or Lift write path.

What changed:

- Added deterministic completion presentation that requires at least one reviewed task, allows approved/reference history, and rejects any pending, waiting, regenerating, missing, or file-error task.
- Prevented stale, missing-order, and error-order health from producing a false success state even when cached tasks look reviewed.
- Presented active all-approved orders as `All proofs reviewed` and complete/reference packets as `Proof packet complete`.
- Kept the Open view truly empty after completion while adding a keyboard-accessible 44 px `View reviewed proofs` action that moves directly to the approved/reference queue on desktop and mobile.
- Preserved approved and production-reference proof files, feedback, history, full-resolution actions, and the disabled decision transport after the reviewed queue opens.
- Added development-only `#/proof/all-reviewed-qa` and `#/proof/complete-qa` fixtures for the two success variants.
- Confirmed the authoritative handoff's optional original/customer-art source remains unavailable; no speculative Lift fields or two-up asset data were invented in this slice.
- Extended the Phase 2 contract and isolated QA runbook with completion eligibility, false-success rejection, responsive navigation, and presentation-only acceptance checks.
- Kept Proof public read, grant creation, and link delivery default off. Lift approve, revision, undo, uploads, generic writes, completion events, and public decision routes remain absent or literal `false`; no deployment, DNS change, external email, file navigation, or Lift write occurred.

Verification:

- `npm run test` (85 workspace tests passed)
- `npm run check`
- `npm run test:proof-deploy` (14 tests passed)
- `npm run build`
- `npm run package:proof-lambdas`
- `sam validate --template-file infra/aws/proof-cloudformation.yaml --lint` (template valid)
- `bash -n scripts/deploy-proof-stack.sh scripts/deploy-proof-web.sh`
- `node --check scripts/smoke-proof-read-only.mjs`
- `git diff --check`
- Browser-tested active all-approved and complete/reference states at 1366×768: Open was 0, Reviewed was 5, the document had no overflow, the two customer-safe success messages stayed distinct, and reviewed files opened through the History filter.
- Browser-tested the complete/reference state at 390×844 and 320×568 with zero horizontal overflow, a 44 px reviewed-proof action, and all five reviewed cards accessible after the handoff; all ten mobile decision buttons remained disabled.
- Browser-tested 844×390 short landscape and confirmed the mobile feed remained active with zero horizontal overflow and a 44 px reviewed-proof action; no browser console warnings or errors were emitted.

## 2026-07-20 - Vornan Proof Customer-Safe Quantity Metadata

Completed the authoritative handoff's quantity-preservation slice without restoring Adspace allocation/location concepts or adding any customer decision or Lift write capability.

What changed:

- Copied each joined Lift line's normalized `QUANTITY`/`ORDER_QUANTITY` onto its attachment tasks and waiting-line shell; quantity now participates in task change detection.
- Added a customer-safe public quantity projection that accepts only finite, non-negative numbers no greater than 1,000,000,000 and maps absent, invalid, negative, or oversized values to `null`.
- Rendered compact `Qty` metadata on desktop queue cards, the selected-proof heading, and the mobile proof feed without allocation, assigned-location, or mismatch language.
- Added representative demo quantities plus domain and public API regression assertions, including rejection of a non-finite task value.
- Extended the Phase 2 contract and isolated QA runbook with source mapping, public bounds, responsive presentation, and explicit exclusion of allocation concepts.
- Kept Proof public read, grant creation, and link delivery default off. Lift approve, revision, undo, uploads, generic writes, completion events, and public decision routes remain absent or literal `false`; no deployment, DNS change, external email, file navigation, or Lift write occurred.

Verification:

- `npm run test` (85 workspace tests passed)
- `npm run check`
- `npm run test:proof-deploy` (14 tests passed)
- `npm run build`
- `npm run package:proof-lambdas`
- `sam validate --template-file infra/aws/proof-cloudformation.yaml --lint` (template valid)
- `bash -n scripts/deploy-proof-stack.sh scripts/deploy-proof-web.sh`
- `node --check scripts/smoke-proof-read-only.mjs`
- `git diff --check`
- Write-gate scan confirmed `lift_writes_enabled: false`; the deploy safety suite continued to reject approval, revision, undo, upload, and generic Proof write capability.
- Browser-tested the normal quantity fixture at desktop sizing: all four open queue cards displayed `Qty 20`, the selected header displayed `Line 1 · Qty 20`, the contained preview and locked decision transport remained stable, and no allocation/location comparison appeared.
- Browser-tested 390×844 and 320×568: `Qty 20` remained visible in each mobile feed card, document width exactly matched the viewport, all eight rendered decision buttons remained disabled, and each retained a 44 px target.
- Browser-tested 844×390 short landscape: the mobile feed remained active with zero horizontal overflow, quantity metadata stayed visible, all eight decision buttons remained disabled, and no browser warnings or errors were emitted.

## 2026-07-20 - Vornan Proof Server-Owned Lifecycle Counters

Completed the authoritative command-bar counter slice without adding a customer decision or Lift write path.

What changed:

- Added customer-safe public order counts for pending, regenerating, waiting, reviewed, and total tasks; counts are derived from the same active normalized tasks returned by the DTO.
- Replaced the collapsed Open/Reviewed/Total command bar with distinct Pending, Regenerating, and Waiting counters plus a compact Reviewed/Total ratio.
- Kept approved and production-reference tasks together in the customer-safe Reviewed count so a retained production reference is never falsely presented as customer-approved.
- Kept cancelled, missing, and file-error tasks in Total without classifying them as actionable or positively reviewed.
- Recomputed demo counts for lifecycle and completion fixtures so visual QA cannot show stale summary metadata after task-state transformations.
- Added domain, public API, and SPA lifecycle regression assertions for the exact counter contract.
- Extended the Phase 2 contract and isolated QA runbook with server ownership, reference semantics, the mixed-state lifecycle fixture, and responsive acceptance.
- Kept Proof public read, grant creation, and link delivery default off. Lift approve, revision, undo, uploads, generic writes, completion events, and public decision routes remain absent or literal `false`; no deployment, DNS change, external email, file navigation, or Lift write occurred.

Verification:

- `npm run test` (86 workspace tests passed)
- `npm run check`
- `npm run test:proof-deploy` (14 tests passed)
- `npm run build`
- `npm run package:proof-lambdas`
- `sam validate --template-file infra/aws/proof-cloudformation.yaml --lint` (template valid)
- `bash -n scripts/deploy-proof-stack.sh scripts/deploy-proof-web.sh`
- `node --check scripts/smoke-proof-read-only.mjs`
- `git diff --check`
- Write-gate scan reconfirmed literal `false` for approval, revision, undo, `lift_writes_enabled`, and public `decisions_enabled`.
- Browser-tested `#/proof/lifecycle-qa` at 1366×768: Pending 1, Regenerating 1, Waiting 1, and Reviewed 1/5 remained compact; the queue scrolled independently, the document had no horizontal overflow, and the disabled decision transport ended at 727 px inside the 768 px viewport.
- Browser-tested the same mixed-state counters at 390×844 and 320×568: all four cells remained equal and legible, the 320 px cells measured 68–69 px wide, the mobile feed remained active, and document overflow stayed zero.
- Browser-tested 844×390 short landscape: the mobile feed remained active, the four counters stayed accurate, all six rendered decision buttons remained disabled, horizontal overflow stayed zero, and no browser warnings or errors were emitted.

## 2026-07-20 - Vornan Proof Bounded Display Metadata

Completed the customer-safe display metadata and deterministic fallback slice without adding a customer decision or Lift write path.

What changed:

- Added a second public-boundary normalization pass for Lift-derived order titles/statuses, line numbers, product names, approval labels, feedback text, and customer-visible version/comment timestamps.
- Removed ASCII control characters, collapsed unstable whitespace, rejected oversized strings, and returned `null` for invalid public timestamps rather than allowing the SPA to render arbitrary raw values.
- Bounded feedback to 100 entries per public version and 8,000 characters per feedback body while leaving the internal normalized aggregate unchanged.
- Replaced the generic missing order-title text with the authoritative `Order A########` fallback and retained `Proof review` for a missing status.
- Added development-only `#/proof/display-fallback-qa` coverage for missing title/status/product metadata without inventing customer or order data.
- Added domain, public API, and SPA display regression assertions covering control characters, whitespace, invalid timestamps, oversized product metadata, and deterministic fallbacks.
- Extended the Phase 2 contract and isolated QA runbook with explicit public limits, hostile-value acceptance, timestamp behavior, and responsive fallback review.
- Kept Proof public read, grant creation, and link delivery default off. Lift approve, revision, undo, uploads, generic writes, completion events, and public decision routes remain absent or literal `false`; no deployment, DNS change, external email, file navigation, or Lift write occurred.

Verification:

- `npm run test` passed all 87 workspace tests, including 42 API, 14 Proof UI, 5 Lift adapter, 15 proof-domain, and 11 template tests.
- `npm run check`, `npm run build`, `npm run test:proof-deploy` (14 tests), and `npm run package:proof-lambdas` passed.
- `sam validate --template-file infra/aws/proof-cloudformation.yaml --lint`, deployment-script shell parsing, smoke-script syntax validation, and `git diff --check` passed.
- The write-gate scan confirmed approval, revision, undo, public decisions, and `lift_writes_enabled` remain literal `false`.
- Browser-tested `#/proof/display-fallback-qa` at 1366×768, 320×568, 390×844, and 844×390: the deterministic order/product fallbacks rendered correctly, the mobile feed activated at compact sizes, decision controls remained disabled, horizontal overflow stayed zero, and no browser warnings or errors were emitted.

## 2026-07-20 - First Live Lift Transport Attempt

- Generated a certified two-line Momentara sandbox-customer preview on the Premium Graphics route and initiated the first operator-confirmed live transport attempt.
- The attempt failed before reaching Lift because the configured internal `prod-lifterp` hostname did not resolve from the local Pathfinder runtime; no HTTP response or Lift order number was received.
- Replaced the local PROD environment endpoint with the confirmed public Lift `create_order` URL and verified the route with a non-submitting HEAD request.
- Aligned the live submit headers with the successful Postman contract by including `Accept: application/json`; saved credentials remain masked and unchanged.
- Fixed submit certification so a persisted `Submit Failed` preview remains eligible for an intentional retry after route, credential, or endpoint correction; other failed preview states remain blocking.
- Preserved the failed attempt, Ext_ID, masked submit request, and endpoint error in job history. No retry was sent automatically.
- Corrected the job-detail state-pill selector so header metadata styling no longer overrides Ready/Failed chip colors.
- Added the PROD sandbox-lane confirmation directly to job detail, disabled Submit/Retry until it is checked, and added an explicit `Submitting…` state so a cleared confirmation can no longer look like a dead button after refresh.

Validation:

- `npm run check --workspace @pathfinder/api`
- `npm run check --workspace @pathfinder/web`
- `npm run build --workspace @pathfinder/web`
- `git diff --check`
- Refreshed `JOB-253878` certification after the endpoint correction: certified, no blockers, eligible for intentional retry.

## 2026-07-20 - Vornan Proof Accessible Dialog Focus Lifecycle

Completed the Phase 2 modal and bottom-sheet focus-lifecycle slice without adding a customer decision or Lift write path.

What changed:

- Kept feedback, file history, and reviewer identity on the browser's native modal boundary while adding explicit accessible descriptions and deterministic initial focus.
- Feedback and history focus Close on open; reviewer identity focuses Name. Close and Escape restore focus to the exact connected opener and fall back to the selected-proof region only if the opener disappeared.
- Added a one-dialog transition from feedback to reviewer identity so background focus is never exposed and closing identity returns directly to the original Feedback control.
- Added a defensive focus-restoration helper that rejects detached or failed targets plus focused unit coverage.
- Extended the Phase 2 contract and isolated QA runbook with desktop, portrait bottom-sheet, short-landscape, Escape, modal isolation, and transition acceptance checks.
- Kept Proof public read, grant creation, and link delivery default off. Lift approve, revision, undo, uploads, generic writes, completion events, and public decision routes remain absent or literal `false`; no deployment, external email, file navigation, or Lift write occurred.

Verification:

- `npm run test` passed all 89 workspace tests, including 42 API, 16 Proof UI, 5 Lift adapter, 15 proof-domain, and 11 template tests.
- `npm run check`, `npm run build`, `npm run test:proof-deploy` (14 tests), and `npm run package:proof-lambdas` passed.
- `sam validate --template-file infra/aws/proof-cloudformation.yaml --lint`, deployment-script shell parsing, smoke-script syntax validation, and `git diff --check` passed.
- The write-gate scan reconfirmed approval, revision, undo, public decisions, and `lift_writes_enabled` remain literal `false`.
- Browser-tested feedback and file history at 1366×768: each opened as one named/described modal with Close focused and returned focus to its exact opener. Reviewer identity focused Name and returned to the header control.
- Browser-tested the feedback-to-identity handoff: exactly one dialog remained open, identity received Name focus, and closing it returned directly to the original Feedback control.
- Browser-tested feedback/history bottom sheets at 390×844 and feedback at 844×390: initial and returned focus remained deterministic, sheets stayed inside the viewport, document overflow stayed zero, mobile mode remained active in short landscape, all decision controls remained disabled, and no browser warnings or errors were emitted.

## 2026-07-20 - Vornan Proof Bounded Automatic Refresh Lifecycle

Completed the Phase 2 cached-read refresh-policy sprint without adding a customer decision or Lift write path.

What changed:

- Added one server-owned automatic-refresh eligibility policy using the normalized order health, last synchronization time, and proof-change `updated_at` timestamp.
- Kept the 15-minute stale presentation threshold while allowing automatic queue activity only for active orders changed within 14 days by default.
- Stopped customer page loads from continuously polling Lift for complete/reference, degraded, invalid-timestamp, or long-inactive packets; cached proofs remain visible and an old active packet may still display as stale.
- Preserved authenticated manual refresh for inactive packets so the bounded automatic policy does not remove an intentional customer check.
- Added a deployment parameter and preflight-validated `PATHFINDER_PROOF_AUTO_REFRESH_MAX_INACTIVE_DAYS` range of 1–365 whole days, wired through local and protected GitHub deployments.
- Added policy, public-route, manual-refresh, and deployment-safety regression coverage.
- Kept Proof public read, grant creation, and link delivery default off. Lift approve, revision, undo, uploads, generic writes, completion events, and public decision routes remain absent or literal `false`; no deployment, external email, file navigation, or Lift write occurred.

Verification:

- `npm run test` passed all 93 workspace tests, including 46 API, 16 Proof UI, 5 Lift adapter, 15 proof-domain, and 11 template tests.
- `npm run check`, `npm run build`, `npm run test:proof-deploy` (15 tests), and `npm run package:proof-lambdas` passed.
- `sam validate --template-file infra/aws/proof-cloudformation.yaml --lint`, deployment-script shell parsing, preflight/smoke-script syntax validation, and `git diff --check` passed.
- Policy tests confirmed fresh active packets do not queue; stale recently changed active packets do; complete, degraded, invalid-timestamp, and 14-day-inactive packets do not.
- Public-route coverage confirmed the inactive packet stays visible as stale without auto-queue activity and still accepts an explicit authenticated manual refresh.
- The write-gate scan reconfirmed approval, revision, undo, public decisions, and `lift_writes_enabled` remain literal `false`.

## 2026-07-20 - First Confirmed Lift Order

- Successfully submitted the first real Pathfinder-generated Momentara payload through the PROD endpoint under the LTL Demo / 1249 sandbox profile.
- Lift accepted two mapped order lines and created order `A0226692` for Pathfinder job `JOB-994730` and Ext_ID `PFMRTNIZAX18FE`.
- Diagnosed the initial product rejection as two inactive Lift product IDs and confirmed the replacement Momentara catalog products before generating a fresh preview.
- Added Lift response normalization for accepted messages shaped as `Order Number: A#######`; the extracted number now persists on the submit attempt and job.
- Added the `Order Confirmed` processing state when Lift acceptance includes an order number, while preserving `Submitted` for accepted responses that do not provide one.
- Added read-time reconciliation so previously accepted jobs recover their Lift order number from stored response messages.
- Verified the recovered job through Pathfinder's order lookup: Lift returned order `A0226692`, status `Pending Art`, two lines, quantities 17 and 7, and the expected Momentara products.

Validation:

- `npm run check --workspace @pathfinder/lift-adapter`
- `npm run check --workspace @pathfinder/api`
- `npm run check --workspace @pathfinder/web`
- `node --import tsx/esm --test apps/api/tests/lift-submit-response.test.ts`
- Live read-only order lookup returned HTTP 200 for `A0226692`; no additional submit was sent.

## 2026-07-20 - Vornan Proof Adspace Artifact Rejection Gate

Completed the Phase 2 customer-boundary artifact-rejection slice without adding a customer decision or Lift write path.

What changed:

- Converted the authoritative handoff's Adspace artifact rejection checklist into an automated deployment-safety test.
- Scanned the Proof customer SPA, brand sources, fixtures/tests, public router and participant/feedback projection, proof-domain package, and Lift proof read adapter.
- Rejected Adspace identity/domain/integration names, cross-repository imports, Adspace-style sample identifiers, and the excluded project, venue, inventory, room, allocation, location-assignment, transit, campaign, and tenant concepts.
- Wired the gate into the existing `npm run test:proof-deploy` glob so any future customer-boundary regression blocks the deployment verification suite.
- Extended the Phase 2 contract and isolated QA runbook with the enforced scan scope and no-bypass acceptance step.
- Kept Proof public read, grant creation, and link delivery default off. Lift approve, revision, undo, uploads, generic writes, completion events, and public decision routes remain absent or literal `false`; no deployment, external email, file navigation, or Lift write occurred.

Verification:

- `npm run test` passed all 93 workspace tests, including 46 API, 16 Proof UI, 5 Lift proof adapter, 15 proof-domain, and 11 template tests.
- `npm run test:proof-deploy` passed all 17 deployment-safety tests, including both artifact-rejection gates.
- `npm run check`, `npm run build`, and `npm run package:proof-lambdas` passed.
- `sam validate --template-file infra/aws/proof-cloudformation.yaml --lint`, deployment-script shell parsing, preflight/smoke/DNS script syntax validation, and `git diff --check` passed.
- The write-gate scan reconfirmed literal `false` for approval, revision, undo, public decisions, and `lift_writes_enabled`.

## 2026-07-20 - Vornan Proof Fail-Closed Grant Prerequisite Sync

Completed the architecture-defined “grant creation performs the first sync” lifecycle hardening without adding a customer decision or Lift write path.

What changed:

- Added deterministic dependency seams around only the authenticated grant route's cache lookup, stale check, read-only sync, and grant creation steps; production defaults remain the existing services.
- Moved the default-off grant-creation gate ahead of cache lookup and synchronization so a disabled route causes zero Lift traffic and issues no grant.
- Confirmed an uncached direct Lift order synchronizes before grant issuance and a stale cached order refreshes first, while a fresh cached order avoids an unnecessary Lift read.
- Made the failure ordering explicit: a prerequisite Lift read failure returns its safe operator error and never calls grant creation or returns a raw link.
- Added route-level regression coverage for disabled, uncached, stale, fresh, and failed-read paths, including normalized order numbers and redacted operator audit context.
- Extended the Phase 2 contract and isolated QA runbook with the no-traffic disabled gate and first/stale-sync acceptance sequence.
- Kept Proof public read, grant creation, and link delivery default off. Lift approve, revision, undo, uploads, generic writes, completion events, and public decision routes remain absent or literal `false`; no deployment, external email, file navigation, or Lift write occurred.

Verification:

- `npm run test` passed all 99 workspace tests, including 50 API tests with all four authenticated grant-route lifecycle cases.
- `npm run test:proof-deploy` passed all 17 deployment-safety tests.
- Proof SPA, Lift proof adapter, and proof-domain type checks passed; the Proof production build and Lambda packaging passed.
- `sam validate --template-file infra/aws/proof-cloudformation.yaml --lint`, deployment-script shell parsing, preflight/smoke/DNS script syntax validation, and `git diff --check` passed.
- After the coordinated Order Rollup handoff normalized the shared `material` field, repository-wide `npm run check` and `npm run build` passed across API, Proof, Status, web, Order Rollup, and all shared packages. The shared rollup/store changes were retained without duplicating them inside Proof.
- The write-gate scan reconfirmed literal `false` for approval, revision, undo, public decisions, and `lift_writes_enabled`.

## 2026-07-20 - Shared Lift Order Rollup Foundation

- Added one reusable Order Rollup domain model and React presentation package for both authenticated Pathfinder job detail and the token-protected public status app.
- Transcribed the supplied Lift Standard Graphics status table for job flow `1006` and added the operator-confirmed 12-step production rail from Obtain Art through Completed.
- Kept Lift's header `ORDER_STATUS` authoritative for the entire order while resolving each line's independent `LINE_STEP_ID` and `LINE_STEP_NUMBER` into its current step and status.
- Normalized read-only Lift order lookup data into the snapshot contract, including real Lift line IDs, product names, quantities, material, final dimensions, and line steps.
- Replaced the basic internal snapshot table and duplicated public line cards with the shared responsive rollup: order context, current Lift status, line-level rails, proof previews/links when available, and package/tracking activity.
- Reworked the line-step rail after operator review: the component now uses a light Vornan forest/zinnia treatment instead of Lift's dark blue/cyan visual palette. Lift status colors remain source data only and no longer determine presentation.
- Reduced the job-detail header to status, one `View Order`/`Refresh Order` action, a compact Actions menu, and an icon-only close control. Status-link creation and diagnostic Lift/proof/package lookups remain available in the menu; Submit/Retry appears there only when the job is eligible.
- Moved internal raw snapshot JSON behind a collapsed Developer details disclosure; public snapshots remain redacted before reaching the shared component.
- Preserved the public multi-order selector, secure request flow, progress summary, and legacy token compatibility.
- Verified the existing confirmed Lift order `A0226692` read-only: header status `Pending Art`; both lines at step `1040`, `6: Obtain Art`; quantities 17 and 7; expected product, material, and dimensions. No Lift submit was sent.
- Hardened local JSON persistence after QA exposed a destructive read/write race: writes now use atomic temporary-file replacement, and only a genuinely missing store may initialize seed data. Parse/read failures preserve the existing file and surface an error instead of replacing operator data.

Validation:

- `npm run check --workspace @pathfinder/order-rollup`
- `npm run test --workspace @pathfinder/order-rollup`
- `npm run check --workspace @pathfinder/order-rollup-ui`
- `npm run check --workspace @pathfinder/api`
- `npm run check --workspace @pathfinder/web`
- `npm run check --workspace @pathfinder/status`
- `node --import tsx/esm --test apps/api/tests/local-store-durability.test.ts`
- Browser verification at desktop and 390px mobile for internal and public rollups; no page-level horizontal overflow, and the long line rail scrolls only within its line card.
- Added `docs/PROOF_THREAD_ORDER_ROLLUP_NOTE_2026-07-20.md` so the concurrent Proof thread can retain the new packages, snapshot contract, fixed API type mismatch, lockfile changes, and local-store durability behavior.

## 2026-07-20 - Shared ORDER_LINE_ID Proof Matching Contract

Completed the next Phase 1 integration slice by making real Lift line identity authoritative across Proof and the shared Order Rollup, without adding a customer decision or Lift write path.

What changed:

- Added one reusable `matchLiftLineRecord` contract to `@pathfinder/order-rollup`. It resolves `ORDER_LINE_ID` first across the complete candidate set and uses normalized `LINE_NUMBER` only as a compatibility fallback.
- Replaced the API rollup's prior line-number-first proof/package assignment with the shared matcher, preventing a conflicting line number from overriding a valid Lift line ID or assigning the same record to multiple lines.
- Made `@pathfinder/proof-domain` consume the same matcher while preserving its observable `line_number_fallback` warning.
- Verified the redacted real `A0221132` Lift capture: all four sibling proof attachments join exactly once to real `ORDER_LINE_ID` `9301338`, with no fallback warning.
- Added a conflicting-identity regression proving a valid `ORDER_LINE_ID` wins even when `LINE_NUMBER` points at another line, plus fallback and unmatched coverage.
- Extended the Phase 0 contract and isolated QA runbook with the shared identity boundary and exact-once line-assignment acceptance check.
- Kept Proof public read, grant creation, and link delivery default off. Lift approve, revision, undo, uploads, generic writes, and public decision routes remain absent or literal `false`; no deployment, DNS change, external email, Lift submit, or Lift Proof write occurred.

Verification:

- `npm run test` passed all 101 workspace tests: 51 API, 16 Proof UI, 5 Lift proof adapter, 3 Order Rollup, 15 proof-domain, and 11 template tests.
- `npm run check`, `npm run build`, `npm run test:proof-deploy` (17 tests), and `npm run package:proof-lambdas` passed.
- `sam validate --template-file infra/aws/proof-cloudformation.yaml --lint`, Proof deployment-script shell parsing, preflight/smoke/DNS script syntax validation, and `git diff --check` passed.
- The write-gate scan reconfirmed literal `false` for approval, revision, undo, public decisions, and `lift_writes_enabled`.

## 2026-07-20 - Cached Proof Projection Into Order Rollup And Status

Completed a broader read-only integration pass that makes the normalized Vornan Proof aggregate the preferred proof source for shared Order Rollup and Status, without sharing Proof authorization or enabling a Lift write path.

What changed:

- Added a single `@pathfinder/proof-domain` projection from the normalized Proof aggregate into bounded Order Rollup proof records and server-owned pending, regenerating, waiting, reviewed, and total counts.
- Excluded Proof task/attachment identities, grants, sessions, participants, feedback, audit data, and decision scope from that projection. Public Status re-allowlists proof filename, state, safe asset URL, preview kind, and creation date even when it uses the legacy raw-report fallback.
- Made authenticated order snapshot construction read the Proof cache first and skip the second Lift proof-report request whenever a normalized aggregate exists. A missing, disabled, or safely failed cache retains the existing read-only Lift fallback.
- Added the normalized proof review summary to the shared internal/public snapshot contract and Order Rollup UI. Status now distinguishes required review, regeneration, waiting, and completed review, while directing customers to their dedicated Vornan Proof email and remaining explicitly view-only.
- Preserved immutable public Status snapshots: opening a Status token does not contact Lift, exchange a Proof grant, or confer access to any Proof route.
- Added hostile-value sanitization, cached-source precedence, redaction, Status-state, and fallback regressions, and extended the Phase 0 contract plus isolated QA runbook with the shared projection boundary.
- Kept Proof public read, grant creation, and link delivery default off. Lift approve, revision, undo, uploads, generic writes, and public decision routes remain absent or literal `false`; no deployment, external email, Lift submit, or Lift Proof write occurred.

Verification:

- `npm run test` passed all 117 workspace tests in the combined Proof/Order Rollup workspace: 61 API, 16 Proof UI, 2 Status, 2 web rollup UI, 5 Lift proof adapter, 3 Order Rollup, 17 proof-domain, and 11 template tests.
- `npm run check`, `npm run build`, `npm run test:proof-deploy` (17 tests), and `npm run package:proof-lambdas` passed.
- `sam validate --template-file infra/aws/proof-cloudformation.yaml --lint`, Proof deployment-script shell parsing, preflight/smoke/DNS script syntax validation, and `git diff --check` passed.
- The write-gate scan reconfirmed literal `false` for approval, revision, undo, public decisions, and `lift_writes_enabled`.

## 2026-07-20 - Order Snapshot Freshness And Contract Guardrails

- Kept public status links immutable: opening a token reads the customer-safe snapshot already captured for that link and never polls Lift.
- Kept authenticated confirmed-order refresh operator-driven. Pathfinder checks Lift only when `View Order` or `Refresh Order` is selected.
- Added a 15-second server-side reuse window for internal order snapshots so double-clicks and repeated renders do not issue duplicate Lift order, proof, and package reads. The interval can be tuned with `PATHFINDER_ORDER_SNAPSHOT_REFRESH_MIN_MS`.
- Added explicit refresh metadata to the internal snapshot response: whether the response came from Lift or a recent snapshot, the actual check time, and the next refresh time.
- Shared rollups now always show `Last checked` internally and `Snapshot captured` publicly, even when a Lift header step is available.
- Added internal contract regression coverage for Lift header status, line step, `ORDER_LINE_ID`, proof links, and package activity.
- Added public projection coverage proving customer-safe rollup fields remain available while submit history, aggregate internal proof/package arrays, and raw Lift lookup payloads remain absent.
- Added deterministic cache-window and bounded-eviction tests.

Validation:

- `npm run check --workspace @pathfinder/api`
- `npm run check --workspace @pathfinder/web`
- `npm run check --workspace @pathfinder/order-rollup-ui`
- `node --import tsx/esm --test apps/api/tests/order-snapshot-cache.test.ts apps/api/tests/order-snapshot-contract.test.ts`

## 2026-07-20 - Real Lift Proof Gallery Validation

- Clarified the source boundary: Vornan Proof can ingest proofs for any Lift order exposed by the approved read APIs; an order does not need to originate in Pathfinder.
- Validated the shared Order Rollup against the redacted real Lift capture for `A0221132`.
- Confirmed all four sibling attachments join exactly once to authoritative Lift `ORDER_LINE_ID` `9301338`, with four distinct filenames, preview assets, and high-resolution assets.
- Kept the normalized Vornan Proof cache as the preferred shared-rollup source, with the legacy read-only proof report retained only as a compatibility fallback.
- Added explicit proof preview kinds so image thumbnails render as images while PDF/download-only files use a stable non-broken placeholder and link.
- Enforced HTTPS-only, credential-free proof assets again at the shared UI boundary for internal and public rollups.
- Reworked line proofs into responsive gallery cards with filename, state, posted date, preview, and de-duplicated preview/high-resolution actions.
- Preserved the capability boundary: the shared Order Rollup contains no approve, revision, upload, grant, or session controls. Customer proof decisions remain exclusive to the separately gated Vornan Proof flow.
- Added server-rendered UI coverage for four sibling proof cards and API coverage using the redacted real fixture.

Validation:

- `npm run test --workspace @pathfinder/web`
- `node --import tsx/esm --test apps/api/tests/order-rollup-real-proof.test.ts apps/api/tests/order-snapshot-contract.test.ts`
- `npm run check --workspace @pathfinder/order-rollup-ui`
- `npm run check --workspace @pathfinder/proof-domain`
- `npm run check --workspace @pathfinder/api`

## 2026-07-20 - Customer-Safe Lift Order Header Enrichment

- Extended the shared Order Rollup normalization with confirmed Lift header values for `PO_NUMBER`, `SHIP_DATE`, `ACTUAL_SHIP_DATE`, order title/type, and header status/step.
- Kept the submitted Pathfinder order as the compatibility source for contract number, delivery/due date, and destination when the Lift order lookup does not return those fields.
- Added per-field provenance so the shared Pathfinder and public Status views say `Confirmed by Lift` or `Submitted order` without exposing implementation details.
- Expanded the shared order context to show Lift order, PO, contract, order type, requested ship, delivery/due, actual ship, destination, and proof/package activity.
- Fixed date-only rendering so Lift `YYYY-MM-DD` values cannot shift by one day because of browser timezone conversion.
- Added a customer-safe destination allowlist. Public status snapshots retain company/addressee/address/city/state/postal/country and remove phone, email, billing account, delivery instructions, and unrecognized shipping fields.
- Verified the actual Lift lookup contract for completed order `A0219609` read-only: the endpoint returns `PO_NUMBER`, `SHIP_DATE`, `ACTUAL_SHIP_DATE`, `ORDER_STATUS`, `ORDER_STEP_ID`, and `HEADER_STEP_NUMBER`; it does not currently return contract or destination fields.
- Preserved immutable token snapshots and on-demand internal refresh behavior. No polling, deployment, submit, email, Proof decision, or Lift write was added.

Validation:

- `npm run check --workspace @pathfinder/order-rollup`
- `npm run test --workspace @pathfinder/order-rollup`
- `npm run check --workspace @pathfinder/order-rollup-ui`
- `npm run test --workspace @pathfinder/api`
- `npm run test --workspace @pathfinder/web`
- Repository-wide `npm run check`, all 119 workspace tests, `npm run build`, and `git diff --check` passed.

## 2026-07-20 - Customer-Safe Shipment Summary

- Added one shared shipment-summary contract to `@pathfinder/order-rollup` for Pathfinder and `status.vornan.co`.
- The summary truthfully reports package count, unique tracking-number count, ship-method count, bounded ship methods/locations, and up to three tracker messages without inferring a delivered or in-transit state Lift did not explicitly return.
- Added a strict customer-safe package allowlist for tracking number, ship method, tracker message, box number, package type, and location name.
- Public status projection now structurally removes Lift header/shipping IDs, negotiated rates, dimensions, weight, account values, product/manufacturing package fields, and all unknown properties from each line package before snapshot persistence or rendering.
- Added a compact responsive shipment summary and clearer per-line package cards with separate package identity, tracking state, carrier message, method, and location context.
- Inspected completed Lift order `A0219609` through the existing PackageDetails GET endpoint read-only. The real response contains 81 line/package records, Courier activity, no tracking numbers in that capture, and a negotiated-rate field that remains redacted.
- Preserved immutable public status links and operator-driven internal refresh. No polling, deployment, submit, email, Proof decision, or Lift write was added.

Validation:

- `npm run check --workspace @pathfinder/order-rollup`
- `npm run test --workspace @pathfinder/order-rollup`
- `npm run check --workspace @pathfinder/order-rollup-ui`
- `npm run test --workspace @pathfinder/api`
- `npm run test --workspace @pathfinder/web`
- Repository-wide `npm run check`, all 121 workspace tests, `npm run build`, and `git diff --check` passed.

## 2026-07-20 - Vornan Proof Local QA Store Durability

Completed the next Phase 1 persistence-hardening slice without adding a customer decision or Lift write path.

What changed:

- Made the dedicated local Proof store distinguish a genuinely missing file from every other read, parse, or schema-shape failure. Existing malformed QA lifecycle data now fails closed and remains byte-for-byte intact.
- Added structural validation for every top-level Proof store collection so valid JSON with an unsafe shape cannot be silently normalized to an empty store and overwritten.
- Replaced direct writes with same-directory temporary files followed by atomic rename, preventing readers from observing a partially written JSON document.
- Serialized all local Proof read-modify-write mutations within one API process so concurrent session, participant, acknowledgement, grant, order, and audit updates do not overwrite one another.
- Added subprocess regression coverage for malformed JSON, invalid collection shapes, 25 concurrent session mutations, byte preservation, and temporary-file cleanup.
- Recorded the remaining local-development boundary: separate API processes must use distinct `PATHFINDER_PROOF_LOCAL_STORE_PATH` values. Production remains on the dedicated DynamoDB tables.
- Kept Proof public read, grant creation, and link delivery default off. Lift approve, revision, undo, uploads, generic writes, and public decision routes remain absent or literal `false`; no deployment, external email, Lift submit, or Lift Proof write occurred.

Verification:

- `npm run test` passed all 108 workspace tests: 58 API, 16 Proof UI, 5 Lift proof adapter, 3 Order Rollup, 15 proof-domain, and 11 template tests.
- `npm run check`, `npm run build`, `npm run test:proof-deploy` (17 tests), and `npm run package:proof-lambdas` passed.
- `sam validate --template-file infra/aws/proof-cloudformation.yaml --lint`, Proof deployment-script shell parsing, preflight/smoke/DNS script syntax validation, and `git diff --check` passed.
- The write-gate scan reconfirmed literal `false` for approval, revision, undo, public decisions, and `lift_writes_enabled`.

## 2026-07-20 - Proof Read-Only Operational Readiness Signals

Completed a coordinated Phase 1 read-only pass across synchronization diagnostics, reviewer presence, and lifecycle observability without adding customer decisions, external event delivery, or Lift writes.

What changed:

- Added a bounded, sanitized sync-diagnostics summary to each internal Proof aggregate: line reads attempted/succeeded/failed, proof-row totals, fallback outcome, and normalization-warning count. Raw Lift URLs, line IDs, credentials, response bodies, and errors never enter the stored summary or operator response.
- Exposed those diagnostics only in the authenticated operator Proof panel so operators can distinguish healthy line-scoped reads, fallback reads, and normalization warnings without receiving sensitive Lift request details.
- Added aggregate-only reviewer activity to the customer packet: identified reviewer count and latest activity time. The public response returns the current session's optional identity separately and never exposes another participant's name or email.
- Added read-derived `proof.review_ready`, `proof.all_reviewed`, and `proof.review_reopened` lifecycle transitions to the restricted immutable audit stream. No-op synchronization emits no duplicate transition, and each event contains only bounded review-state counts.
- Kept lifecycle transitions observational: this slice does not dispatch an external event, send customer email, create a decision, or contact a Lift write endpoint.
- Added a dedicated aggregate-activity visual-QA fixture and verified desktop and 390px mobile layouts. The page matched the viewport without horizontal overflow, the reviewer count remained compact, and all 10 rendered decision controls remained disabled.
- Updated the Phase 0 contract and isolated QA runbook with the diagnostic redaction, aggregate-presence, transition-idempotency, and reviewer-privacy acceptance checks.
- Preserved the concurrent Order Rollup header-source contract by retaining its literal field-source types.

Verification:

- `npm run test` passed all 120 workspace tests: 61 API, 17 Proof UI, 2 Status, 2 web rollup UI, 5 Lift proof adapter, 4 Order Rollup, 18 proof-domain, and 11 template tests.
- `npm run check`, `npm run build`, `npm run test:proof-deploy` (17 tests), and `npm run package:proof-lambdas` passed.
- `sam validate --template-file infra/aws/proof-cloudformation.yaml --lint`, Proof deployment-script shell parsing, and preflight/smoke/DNS script syntax validation passed.
- The source scan reconfirmed literal `false` for approval, revision, undo, public decisions, and `lift_writes_enabled`; the public router still contains no decision route.
- No deployment, DNS change, external email, Lift submit, Proof approval/revision/undo request, or Lift Proof write occurred.

## 2026-07-20 - Proof Phase 2 Release-Readiness Hardening

Completed the next coordinated Phase 2 batch around operator integration posture, complete public-route telemetry, and protected deployment validation without enabling customer decisions or changing external infrastructure.

What changed:

- Expanded the authenticated Proof health contract with safe sync-queue, freshness-policy, edge-boundary, public-host, and session/grant-policy configuration facts. The response exposes only booleans, bounded values, and hostnames; it excludes the edge secret, queue URL, Lift paths/queries, credentials, customer identifiers, and files.
- Added an operator Integration health card that distinguishes local read-only QA, incomplete deployed configuration, dark-deploy readiness, and an active read-only public boundary. It keeps the approval, revision, undo, and Lift-write lock visible and never implies Phase 3 readiness.
- Classified every existing Phase 2 public route into a fixed low-cardinality telemetry operation. Task history and feedback acknowledgement never use task IDs as dimensions, and unknown or future routes remain in the bounded `unknown_public_route` bucket.
- Extended the CloudWatch dashboard with p95 latency for token exchange, cached reads, task history, participant identity, feedback acknowledgement, manual refresh, and logout.
- Closed the Proof workflow validation gap by running `npm run test:proof-deploy` before AWS credential configuration or artifact upload. Preserved the shared repository validation workflow, main-branch deployment guards, and release coordination guide unchanged.
- Classified `.codex-proof-qa/` and `design-qa.md` as local visual-QA scratch and added ignore rules so they cannot enter a broad release staging command. Retained `docs/VORNAN_PROOF_PATHFINDER_ARCHITECTURE_HANDOFF_2026-07-19.docx` as the intentional authoritative architecture artifact.
- Updated the architecture contract and read-only QA runbook with the operator posture, health redaction, per-route telemetry, and protected workflow acceptance checks.

Verification:

- `npm run test` passed all 125 workspace tests: 63 API, 17 Proof UI, 2 Status, 4 web, 5 Lift proof adapter, 5 Order Rollup, 18 proof-domain, and 11 template tests.
- `npm run check`, `npm run build`, `npm run test:proof-deploy` (17 tests), and `npm run package:proof-lambdas` passed.
- `sam validate --template-file infra/aws/proof-cloudformation.yaml --lint`, Proof deployment-script shell parsing, preflight/smoke/DNS script syntax validation, and `git diff --check` passed.
- Browser QA at 1440×1000 and 760×900 confirmed a legible operator health card, no horizontal overflow, correct local-QA posture, and visible locked capability copy.
- The source scan reconfirmed literal `false` for approval, revision, undo, public decisions, and `lift_writes_enabled`; the public router still contains no decision route.
- No commit, push, merge, deployment, DNS change, external email, Lift submit, Proof decision request, or Lift Proof write occurred in this pass.

## 2026-07-20 - Combined Release Checkpoint

Prepared the shared Pathfinder and Vornan Proof worktree as one reviewed release candidate on `codex/vornan-proof-foundation`.

Release controls:

- Added a non-deploying `Validate Pathfinder` workflow for pull requests and pushes to `main`.
- Production API, admin-web, and status-web workflows now reject non-`main` refs and run the full workspace test suite before publishing.
- Documented the branch, staging, rollout, smoke-test, and rollback procedure in `docs/RELEASE_COORDINATION_2026-07-20.md`.
- Classified `.codex-proof-qa/` and `design-qa.md` as ignored local QA scratch; retained the sanitized Proof architecture DOCX as an intentional release artifact.
- Independently reviewed the full tracked/untracked file set and found no unrelated repository changes, credential signatures, unexpected symlinks, or oversized source artifacts.

Final pre-commit validation from the frozen combined tree:

- `npm run check` passed all workspaces.
- `npm run test` passed all 125 tests: 63 API, 17 Proof UI, 2 Status, 4 web, 5 Lift proof adapter, 5 Order Rollup, 18 proof-domain, and 11 template tests.
- `npm run build` passed all production builds.
- `npm run test:proof-deploy` passed all 17 deployment-safety tests.
- `npm run package:api-lambda` and `npm run package:proof-lambdas` rebuilt both deployable archives.
- `sam validate --lint` passed for both API and Proof CloudFormation templates.
- GitHub workflow YAML, deployment/package shell scripts, credential-pattern scan, write-gate scan, and `git diff --check` passed.
- Proof public reads, grant creation, link email, approval, revision, undo, public decisions, and Lift writes remain disabled by default. No Lift submit or Proof write was performed during release validation.

## 2026-07-20 - Protected Proof Dev OIDC Trust

The first dark Proof deployment passed repository validation but AWS rejected its protected-environment OIDC subject before any resource changed. The existing deploy role trusted only the `main` branch subject, while a GitHub Actions job attached to the protected `dev` environment presents an `environment:dev` subject.

- Added only `repo:ltl-mdavies/vornan_pathfinder:environment:dev` alongside the existing `main` subject in the versioned deploy-role trust policy.
- Kept a Proof `prod` environment subject out of scope so production Proof infrastructure still requires a separate reviewed trust change.
- Preserved `public_read_enabled=false`, `read_only_qa_confirmed=false`, `production_public_read_approved=false`, managed WAF protection, and every Proof write/decision gate as disabled for the retry.
- The failed run changed no AWS resource because credential assumption failed before deployment, artifact upload, or CloudFormation execution.
- Added a deployment-safety regression test that requires exactly the reviewed `main` and protected `dev` subjects and rejects implicit Proof production trust; all 18 deployment-safety tests and the workspace type checks pass.

## 2026-07-20 - Proof Encrypted-Bucket Deployment Permission

The first CloudFormation-backed dark deployment reached isolated resource creation, then rolled back because the versioned deploy policy's `s3:PutBucket*` pattern does not include AWS's separately named `s3:PutEncryptionConfiguration` action.

- Added the explicit get/put encryption actions required for the Proof web bucket's server-side encryption configuration.
- Added `s3:DeleteBucketPolicy` so a failed or intentionally removed Proof stack can roll back its bucket policy cleanly.
- Kept every S3 permission scoped to `vornan-pathfinder-artifacts` and `vornan-pathfinder-proof-*`; no `s3:*` permission was added.
- Added a deployment-safety regression test for the required actions, exact resource scope, and absence of a global S3 wildcard.
- The failed stack entered CloudFormation rollback before SPA publication or smoke testing. Public Proof reads and every decision/write gate remained disabled.

## 2026-07-20 - Proof CloudFormation Handler Lifecycle Permissions

The next dark deployment passed encryption setup and advanced to API Gateway stage creation, where CloudFormation failed closed because `AWS::ApiGatewayV2::Stage` requires the separately named `apigateway:TagResource` permission.

- Audited every Proof template resource against the AWS-published CloudFormation resource-handler schemas rather than continuing one denial at a time.
- Added only the handler actions relevant to the Proof stack's create, update, tagging, and rollback lifecycle: API Gateway tags, Lambda reserved concurrency/tags, SQS queue URL lookup, DynamoDB untags, observability tags/retention updates, IAM role inspection/update tags, CloudFront tag lifecycle, and WAF untags.
- Reconciled handler operation names with IAM authorization: CloudFront's `CreateDistributionWithTags` API operation remains authorized by the existing `cloudfront:CreateDistribution` plus `cloudfront:TagResource` actions. The observed API Gateway stage denial and IAM policy simulator both require the newer `apigateway:TagResource` authorization even though Access Analyzer's action catalog has not yet caught up; that discrepancy is recorded rather than bypassed.
- Preserved Proof-only resource ARNs for compute/data/IAM and the existing service-required `Resource: "*"` statements for CloudWatch, logs, API Gateway, CloudFront, and WAF. No full-service action such as `lambda:*`, `iam:*`, `s3:*`, or `cloudfront:*` was added.
- Expanded the deployment-safety regression test to require the reviewed lifecycle actions and reject global service action wildcards.
- The failed deployment again rolled back before SPA publication or smoke testing. Public Proof reads and every decision/write gate remained disabled.

## 2026-07-21 - Proof HTTP API Log-Delivery Permissions

The clean dark-deployment retry passed the previously blocked API Gateway tag operation, then failed closed when CloudFormation configured access logging on the private Proof HTTP API stage without `logs:CreateLogDelivery` authorization.

- Added the complete AWS-documented CloudWatch Logs delivery lifecycle required to activate and maintain HTTP API access logging: create, get, list, update, and delete log delivery, plus resource-policy read/write access.
- Kept those service-required operations in the existing observability statement with `Resource: "*"`; no `logs:*` wildcard or application data permission was added.
- Expanded the deployment-safety regression test so the complete reviewed logging lifecycle remains present and full-service wildcards remain forbidden.
- The failed retry rolled back before SPA publication or smoke testing. Public Proof reads, grant creation, link email, approval, revision, undo, public decisions, and Lift writes all remained disabled.

## 2026-07-21 - Proof Event-Source Mapping Resource Scope

The next dark-deployment retry passed HTTP API stage creation and created its encrypted tables, queues, log groups, and web bucket. CloudFormation then failed closed because the deploy policy allowed the Lambda event-source mapping actions only against function, table, and queue ARNs rather than Lambda's separately defined event-source-mapping ARN.

- Added a dedicated lifecycle statement scoped to `arn:aws:lambda:us-east-1:744016783602:event-source-mapping:*` for read, update, delete, and tag operations.
- Added `lambda:CreateEventSourceMapping` with the AWS-supported `lambda:FunctionArn` condition restricted to `vornan-proof-*` functions; mapping ARNs cannot scope creation because the mapping does not exist yet.
- Added only `lambda:ListEventSourceMappings` with `Resource: "*"`, as required by the CloudFormation handler and AWS IAM's non-resource-scoped list operation.
- Added regression coverage for the exact mapping ARN, lifecycle action set, and single global list action; no `lambda:*` wildcard was added.
- The failed retry again rolled back before SPA publication or smoke testing. Public Proof reads and every Proof decision/write capability remained disabled.

## 2026-07-21 - Combined Release And Proof Dark Deployment Complete

Completed the coordinated release checkpoint across Pathfinder production surfaces and the isolated Vornan Proof `dev` foundation.

Release evidence:

- Merged the combined Pathfinder/Proof checkpoint through PR #3. Production API, admin web, and status web deployed successfully from merged `main` commit `5afbb69` in GitHub Actions runs `29786460634`, `29786589756`, and `29786666131`.
- Production smoke checks returned HTTP 200 for API health, `pathfinder.vornan.co`, and `status.vornan.co`; API health reported the expected DynamoDB and Secrets Manager readiness.
- Merged the protected Proof OIDC trust and narrowly scoped deployment-lifecycle corrections through PRs #4-#8. The final successful dark deployment used merged `main` commit `f250f29` in run `29791214408`.
- The `vornan-proof-dev` CloudFormation stack reached `CREATE_COMPLETE`; the workflow published the SPA, passed the full dark read-only smoke suite, and completed the DNS-readiness handoff without changing DNS.
- An independent post-workflow smoke confirmed `public_read_enabled: false`, `decisions_enabled: false`, and direct API bypass rejection. Stack parameters independently confirmed managed WAF enabled while `PublicReadEnabled`, `ReadOnlyQaConfirmed`, and `ProductionPublicReadApproved` remain false.
- No customer grant, link email, public token exchange, Proof decision, Lift submit, Lift Proof write, or DNS cutover was performed. The deployed Proof tables were created by the dark stack; no synchronization or customer data load was triggered by release verification.

The only workflow annotation was GitHub's upstream Node.js action-runtime deprecation warning for current `@v4` actions being forced onto Node.js 24. It did not affect validation or deployment and can be addressed in a later maintenance slice when compatible action releases are available.

## 2026-07-21 - Proof Isolated Zero-Data Dark QA

Completed the first isolated read-only QA slice against the deployed `vornan-proof-dev` stack from `origin/main` commit `fda2f29` without changing Pathfinder production surfaces or any deployed feature gate.

- Re-ran the repository dark smoke against the CloudFront distribution and direct API endpoint. Public read and decisions remained off, invalid exchange failed closed, unauthenticated reads were denied, decision/write routes were absent, and direct API bypass returned HTTP 403.
- Confirmed the distribution is deployed without a custom alias and has managed WAF attached. The private SPA bucket blocks public access and remains encrypted and versioned.
- Confirmed both dedicated DynamoDB tables are encrypted, PITR-enabled, and empty; the isolated queue and DLQ are encrypted and empty; the event-source mapping is enabled without processing a message.
- Confirmed all nine Proof alarms are `OK`, the dashboard exists, log retention is 30 days, and the zero-data probes produced no retained log events or sensitive evidence.
- Confirmed deployed metrics use only the bounded `Environment`, `Operation`, and `Service` dimensions.
- Browser-tested the deployed production SPA at `1366×768`, `390×844`, `320×568`, and `844×390`: every viewport failed closed to the session-ended state, horizontal overflow remained zero, and development-only QA fixture hashes were not exposed.
- Recorded the safe identifiers, results, and intentionally deferred lifecycle in `docs/VORNAN_PROOF_DARK_QA_EVIDENCE_2026-07-21.md`.
- The focused evidence tree passed all 125 workspace tests, every workspace check and production build, all 21 Proof deployment-safety tests, Proof Lambda packaging, SAM lint, workflow/script syntax, literal write-gate scanning, and `git diff --check`.

This is a pass for the zero-data dark boundary, not Phase 2 lifecycle confirmation. No QA order was invented; no Lift synchronization, grant, session, email, DNS, public read, customer decision, Lift submit, or Lift Proof write was performed. `ReadOnlyQaConfirmed` remains false.

## 2026-07-21 - Proof Purgeable Synthetic Lifecycle QA

Completed the first full non-customer lifecycle in the isolated `vornan-proof-dev` stack from `origin/main` commit `77a000b`.

- Added a dev-only fixture using reserved order `A00000000`, marker `SYNTHETIC QA — NOT A CUSTOMER`, and bounded `vpqa-*` identities. CloudFormation and preflight reject it unless the stack is fully dark, alias-free, and unconfirmed.
- Exercised the real FIFO worker path for a one-line/one-task cached aggregate and a controlled pre-Lift failure. The failure retried five times, entered the DLQ, and triggered both sync-failure and DLQ alarms.
- Exercised one-time grant exchange, hardened session/CSRF cookies, cached order read, participant identity, task history, feedback acknowledgement, logout, post-logout denial, and grant revocation inside a non-listening process connected only to isolated dev tables.
- Confirmed all required audit actions and bounded telemetry dimensions. The first attempt exposed an Express mount-path telemetry timing defect; it was purged, fixed with regression coverage, redeployed, and the second run emitted `cached_order_read` correctly.
- Corrected a second telemetry edge case found by the post-cleanup smoke: a deliberately disabled public lifecycle now records its HTTP 503 as a denial instead of a server error, while genuine 503 failures remain alarmable.
- Browser-tested fail-closed deployed states at `1366×768`, `390×844`, `320×568`, and `844×390`; there was no horizontal overflow or fixture exposure.
- Purged the passing fixture exactly: 7 core records, 13 audit records, and one DLQ message. Verified zero residual records/messages, restored the 90-second queue visibility timeout, and redeployed with `SyntheticQaEnabled=false`.
- Allowed the intentional CloudWatch evaluation windows to expire and verified all nine Proof dev alarms returned to `OK` without manually changing alarm state.
- Recorded complete evidence and deferred real-data checks in `docs/VORNAN_PROOF_SYNTHETIC_LIFECYCLE_QA_2026-07-21.md`.

Verification:

- `npm run check`, `npm run build`, Proof Lambda packaging, SAM lint, script/workflow syntax, credential/write-gate scans, and `git diff --check` passed.
- `npm run test` passed all 131 workspace tests.
- `npm run test:proof-deploy` passed all 25 deployment-safety tests.
- The lifecycle harness TypeScript check passed independently.
- The post-cleanup deployed smoke passed with public read and decisions false and direct API bypass rejected.

Public read, `ReadOnlyQaConfirmed`, production public approval, DNS, grant/link email, decisions, and every Lift write remain disabled. No Lift request or Pathfinder production-surface change occurred. The next step requires explicit approval for one exact read-only Lift QA order.

## 2026-07-21 - Approved Lift Read-Only QA A0226701

Completed the explicitly approved direct-Lift order slice for `A0226701` in the isolated dark `vornan-proof-dev` stack.

- The first production Lift GET sync normalized 3 unique order lines and 3 unique Proof attachments. Every task matched a real cached `ORDER_LINE_ID`; all 3 line-scoped report reads succeeded with no fallback or normalization warning.
- Exact read-only checks found no `A0226701` match in production Pathfinder jobs or submit attempts, classifying this as the Lift-originated case. No production Pathfinder record was changed.
- The first unchanged refresh exposed rotating signed proof URL queries being treated as false file versions. Field-category and URL-identity checks confirmed only query signatures changed; all proof origins/paths and metadata remained stable.
- Updated Proof-domain change detection to ignore query/fragment rotation while refreshing the current usable URLs and preserving version IDs/history. Genuine asset host/path or metadata changes still version normally.
- Reset only the exact dev QA partition, deployed the correction only to the dark Proof dev stack, and repeated the first/unchanged sync pair. Order/task versions and history stayed at 1; the sanitized content hash remained identical; `proof.review_ready` remained single-shot.
- Across discovery and confirmation, the worker completed 16 adapter GETs with no error, fallback, DLQ message, sensitive log field, public exposure, or Lift write. All nine alarms remained `OK`.
- Recorded the sanitized evidence in `docs/VORNAN_PROOF_LIFT_READ_ONLY_QA_A0226701_2026-07-21.md`.

Verification passed all workspace checks/builds, all 133 workspace tests, all 25 Proof deployment-safety tests, Proof Lambda packaging, the post-cache dark smoke, sanitized telemetry/log scans, queue/DLQ checks, and `git diff --check`.

The corrected isolated cache retains only one profile, three tasks, and three versions for the approved order; it has no grant/session records. Public read, `ReadOnlyQaConfirmed`, production approval, DNS, email, decisions, and every Lift write remain disabled. A separately approved Pathfinder-originated order is still required.

## 2026-07-21 - Jobs Management And Drill-In UX

Completed the first post-demo operator cleanup slice without changing Lift submit behavior or any Vornan Proof gate.

- Customer and global Jobs views now open one job on a dedicated detail surface with an explicit `All jobs` return action instead of expanding the detail beneath the list.
- Jobs can be filtered by Active, Archived, or All and sorted by Updated, Created, or State in ascending or descending order.
- Added row selection, select-all, and confirmed single or bulk archive/restore actions. Archiving is a reversible visibility control: the job state, Lift order association, submit attempts, audit history, and status links remain intact.
- Added authenticated API endpoints for single and bulk archive/restore plus durable archive timestamp and actor metadata.
- Replaced the job-detail native disclosure with the app's controlled Actions menu and made both job and top-bar menus close on outside click or Escape.
- Added API regression coverage proving that archive and restore preserve operational job state and that independently archived jobs remain archived.
- Browser verification covered list-to-detail navigation, outside-click menu dismissal, single archive, Archived filtering, and bulk restore. No Lift submit or external write occurred.

Validation for this slice:

- `npm run check` passed every workspace.
- `npm run test` passed all 139 tests on the merged Proof baseline, including 70 API tests and the new job archive durability test.
- `npm run build` passed all production builds.

## 2026-07-21 - Manual Import Saved Method Basis And UI Polish

Completed the next Manual Import usability slice on top of the Jobs cleanup work without changing Lift transport, submit gates, or Vornan Proof behavior.

- Manual Import now starts from an explicitly selected active Import Method and reuses that method's parser configuration, field mappings, product resolution, order-name resolution, Ext_ID strategy, and output route.
- Operators can choose `Ad-hoc manual mapping` when a one-off upload should not use or modify a saved Import Method. Ad-hoc preview jobs persist normally while the temporary mappings remain isolated from saved method configuration.
- The selected output route continues to provide the enabled submit profiles. Source and submit customer details now use a narrow-safe stacked layout so names and Lift Customer IDs remain visible without horizontal overflow.
- Jobs filter and sort selects now use the application's standard compact select appearance, including the custom arrow and focus treatment.
- The Transactional Email panel-header warning now uses accessible white text on the amber warning background.
- Added regression coverage proving an ad-hoc preview does not create or mutate a saved Import Method and a saved-method preview continues to update that method's run metadata.

Validation for the combined Jobs and Manual Import work:

- `npm run check` passed every workspace.
- `npm run test` passed all 140 tests.
- `npm run build` passed all production builds.
- Local browser verification confirmed saved/ad-hoc basis switching, complete Submit Profile content at a 477px panel width, styled Jobs selects, white warning-chip text, zero page overflow, and no console errors.

## 2026-07-21 - Customer Order Dropbox Foundation

Started the customer-facing intermediary intake workflow on `codex/customer-order-dropbox` after checkpointing and pushing the confirmed Jobs/Manual Import work as commit `c71663a` on `codex/jobs-management-ux`.

- An Active Import Method can now publish a private customer order page with a server-generated high-entropy URL key, customer-specific headline/instructions, work-email/domain gate, row limit, and controlled submit profile.
- The public page lives within the existing `status.vornan.co` application at `/intake/<private-key>` and accepts XLSX, XLS, CSV, drag/drop, or pasted grid data.
- Source parsing, sheet/header behavior, field mappings, product resolution, order-name resolution, Ext_ID strategy, output route, and submit profile remain server-controlled by the saved Import Method; none of those controls are exposed publicly.
- The customer sees only a bounded visual confirmation of product, quantity, final width/height, and whether each row is ready or needs Vornan review.
- Confirming the intake creates a normal Pathfinder preview job, records the intake channel and submitting email, and returns a Pathfinder reference. It does not call Lift, bypass certification, or expose a public submit control.
- Public configuration responses are allowlisted, file bodies default to a 5 MB ceiling, order rows are bounded per published method, and preview/submit endpoints use page, email, and IP rate limits.
- Disabling the published dropbox immediately makes its page unavailable while retaining the key for safe reactivation.
- Added regression coverage for safe public configuration, email-domain rejection, saved-method parsing, row preview, internal job creation, intake audit metadata, disabled-page behavior, and the absence of a Lift submission.
- Refined the customer-facing default headline to the customer-neutral `Put your print order in motion.` and replaced the publication/email browser checkboxes with consistent accessible Pathfinder switches.

## 2026-07-21 - Public Intake Job Visibility

Started the first operational follow-up after the Customer Order Dropbox checkpoint.

- Jobs now identifies customer-dropbox submissions separately from operator-created jobs and includes the submitting work email in the authenticated operator view.
- Added an Intake filter for all jobs, customer dropbox jobs, or operator workspace jobs alongside the existing archive and sort controls.
- Job detail repeats the intake origin and customer submission timestamp so operators do not have to infer provenance from the source filename.

This is the first publish/review foundation. Transactional email verification, customer-managed authentication, automated Lift submission, and Wrike ingestion remain separate future policies and were not enabled.

## 2026-07-21 - Customer Dropbox Private-Link Lifecycle

Completed the private-link security follow-up on `codex/public-intake-link-lifecycle` after committing and pushing the operator visibility checkpoint as `833c5ed`.

- Added authenticated, explicit Rotate and Revoke operations to each published Customer Order Dropbox.
- Rotation keeps the page published, issues a new high-entropy key, and invalidates the previous customer URL immediately.
- Revocation invalidates the current URL immediately, clears the stored key and publication timestamp, and unpublishes the dropbox. Publishing it again creates a fresh key.
- Both operations require a purpose-specific confirmation. Lifecycle controls are disabled while the Import Method has unsaved changes so a security action cannot silently discard draft configuration.
- Public configuration and submission routes continue to resolve only the single current key for an Active, published Import Method. No previous key is returned or retained as a usable alias.
- Regression coverage proves old-link rejection after rotation, replacement-link availability, rejection after revocation, and fresh-key issuance after republishing.

This slice does not change Lift transport, preview certification, Proof gates, transactional email, or deployment state.

Validation for this slice:

- `npm run check`, `npm run test`, and `npm run build` passed across every workspace (149 tests total).
- Local browser QA confirmed both purpose-specific confirmations, enabled saved-state controls, a full-width 390px action layout with no horizontal overflow, and no console warnings or errors.

## 2026-07-21 - Approved Pathfinder-Originated Proof QA A0226753

Completed the explicitly approved Pathfinder-originated read-only Proof validation for `A0226753` in the isolated dark `vornan-proof-dev` stack.

- Reviewed and merged Proof lifecycle PR #11 to `main` at `b6a3838`, then created fresh branch `codex/proof-pathfinder-origin-readonly-qa` from that exact commit.
- Exact production Pathfinder reads matched job `job_20260721171005_2cf369`, Pathfinder order / Lift `Ext_ID` `PFMRUWSQ4N1735`, accepted target order `A0226753`, sandbox destination `LTL Demo` / `1249` / company `91`, three lines, and total quantity 31.
- The clean GET-only sync cached three Lift lines and three unique Proof tasks. All three tasks matched exactly one cached `ORDER_LINE_ID`; all three line-scoped report reads succeeded with no fallback, warning, unmatched task, or duplicate association.
- The unchanged refresh preserved order/task versions, current version IDs, and one history entry per task. The sanitized stable-content hash remained `e31baa5dcfcc355f064de561c9cc94a43ede3599f2092b79801eaf6ac724d3c6`.
- Audit idempotency produced exactly two `proof.sync_completed` records and one `proof.review_ready` record. CloudWatch recorded two bounded sync operations with zero server errors; queues and DLQ ended empty, all nine alarms remained `OK`, and sensitive log scans returned zero matches.
- The post-run dark smoke passed with public read and decisions false and direct API bypass rejected. No Proof or Pathfinder production deployment was required.
- Recorded complete sanitized evidence and the exact optional cleanup procedure in `docs/VORNAN_PROOF_PATHFINDER_ORIGIN_READ_ONLY_QA_A0226753_2026-07-21.md`.

The isolated dev cache retains one profile, three tasks, and three versions for focused inspection, with no grant/session records. The production Pathfinder job, submit attempt, and Lift order were read only and were not modified or resubmitted. Public read, `ReadOnlyQaConfirmed`, production approval, DNS, email, decisions, and every Lift write remain disabled.

## 2026-07-21 - Proof Phase 2 Activation-Readiness Gate

Added a deterministic, non-mutating checkpoint that separates completed isolated read-only evidence from authorization to expose a customer boundary.

- Added `npm run check:proof-phase2`, a bounded readiness-state artifact, and a repository validation-workflow step. The evaluator consumes only literal booleans and emits fixed gate names, counts, status, and next-action values; unknown fields cannot leak identifiers or free-form evidence into its output.
- Recorded all 11 isolated read-only evidence gates as passed across the dark boundary, purgeable synthetic lifecycle, approved direct-Lift read, approved Pathfinder-originated read, stable refresh, line correlation, audit, queue failure, telemetry/alarms/logs, and responsive fail-closed checks.
- Recorded all eight dark guardrails as intact. Public read, grant creation, link email, decisions, Lift writes, DNS, `ReadOnlyQaConfirmed`, and production public-read approval remain disabled.
- Kept the three activation prerequisites false: deployed grant/session lifecycle, deployed one-order customer boundary, and explicit read-only activation approval.
- The current result is `isolated_read_qa_complete_activation_blocked`. Even a future fully passing input yields only `ready_for_explicit_activation_review`; the tool always reports public-read changes and mutations as unauthorized.

This slice performs no AWS call, Lift request, email delivery, DNS change, deployment, decision, or production-surface mutation. It does not enter Phase 3.

## 2026-07-21 - Proof Customer-Boundary QA Harness

Prepared the next Phase 2 deployed-boundary validation without enabling or executing it.

- Added a pure stack-contract evaluator that accepts only an alias-free, WAF-protected `vornan-proof-dev` window with public read and isolated read-only confirmation temporarily true, production approval false, the synthetic worker false, and all required isolated table/endpoint outputs present. The evaluator never authorizes deployment or mutation.
- Added an explicitly confirmation-gated runner restricted to the retained reserved synthetic fixture. It creates one view-only grant directly against the isolated dev tables, exchanges it through CloudFront, verifies one-time token use, one-order/session scope, history isolation, CSRF-bound participant and feedback records, terminal logout, direct API bypass denial, bounded audit coverage, and automatic grant revocation.
- The runner never emits its raw fragment token, cookies, CSRF value, access URL, or payload. It sets link email, approval, revision, undo, and generic Lift-write flags false and contains no Lift `PUT` transport.
- Added regression coverage for environment, stack, WAF, alias, production-approval, output, synthetic-only, confirmation, no-email/no-write, bypass-denial, and finally-revocation gates.
- Added the explicit approval, controlled run, responsive follow-up, rollback, and exact-fixture cleanup plan to the read-only QA runbook.

The harness was typechecked and unit-tested but was not run against AWS. The stack remains dark; no grant, session, participant, feedback acknowledgement, deployment, email, custom domain, decision, or Lift request was created by this slice.

## 2026-07-21 - Proof Controlled Customer-Boundary QA

Executed the explicitly approved temporary Phase 2 boundary window against the isolated `vornan-proof-dev` stack using fresh reserved fixture `vpqa-20260721-boundary-01`.

- Enabled synthetic mode only while the stack was dark, created one cached line/task aggregate, and exercised deployed queue success plus a controlled five-attempt pre-Lift failure that reached the DLQ.
- Disabled synthetic mode before temporarily enabling `ReadOnlyQaConfirmed` and public read. Production public approval, domain/certificate, email, decisions, and every Lift-write gate remained false.
- Passed the CloudFront smoke and confirmation-gated boundary harness: one-time grant exchange, secure session/CSRF, exactly one order, scoped history, participant identity, feedback acknowledgement, terminal logout, direct API bypass denial, audit coverage, and automatic grant revocation.
- Browser-tested the authenticated deployed UI at `1366×768`, `390×844`, `320×568`, and `844×390`. Desktop used the split queue/viewer, mobile widths used the proof feed, horizontal overflow was zero, the feedback modal fit the compact viewport, and both decision actions remained rendered but disabled.
- Revoked the separate browser grant, restored all dark flags, passed the dark smoke, and purged exactly 13 core records, 22 audit records, and one DLQ message. Core, audit, queue, and DLQ residuals were all zero; temporary access files were deleted.
- Allowed the intentional alarm evaluation windows to expire and verified all nine Proof dev alarms returned to `OK` without manual alarm-state changes.
- Recorded sanitized evidence in `docs/VORNAN_PROOF_CUSTOMER_BOUNDARY_QA_EVIDENCE_2026-07-21.md` and advanced only the deployed lifecycle/boundary readiness booleans.
- Refined the bounded evaluator's next action so the completed deployed boundary now requests separate read-only activation approval instead of another customer-boundary QA approval; public-read and mutation authorization remain hard-coded false.
- Validation passed all workspace checks, all 138 workspace tests, all 39 Proof deployment-safety tests, every production build, the bounded readiness evaluator, and `git diff --check`.

The temporary QA approval was not customer activation approval. The readiness state remains `isolated_read_qa_complete_activation_blocked` with two of three activation-review prerequisites complete. Public read, `ReadOnlyQaConfirmed`, production approval, DNS, email, decisions, and every Lift write remain disabled; no Pathfinder production surface was modified.

## 2026-07-21 - Proof Read-Only Activation Review Packet

Prepared the next Phase 2 review slice without interpreting a general continuation request as customer activation approval.

- Added a deterministic activation-review evaluator layered on the bounded Phase 2 evidence. It requires exact dev/order/time scope, private link handoff, named monitoring and rollback ownership, support response/escalation, grant revocation, dark restoration, and seven immutable safety constraints.
- Added a bounded state artifact with only literal booleans. The current result is `activation_review_packet_incomplete`: scope 2/4, operating controls 2/6, and safety constraints 7/7.
- Hard-coded public-read, grant-creation, deployment, DNS, email, decision, Lift-write, and Phase 3 authorization false in every evaluator result, including a fully completed/approved input.
- Added regression coverage for incomplete scope, pending approval, completed approval, safety violations, Phase 2 regression, truthy strings/missing controls, and hostile identifying extra fields.
- Added the operator packet with exact approval language, immutable exclusions, monitoring/rollback requirements, and explicit clarification that merge approval or a generic “continue” is insufficient.
- Added the checker to the repository validation workflow and documented it in the Phase 0 contract, Phase 2 gate, and read-only QA runbook.
- Validation passed all workspace checks, all 138 workspace tests, all 46 Proof deployment-safety tests, every production build, the bounded activation checker, and `git diff --check`.

No AWS call, deployment, DNS change, grant, email, decision, Lift request/write, or Pathfinder production-surface change was performed. The Proof dev stack remains dark and Phase 3 remains blocked.

The user subsequently approved `A0226753` as the single-order scope. The bounded activation state now records scope 3/4 while leaving the time window and four operating controls false. The supplied Lift application URL was not retained, no Lift read was repeated, and this order approval was not treated as public-read, grant-creation, deployment, or customer-activation approval.

## 2026-07-21 - Proof LTL Demo Read-Only Cohort Controls

Marcus explicitly approved a one-week internal read-only QA window for Lift LTL Demo orders and assigned `mdavies@ltlco.com` as monitoring, rollback, support, and escalation owner.

- Replaced the single-order review scope with the LTL Demo customer `1249` cohort so cancelled or replacement demo orders remain usable without broadening access beyond the sandbox account.
- Added a fail-closed authenticated grant boundary: an empty cohort, missing Lift customer ID, or customer ID outside the configured list is denied before grant creation. The internal customer ID is excluded from the public Proof DTO.
- Added an automatic UTC activation deadline that bounds grant creation, explicit grant expiry, token exchange, and session validity. Grant and session TTLs are capped at the deadline.
- Added CloudFormation and deployment preflight requirements for the cohort and deadline before their respective read-only flags can be enabled.
- Recorded the proposed window through `2026-07-28T21:49:50Z`, while retaining no DNS, email, decision, production-public-read approval, or Lift-write authorization.
- Validation passed all 144 workspace tests, all 48 Proof deployment-safety tests, every workspace typecheck, all production builds, both bounded readiness evaluators, and `git diff --check`.

No stack flag was enabled and no deployment, AWS mutation, Lift request, DNS change, email, decision, or Lift write was performed by this slice. The branch prepares only the server-enforced boundary and a manual activation review.

## 2026-07-21 - Customer Dropbox One-Time Email Verification Foundation

Added the fail-closed work-email possession layer for published Customer Order Dropbox pages.

- Import Methods can require a six-digit one-time verification code in addition to syntax/domain validation. Enabling verification also requires the work-email field.
- Challenges are bound to the current private page key and normalized email, expire after ten minutes, allow at most five failed attempts, and store only keyed hashes plus a masked address.
- Successful confirmation returns a narrow random verification token once. Preview may reuse it, but creating the preview job consumes it with a conditional DynamoDB write so concurrent or later submissions cannot create a second job.
- Request traffic has separate page, email, and IP rate limits. Expired, exhausted, mismatched, and consumed challenges fail without exposing stored secrets.
- The customer page has a compact send-code/confirm-code/verified flow and includes the verification context only in preview and submit requests.
- The operator toggle is disabled with a clear runtime note until both Amazon SES delivery and the explicit `PATHFINDER_PUBLIC_INTAKE_EMAIL_VERIFICATION_ENABLED` server gate are active.
- CloudFormation and the API deployment workflow define that gate with a default of `false`. A local-only debug return-code mode is excluded from Lambda runtime.
- Focused regression coverage proves fail-closed availability, domain rejection, successful verification, preview authorization, single-use consumption, expiry, and attempt exhaustion.
- Full repository validation passed all workspace checks, all 150 tests, every production build, and `git diff --check`. Local browser QA completed the request/confirm/preview flow at desktop and 390px mobile with no horizontal overflow.

Deployment posture remains unchanged: `notify.vornan.co` is verified with successful DKIM and custom MAIL FROM, but the SES account still lacks production access and the deploy workflow defaults to `log` mode. No real email was sent, no deployment occurred, and no Lift or Proof capability changed.

## 2026-07-21 - Wrike Ingestion Contract Foundation

Established the dark, operator-configured source contract for a future Wrike-to-Pathfinder adapter.

- Added Wrike as a scheduled Import Method source with folder/project scope, ordered-status trigger identity, polling or webhook-plus-reconciliation strategy, workbook filename/extension rules, and a bounded reconciliation interval.
- Added a dedicated `@pathfinder/wrike-adapter` package for normalized configuration, contract readiness, newest-workbook selection, and deterministic account/task/attachment/version ingestion identity.
- Fixed the processing destination to an operator-reviewed Pathfinder preview job; Wrike configuration cannot auto-submit to Lift.
- Kept OAuth credentials, refresh tokens, temporary attachment URLs, and workbook content out of the persisted Import Method contract.
- Added a focused strategy and Momentara discovery checklist in `docs/WRIKE_INGESTION_STRATEGY.md`.
- Added regression coverage for secret stripping, required identifiers, version-aware idempotency, fail-closed attachment selection, and Import Method persistence.
- Full repository validation passed every workspace check, all 156 tests, every production build, and `git diff --check`.
- Local browser QA verified the full-width admin contract at desktop and 390px mobile, including readiness-state changes, responsive single-column controls, no horizontal overflow, and no browser errors.

No Wrike connection, token, webhook, polling worker, attachment download, preview creation, Lift submit, deployment, or Proof capability is enabled by this slice.

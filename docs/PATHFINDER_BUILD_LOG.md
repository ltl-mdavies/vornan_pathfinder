# Pathfinder Build Log

This is the living implementation record for Pathfinder. It tracks completed milestones, product decisions, and verification against the master directive in `PATHFINDER_MASTER_SPEC.md`.

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

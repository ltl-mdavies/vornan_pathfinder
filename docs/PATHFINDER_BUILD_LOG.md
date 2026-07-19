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

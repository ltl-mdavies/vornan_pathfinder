# Pathfinder Build Log

This is the living implementation record for Pathfinder. It tracks completed milestones, product decisions, and verification against the master directive in `PATHFINDER_MASTER_SPEC.md`.

## Current Build Snapshot

**Date:** 2026-07-09  
**Phase:** MVP vertical slice  
**Primary focus:** Customer workspace, manual XLSX/grid import, field mapping, Canonical Order preview, Lift payload preview, and local persistence.

## Master Spec Alignment

| Master Spec Area | Current Status | Notes |
| --- | --- | --- |
| Canonical Order model | Implemented for MVP preview | Shared TypeScript package defines order, line, shipping, validation, and processing-state types. |
| Input templates and mapping | Implemented for manual XLSX/grid slice | Source columns can map to canonical fields; mappings can be saved per import method. |
| Lift Standard Graphics adapter | Implemented through preview request | Generates Lift payload and masked submit request; real QA1 submission is intentionally gated. |
| Customer workspace | Implemented for local MVP | Lift customers can be selected; workspace loads persisted import methods, target, and jobs. |
| Target configuration | Implemented for local MVP | QA1/PROD endpoints, company ID, import username, password placeholder, and active environment are editable. |
| Processing jobs | Implemented as persisted preview jobs | Preview jobs include source grid, mappings, canonical validation, Lift validation, payload, and masked request. |
| Product mapping | Deferred / lightweight | Current preview can map `unit_number` directly or reuse SKU; richer SKU-to-unit mapping is next. |
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

## Current Verification

Most recent verification for the persistent workflow slice:

- `npm run check` passed.
- `npm run build` passed.
- API smoke checks passed:
  - customer workspace loads
  - preview job persists as `Ready`
  - target config saves
  - password remains masked in API responses
  - Lift `Ext_ID` header matches body `order.ext_id`
- Visual QA screenshot captured at `/private/tmp/pathfinder-persist-slice-final.png`.

Known non-blocking notes:

- Vite reports a large bundle warning due to the current bundled dependency shape.
- `npm install` reported one high severity audit item; not investigated in this slice.
- Local runtime state is intentionally ignored via `data/*.local.json`.

## Next Recommended Milestones

1. Product mapping table and SKU-to-Unit Number resolution.
2. Stronger validation states and failure recovery workflow.
3. Full import method detail page with source, mapping, canonical, payload, schedule/API sections.
4. QA1 submit endpoint once Lift credentials and header details are confirmed.
5. Replace local JSON store with a production-ready database layer when the workflow stabilizes.

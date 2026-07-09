# Pathfinder Initial Build Plan

**Objective:** Build the first useful vertical slice of Pathfinder: manual order intake from XLSX/grid, field mapping, Canonical Order generation, validation, Lift payload preview, and QA1-ready Lift submission.

---

## 1. Current State

Completed:

- Master engineering specification: `docs/PATHFINDER_MASTER_SPEC.md`
- Lift order JSON sample: `docs/examples/lift-standard-graphics-order.sample.json`
- Lift field/request mapping note: `docs/examples/lift-standard-graphics-field-map.md`
- Lift target configuration sample: `docs/examples/lift-standard-graphics-target-config.sample.json`
- Vornan UI brand brief: `docs/PATHFINDER_UI_BRAND_BRIEF.md`
- Vornan brand assets copied into `assets/brand` and `assets/fonts`

Known Lift constraints:

- Request body must be JSON.
- Header `Ext_ID` must equal body `order.ext_id`.
- Headers include `Content-Type`, `Ext_ID`, `User`, `Password`, and Company header.
- Company value is `91`.
- PROD and QA1 endpoint URLs must be configurable.
- Credentials belong in Lift target admin settings and secret storage, not JSON payloads.

---

## 2. Build Shape

Use a small TypeScript monorepo:

```text
apps/web
apps/api
packages/canonical
packages/templates
packages/lift-adapter
packages/ui
data
assets
```

Recommended stack:

- React + Vite for the web app.
- Node/Express or Fastify for the API.
- TypeScript across app, API, and packages.
- Local JSON or SQLite for the first implementation.
- XLSX parser for spreadsheet import.
- Shared UI tokens from `PATHFINDER_UI_BRAND_BRIEF.md`.

Avoid a production database migration before the first vertical slice is working.

---

## 3. Milestone 1 - Project Scaffold

Deliverables:

- workspace package setup,
- web app shell,
- API app shell,
- shared TypeScript config,
- local dev scripts,
- initial Vornan/Pathfinder theme tokens,
- imported Plus Jakarta Sans fonts,
- Vornan logo assets available to the web app.

Acceptance:

- `npm run dev` starts web and API locally.
- App opens to the Pathfinder shell.
- Shell uses Vornan typography, palette, and logo treatment.

---

## 4. Milestone 2 - Core Contracts

Deliverables:

- Canonical Order TypeScript model.
- Validation message model.
- Processing Job model and states.
- Lift payload model.
- Lift target config model.
- Lift submit request builder.

Acceptance:

- Unit tests or executable checks validate:
  - required canonical fields,
  - required Lift payload fields,
  - `Ext_ID` header equals `order.ext_id`,
  - credentials are excluded from payload/audit output.

---

## 5. Milestone 3 - Manual XLSX Intake

Deliverables:

- upload `.xlsx`,
- parse workbook,
- select worksheet,
- detect or select header row,
- render preview grid,
- create local Processing Job,
- preserve raw upload metadata.

Acceptance:

- User can upload a real workbook and see a grid preview.
- Job state moves to `Received` and `Raw Archived`.

---

## 6. Milestone 4 - Field Mapping Workbench

Deliverables:

- source columns list,
- canonical/Lift field targets,
- required field indicators,
- field mapping save/load,
- Momentara template v1 seed,
- mapping preview.

Acceptance:

- User can map spreadsheet columns to required order and line fields.
- Mapping can be saved as a versioned local template.

---

## 7. Milestone 5 - Canonical Generation And Validation

Deliverables:

- generate Canonical Order from source grid + template,
- validate required fields,
- produce structured validation messages,
- display raw source, Canonical Order, and validation side-by-side.

Acceptance:

- Missing products, quantities, dimensions, shipping data, or `ext_id` produce clear validation messages.
- Valid rows produce a canonical preview.

---

## 8. Milestone 6 - Product Mapping

Deliverables:

- editable product mapping table,
- fields: `customer_sku`, `unit_number`, `product_name`, `description`, active flag,
- mapping resolution during canonical/Lift payload generation.

Acceptance:

- Source SKU resolves into `unit_number` and product display fields.
- Unknown SKU blocks Lift payload generation with a structured failure.

---

## 9. Milestone 7 - Lift Payload Preview

Deliverables:

- generate Lift Standard Graphics payload from Canonical Order,
- show payload JSON,
- show computed headers,
- validate `Ext_ID` header/body equality,
- show dry-run submit result.

Acceptance:

- User can generate the exact Lift-bound body and headers for QA review.
- Credentials are never displayed in generated JSON.

---

## 10. Milestone 8 - Lift Target Admin

Deliverables:

- Lift target settings screen,
- active environment selector,
- QA1/PROD endpoint URL fields,
- company header value,
- import username,
- password secret placeholder,
- `Ext_ID` strategy,
- test connection / dry-run control.

Acceptance:

- User can configure QA1 and PROD.
- Lift adapter reads settings from target configuration rather than hard-coded values.

---

## 11. Milestone 9 - QA1 Submission

Prerequisite:

- Lift integrator confirms mapped JSON body.
- QA1 endpoint path is confirmed.
- Lift import username/password are available.
- Header name for Company is confirmed as `Company` or `Company ID`.

Deliverables:

- submit to QA1,
- capture raw response,
- normalize response into `SUCCESS`, `WARNING`, or `FAILED`,
- persist generated payload and response,
- show audit timeline.

Acceptance:

- A valid test order can be submitted to QA1.
- The user can see what was sent and what Lift returned.

---

## 12. Recommended Immediate Sequence

1. Scaffold the monorepo and app shell.
2. Implement Vornan theme tokens and asset loading.
3. Build Canonical Order and Lift payload packages.
4. Build XLSX upload and grid preview.
5. Build mapping workbench.
6. Build validation and Canonical preview.
7. Build Lift payload preview.
8. Build Lift target admin.
9. Wire QA1 submit when credentials and endpoint confirmation are ready.


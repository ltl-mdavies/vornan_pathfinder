# Wrike Multi-Source Workbook and Shipping Plan

## Purpose

Pathfinder must treat an Import Method as an operator-configured translation contract, not as a pile of workbook-specific conditionals. A Wrike order can combine:

- task-level custom fields;
- one or more workbook attachments;
- multiple workbook sheets;
- more than one product section within a sheet;
- print and hardware products with different headers;
- a later shipping workbook from a separate task.

Each source is qualified independently, mapped into canonical Pathfinder fields, then routed through one reviewed output contract. No source value is coupled to a Lift field behind the UI.

## Decisions

1. **Workbook behavior is saved with the Import Method.** Sheet roles, section boundaries, quantity rules, field mappings, and product resolution are visible and editable.
2. **Every product-bearing sheet is eligible.** A quantity-bearing row on any sheet configured as `order_lines` becomes an order-line candidate.
3. **A sheet can contain multiple sections.** Each section has its own header row/span, line type, quantity column, missing-quantity behavior, field mapping, and product resolution.
4. **Print and hardware do not share an implicit product key.** Product resolution is scoped to a stable sheet-and-section identity so equivalent column names cannot collide accidentally.
5. **Missing quantity is explicit.** A section can retain populated no-quantity rows as reference data or block preview until the row is corrected. Hardware sections default to the safer blocking behavior when detected below another header.
6. **Hardware dimensions are not invented.** Hardware products still require a mapped product identifier and positive quantity, but canonical dimension validation does not require width/height when the line is explicitly typed as hardware.
7. **Shipping is a separate Wrike intake.** A shipping workbook never creates or modifies order lines through the order-workbook parser.
8. **Shipping remains inactive until Lift transport is confirmed.** Configuration and evidence capture can be implemented safely, but no Lift attachment call may be guessed.
9. **External repositories are not ingested by this work.** SharePoint, Dropbox, and other linked repositories remain locators only unless a later source contract is approved.
10. **Proof work remains independently gated.** This plan does not enable customer Proof decisions, Lift Proof writes, revised-art upload, or the dark Proof asset boundary.

## Import Method workbook model

```text
Import Method
└── Workbook Structure
    ├── Sheet: Order Form
    │   ├── Role: Order lines
    │   ├── Section: Printed products
    │   │   ├── Header row/span
    │   │   ├── Quantity column
    │   │   ├── Canonical field mappings
    │   │   └── Product resolution
    │   └── Section: Hardware
    │       ├── Independent header and quantity rule
    │       ├── Independent canonical field mappings
    │       └── Independent product resolution
    ├── Sheet: additional product tab
    │   └── Zero or more quantity-bearing order lines
    ├── Sheet: reference/catalog
    │   └── Never creates order lines
    └── Sheet: shipping attachment
        └── Routed only to the separate shipping intake
```

### Stable identities

- Sheet identity is the exact workbook sheet name within the saved template.
- Section identity is a bounded stable ID saved with the Import Method.
- Row provenance retains sheet, section, source row number, and line type.
- Product mappings are keyed by output route, section scope, and customer product key.
- Re-detection produces a reviewable schema change rather than silently replacing saved structure.

### Sheet roles

| Role | Order-line behavior | Intended use |
|---|---|---|
| `order_lines` | Parse configured sections and include valid quantity rows | Print, hardware, and future product tabs |
| `reference_catalog` | Retain metadata only; never submit | Catalog/reference tabs |
| `shipping_attachment` | Exclude from order parsing | Future separate shipping intake |
| `ignore` | Exclude completely | Notes, helper, or obsolete tabs |

### Section controls

Every order section exposes:

- operator label;
- line type: print, hardware, or custom;
- header row and one-/two-row header span;
- detected header signature;
- quantity column;
- missing-quantity behavior: reference or block;
- detected order/reference/incomplete counts;
- scoped canonical field mapping;
- scoped product resolution.

Automatic detection is a starting proposal. Saved settings are authoritative.

## Shipping intake boundary

Shipping arrives later than order creation from the `Shipping Information` task in the same Wrike campaign. Momentara will use a consistent workbook even for a single destination and will move the task to a dedicated readiness status.

The future configuration is a separate nested contract:

```text
shipping_intake
  enabled: false
  task match: exact Shipping Information template/type
  trigger status: configured exact Wrike custom-status ID
  accepted extensions: xlsx/xls
  attachment selection: exact current attachment/version
  destination: unresolved Lift order-document attachment
  retention: separately approved
```

Required behavior:

1. qualify the campaign and exact Shipping Information task;
2. capture immutable attachment evidence using account/task/attachment/version identity;
3. bind the shipping evidence to an existing Pathfinder/Lift order;
4. keep the workbook opaque—do not parse or log destination cells;
5. wait for an authoritative Lift document-attachment endpoint and response contract;
6. reserve intent and audit before a future upload;
7. never retry an uncertain write blindly;
8. reconcile against authoritative Lift state.

The supplied Lift API reference does not currently establish the required order-document attachment endpoint. That is an external blocker to transport, not to the default-disabled configuration/evidence foundation.

## Coordinated delivery plan

### P0 — reliable multi-sheet order intake

- Persist sheet roles and section configurations.
- Detect multiple headers in one sheet and product-bearing rows across sheets.
- Surface incomplete populated rows instead of silently dropping them.
- Scope field and product mappings by stable section identity.
- Carry line type into canonical validation; do not require print dimensions for hardware.
- Validate with sanitized equivalents of the supplied multi-sheet/hardware workbooks.
- Keep Wrike discovery, evidence download, preview creation, and Lift submit under existing gates and review.

### P1 — discover campaigns and prepare shipping intake

- Reconcile discovery across GPA Campaigns using the exact Placard Order task contract, exact status ID, and Print Vendor value.
- Add default-inactive Shipping Information task/status configuration.
- Capture immutable shipping workbook evidence without parsing its contents.
- Bind evidence to the Pathfinder order and expose an operator review state.
- Add reconciliation, telemetry, and duplicate/version handling.
- Do not add Lift attachment transport until its contract is confirmed.

### P2 — durable multi-input orchestration and write-back design

- Represent task fields, workbook sections, attachments, tags, and later sources as independently configured input bindings.
- Map all inputs into versioned canonical order fields.
- Resolve one output template and one reviewed `create_order` message where Lift import mappings support it.
- Design one-to-many order/status-link write-back for Wrike only after Momentara confirms the desired task/comment/status behavior.
- Keep Slack notification and Wrike write-back as separate destinations with their own idempotency and authorization.

### Parallel Proof track

The Proof operator action runtime, dark private asset foundation, and Proof decision integrity work remain separate. The next safe local-only Proof slice is upload/finalization metadata and lifecycle state for Proof-owned revised-art assets. It must add no route, signer, resolver, object write, deployment, DNS alias, or Lift call. Live Proof action testing still requires exact bounded QA approval.

## Validation standard

Every implementation checkpoint must include:

- parser fixtures for same-sheet repeated/different headers;
- multiple product sheets, including empty tabs;
- hardware with and without quantity;
- reference/catalog and shipping-role exclusion;
- scoped field/product mapping collision tests;
- legacy single-sheet compatibility;
- Import Method persistence and schema-history tests;
- canonical hardware validation;
- Admin rendering and responsive checks using existing components/styles;
- full workspace checks, tests, builds, browser regressions, deployment-safety tests, package validation, and diff/sensitive-data hygiene.

## Deferred questions

- Exact Wrike Shipping Information task/custom-item-type and readiness status IDs.
- Shipping attachment filename/extension constraints beyond XLSX/XLS.
- Lift order-document attachment endpoint, authentication, request body, maximum size, response schema, idempotency, and authoritative read-after-write check.
- Shipping source-evidence retention and legal-hold needs.
- Momentara’s desired one-to-many status URL/write-back behavior.
- Whether future output templates accept the canonical artwork-folder URL during `create_order`, eliminating the current post-create update.

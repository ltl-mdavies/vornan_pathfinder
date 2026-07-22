# Pathfinder Thread Handoff - 2026-07-18

This document is the working handoff for continuing Pathfinder development in a fresh Codex thread. It summarizes the current repo state, major milestones, live infrastructure, useful docs, and the next slices of work.

## One-Minute Context

Pathfinder is a Vornan-branded order translation and routing platform. The current MVP takes customer order input, especially Momentara XLSX workbooks, maps it into a Canonical Order, resolves products against a route-specific output product map, generates Lift Standard Graphics payloads, and prepares or gates Lift submit. It now also has a public order status surface at `status.vornan.co`, backed by Lift order/proof/package lookup integrations and tokenized status request flows.

The platform is no longer just a local prototype. The admin web app, API, and public status app have AWS production hosting paths, Firebase Google Auth, DynamoDB persistence, Secrets Manager support, SES transactional email planning, and GitHub Actions deployment workflows.

Latest demo-readiness update:

- Ready and Submit Failed jobs expose their primary Lift submit action directly in Job Detail. The diagnostics Actions menu is viewport-scrollable and no longer clipped by its panel.
- Import Methods resolves the displayed Output Route name from the current route record, so route renames are reflected without rewriting the Import Method.
- Lift submit now fails closed when `order.order_title` is missing, including for older persisted previews. Existing legacy Import Methods must enable Order Name Resolution and regenerate a preview before submit.
- Authenticated API calls use a current Firebase ID token and retry one 401 after a forced refresh. An unrecoverable session visibly returns the operator to Google sign-in with a session-expired explanation.
- Lift submit runtime switches are deployment-managed CloudFormation parameters. Production uses external submit enabled plus live transport for certified `Sandbox · LTL Demo` profiles while `PATHFINDER_ALLOW_LIVE_CUSTOMER_SUBMIT` remains false.
- These server switches are intentionally not editable from Target setup. Operator-controlled Target, route, credentials, product map, certification, submit-profile, and explicit PROD sandbox confirmation gates still apply before any external POST.

## Repo And Git

- Local repo: `/Users/marcusdavies/Projects/ltl-workspace/pathfinder`
- Main branch: `main`
- Remote repo: `ltl-mdavies/vornan_pathfinder`
- Current feature commit: `64d48ec Add unique order IDs and truthful loading`
- Branch state after the production deployment: `main`, synchronized with `origin/main` before this deployment-record follow-up.
- Commit `64d48ec` is deployed to the admin app, public status app, and API; real Lift submission remains disabled.
- The full API stack deployment provisioned the globally reserved Pathfinder Order Number table and injected its Lambda environment variable.

Recent committed base history:

```text
04ae9e9 Add bulk product mapping confirmation
6a62fa4 Add import method schema history
7b2865f Add import method persistence tests
d45f2d1 Add per-sheet header overrides
e5dbbb5 Add multi-row header schema refresh
a6bceb5 Harden import methods and persist source schemas
aaac73c Add route strategy remap assistance
932d6eb Add multi-order status and row-level product mapping
a2f0bf0 Add Pathfinder thread handoff
914622a Add global status access domain allowlist
5f4b3b9 Add customer status access policy controls
adef691 Add public status access policy
589855b Polish public order status page
8ac91ac Add transactional email health panel
4628f5e Add status email diagnostics
12e5d77 Polish public order status view
ed77125 Polish status email and internal lookup
96ba7f8 Polish order status lookup surfaces
d3cbd65 Add SES status link email foundation
9410f2f Document GitHub deploy role policies
b27991b Add secure public status request flow
```

Current completed slice:

- Persists per-Import Method Order Name Resolution configuration.
- Resolves customer-provided, composite, or provided-with-composite-fallback values into `order.order_title`.
- Preserves legacy saved methods behind a disabled pass-through gate until an operator opts in.
- Shows the source mapping, canonical destination, Lift JSON destination, component values, and live deterministic result.
- Places Order Name Resolution before Field Mapping and presents the Import Method setup as a five-step workflow.
- Applies the same resolver to API preview jobs and retains the result in persisted job snapshots.
- Adds validation for required components, configured length, deterministic retries, duplicate names, persistence isolation, and legacy behavior.
- No production deployment or real Lift submit behavior is part of this slice.

Latest deployed slice:

- Reserves one globally unique Pathfinder Order Number through a dedicated DynamoDB table and conditional write.
- Makes the Pathfinder Order Number the recommended Lift `Ext_ID` source for new Import Methods while preserving existing saved strategies.
- Persists and surfaces the number with each preview job; retries reuse the same number.
- Keeps customer order, PO, and contract identifiers as source references and optional readable order-name components.
- Moves the more complex readable-name composition controls into an optional Advanced section.
- Requires a CloudFormation stack update before API code deployment because `PATHFINDER_ORDER_IDS_TABLE` is a new runtime dependency.
- Does not enable live Lift transport or automatically resubmit.
- Validation passed: `npm run check`, 21 tests via `npm test`, `npm run build`, desktop/mobile browser review, and a local preview proving the same reserved number reaches both Lift `Ext_ID` locations.
- The same deployed feature commit also splits the admin production bundle below Vite's warning threshold and replaces seeded-data hydration flashes with skeleton, empty, and retryable error states.
- New bundle result: the former 542.87 kB main chunk is now a 323.98 kB lazy workspace chunk; all JavaScript chunks are below 500 kB.
- A 1.5-second delayed local API test confirmed that no customer, Import Method, job, route, or sample workbook values appear before current data is ready.
- Production workflows `29698121590` (API), `29698120929` (admin), and `29698123724` (status) completed successfully on 2026-07-19.
- Stack `vornan-pathfinder-api-prod` is `UPDATE_COMPLETE`; `Pathfinder-OrderIds-prod` is active, encrypted, on-demand, and PITR-enabled.
- Live admin, status, and API health endpoints returned HTTP 200 after CloudFront invalidation and Lambda publication.

Recommended opening move in the next thread:

```bash
git status --short
git log --oneline -5
```

If continuing implementation work, create a focused branch only if the workflow calls for a PR. Recent work has also been committed directly to `main` when the user explicitly asked to push/deploy quickly.

## Tech Stack

- Monorepo managed with npm workspaces.
- Admin app: React + Vite + TypeScript in `apps/web`.
- Public status app: React + Vite + TypeScript in `apps/status`.
- API: Express + TypeScript in `apps/api`, with Lambda handler support.
- Shared packages:
  - `packages/canonical`
  - `packages/templates`
  - `packages/lift-adapter`
  - `packages/customer-directory`
  - `packages/ui`
- Persistence:
  - Local dev store: JSON-backed storage in `data/pathfinder-store.local.json` (ignored).
  - Production store: DynamoDB via `PATHFINDER_STORAGE_DRIVER=dynamodb`.
- Secrets:
  - Local dev placeholders are masked in API responses.
  - Production uses AWS Secrets Manager for sensitive values where configured.
- Auth:
  - Firebase Google Auth for the admin app.
  - Allowed admin domains: `ltlco.com`, `vornan.co`.
  - Public status page uses token/request gating rather than normal admin auth.
- Hosting and AWS:
  - S3 + CloudFront for admin and status SPAs.
  - API Gateway + Lambda for API.
  - DynamoDB for durable data.
  - SES for transactional email.
  - ACM certificates in `us-east-1`.
  - DNS currently managed in Cloudflare for `vornan.co`.

## Major Product Milestones Completed

### Foundation

- Created the Pathfinder app shell with Vornan brand direction.
- Added the Vornan wordmark and approved monochrome Pathfinder Zinnia lockup.
- Added Pathfinder app icons for mobile and macOS style surfaces.
- Built the main sidebar, customer context navigation, customer overview, targets, jobs, audit, settings, and dashboard areas.

### Customer Workspace

- Imported Lift customers from Lift CSV/JSON-style endpoints.
- Added customer workspace pages:
  - Overview
  - Import Methods
  - Output Product Map
  - Manual Import
  - Jobs
  - Settings
- Added customer enrichment from Lift customer status data, with credit-related details intentionally minimized/hidden unless needed.
- Added persisted customer workspace settings.

### Manual Import And Preview

- Added Manual XLSX import workflow.
- Added multi-tab workbook handling.
- Classified source rows into order rows and reference/catalog candidates.
- Added source sheet, row number, parsed rows, validation, canonical order preview, Lift payload preview, and submit request preview.
- Added preview job persistence and customer/global job lists.

### Product Resolution

- Added route-aware product resolution.
- Added resolver strategies:
  - Derived key
  - Composite key
  - Direct route product identifier
- Added resolution mode:
  - Look up key in output product map
  - Send generated identifier directly, where intentionally configured
- Added route-level product mapping strategy:
  - `unit_number`
  - `product_id`
- Added Output Product Map for customer/route-specific product crosswalks.
- Added ability to front-load/preload product mappings.
- Added Lift product catalog integration:
  - Basic-auth call using selected Lift environment credentials.
  - Product cache.
  - API filter support.
  - Client-side fuzzy search after result fetch.
  - Pinned catalog presets per customer/route.
  - Product details view.
- Known UX concern: product mapping flow still needs a clearer row-level "Map Product" interaction and a side-by-side mapping pattern.

### Targets And Output Architecture

- Refactored Targets into:
  - Overview
  - Environments
  - Output Templates
  - Output Routes
  - Value Rules
  - Test & Health
- Seeded:
  - `Lift ERP`
  - QA1 and PROD environments
  - `Lift Standard Graphics Order`
  - `Larger Than Life - Lift / 91 - Standard Graphics`
  - dummy ecommerce-style target for visual structure
- Added route-level fields for Lift lookup/proof/package endpoints.
- Added sandbox submit profile:
  - LTL Demo customer
  - Lift customer ID `1249`
- Added value normalization rules for route-specific controlled values, such as shipping method.
- Added route diagnostics and target health/status surfaces.

### Canonical Registry

- Added a canonical field registry surface in Settings.
- Added additional canonical fields for:
  - Contacts
  - Customer CRM ID
  - Order due date
  - Order attachment
  - Shipping account billing zip/country
  - Line product ID
- Added field metadata, aliases, status, rules, and template usage references.
- Future work: production-grade schema management with stable field IDs, aliases, rename migration behavior, and stronger downstream mapping safety.

### Lift Submit Readiness

- Built Lift submit preflight/certification surfaces.
- Added submit gates:
  - Environment selection and PROD sandbox confirmation.
  - Credentials present.
  - Sandbox customer profile.
  - Product map complete.
  - Ext_ID header/body equality.
  - Value rules clear.
  - Transport enabled and live mode.
  - Certification state clear.
- Real Lift submit remains intentionally guarded. Only enable live submit when ready.

### Public Status And Customer Visibility

- Built public status app at `status.vornan.co`.
- Added status request flow:
  - Customer enters order number and email.
  - System issues tokenized status link.
  - Email can be logged or sent through SES depending on env.
- Added internal/admin lookup mode concept for logged-in users to look up any order.
- Added customer-specific access policy controls.
- Added global status access domain allowlist.
- Added Lift rollup design using:
  - AS360 Orders API
  - AS360 Proof Report API
  - PackageDetails API
- Important: never expose negotiated shipping rate from PackageDetails.

### Production Hosting

- Added AWS hosting docs and CloudFormation/SAM-style infrastructure files.
- Added GitHub Actions workflows:
  - `.github/workflows/deploy-admin-web.yml`
  - `.github/workflows/deploy-status-web.yml`
  - `.github/workflows/deploy-api.yml`
- Added GitHub OIDC deploy role and policy documentation/helpers.
- Deployed admin web and confirmed Firebase Google login works for `ltlco.com`.
- Fixed production API Firebase project ID/token validation issue.
- Switched persistence toward DynamoDB for production.
- DNS records for `pathfinder.vornan.co`, `api.pathfinder.vornan.co`, and `status.vornan.co` were added in Cloudflare. API CNAME was updated to the newer API Gateway target during the latest hosting work.

## Live URLs

- Admin app: `https://pathfinder.vornan.co`
- API: `https://api.pathfinder.vornan.co`
- Public status app: `https://status.vornan.co`

If any live app behavior looks stale, check:

- CloudFront invalidation status.
- GitHub Actions latest deployment run.
- Cloudflare DNS record values and proxy status.
- Browser cache.

## AWS And DNS Notes

Known AWS account from deploy role work: `744016783602`

Primary region: `us-east-1`

Expected production resources include:

- S3 buckets:
  - `vornan-pathfinder`
  - `vornan-pathfinder-status`
  - `vornan-pathfinder-artifacts`
- API Lambda and API Gateway for `api.pathfinder.vornan.co`.
- DynamoDB table(s) for Pathfinder storage.
- SES identity/configuration for `notify.vornan.co` or equivalent transactional email sender.
- ACM certificates in `us-east-1`.
- CloudFront distributions for admin and status apps.

DNS is managed in Cloudflare, not GoDaddy. Keep existing website and email records intact.

Operational DNS reminder:

- AWS certificate validation CNAMEs should be DNS-only.
- AWS CloudFront/API Gateway CNAMEs should usually be DNS-only unless the AWS endpoint supports the desired proxy mode cleanly.
- Do not duplicate SPF records. Merge required SPF mechanisms into the existing TXT SPF record when needed.
- DMARC can point to `dmarc@vornan.co`; the user created this Google group.
- Support replies should route to `support@vornan.co`; the user created this Google group.

## Important Environment Variables

### Admin/API Auth

```text
PATHFINDER_REQUIRE_AUTH=true
FIREBASE_PROJECT_ID=<firebase-project-id>
PATHFINDER_ALLOWED_EMAIL_DOMAINS=ltlco.com,vornan.co
```

### Storage

```text
PATHFINDER_STORAGE_DRIVER=dynamodb
PATHFINDER_DYNAMODB_TABLE=<table-name>
```

### Lift Submit Gate

Only use these when intentionally testing real Lift submit:

```text
PATHFINDER_ENABLE_LIFT_SUBMIT=true
PATHFINDER_LIFT_TRANSPORT_MODE=live
```

For local preview-only behavior, keep submit disabled/gated.

### Public Status

```text
PATHFINDER_PUBLIC_STATUS_BASE_URL=https://status.vornan.co
PATHFINDER_PUBLIC_STATUS_TOKEN_DAYS=30
PATHFINDER_PUBLIC_STATUS_RATE_LIMIT_PEPPER=<secret>
PATHFINDER_PUBLIC_STATUS_EMAIL_MATCH_REQUIRED=true
PATHFINDER_PUBLIC_STATUS_GLOBAL_ALLOWED_DOMAINS=ltlco.com,vornan.co
PATHFINDER_PUBLIC_STATUS_RETURN_LINK=false
```

### Transactional Email

```text
PATHFINDER_STATUS_EMAIL_MODE=log|ses
PATHFINDER_EMAIL_FROM=Vornan Updates <notifications@notify.vornan.co>
PATHFINDER_STATUS_REPLY_TO=support@vornan.co
PATHFINDER_ORDERS_REPLY_TO=orders@vornan.co
PATHFINDER_SYSTEM_REPLY_TO=ops@vornan.co
PATHFINDER_SES_REGION=us-east-1
PATHFINDER_SES_CONFIGURATION_SET=pathfinder-transactional
```

## Key Files And Directories

### Apps

- Admin web app: `apps/web`
- Public status app: `apps/status`
- API server/Lambda: `apps/api`

### Shared Packages

- Canonical model: `packages/canonical`
- Template handling: `packages/templates`
- Lift adapter: `packages/lift-adapter`
- Customer directory: `packages/customer-directory`
- Shared UI primitives: `packages/ui`

### Infrastructure

- API CloudFormation: `infra/aws/api-cloudformation.yaml`
- Web CloudFormation: `infra/aws/web-cloudformation.yaml`
- Production hosting inventory: `infra/aws/production-hosting.json`
- GitHub OIDC/deploy role docs and policies: `infra/aws/github-deploy-role-*`

### Brand Assets

- Source-faithful assets: `logo/source-faithful`
- Admin public brand assets: `apps/web/public/brand`
- Status public brand assets: `apps/status/public/brand`
- Current sidebar Pathfinder lockup: `apps/web/public/brand/pathfinder-lockup-zinnia.svg`
- App icon source set: `logo/source-faithful/app-icons/stone-forest`

Do not overwrite source logo masters unless explicitly asked.

## Most Useful Docs

Start with these:

- `README.md`
- `docs/PATHFINDER_BUILD_LOG.md`
- `docs/PATHFINDER_MASTER_SPEC.md`
- `docs/AWS_PRODUCTION_HOSTING_AND_STATUS_PLAN.md`
- `docs/AWS_GODADDY_DNS_RUNBOOK.md`
- `docs/AWS_STORAGE_AND_SECRETS_RUNBOOK.md`
- `docs/TRANSACTIONAL_EMAIL_SES_HANDOFF.md`
- `docs/LIFT_ORDER_LOOKUP_ENDPOINTS.md`
- `docs/FIRST_LIFT_SANDBOX_SUBMIT_READINESS.md`
- `docs/TARGET_OUTPUT_ARCHITECTURE.md`
- `docs/CANONICAL_ORDER_FIELD_DICTIONARY.md`

Useful examples:

- `docs/examples/lift-standard-graphics-order.body-template.json`
- `docs/examples/lift-standard-graphics-order.sample.json`

The many `PATHFINDER_SUPERDOC_*` files are the larger master-spec volumes. They are useful for strategic alignment but can be too broad for day-to-day implementation.

## Common Commands

Install:

```bash
npm install
```

Local dev:

```bash
npm run dev
npm run dev:api
```

Validation:

```bash
npm run check
npm run build
```

API Lambda:

```bash
npm run build:api-lambda
npm run package:api-lambda
npm run deploy:api-lambda
```

GitHub Actions deploys:

- Deploy Pathfinder Admin Web
- Deploy Pathfinder Status Web
- Deploy Pathfinder API

## Current Known Good State

- Admin app is deployed and Google Auth works for at least an `ltlco.com` account.
- API production console errors from missing Firebase project ID were resolved.
- Customer environment selection persisted after the DynamoDB switch in the live app.
- Public status app exists and has an email/token request foundation.
- Global public status domain allowlist was committed before the continuation work.
- Public status requests now accept up to 10 order numbers and issue one tokenized link with an order summary and individual details.
- Output Product Map rows now open a scoped Lift catalog workflow and save the selected route identifier back to the exact row.
- Output Route strategy changes now summarize identifier readiness and can open a focused remap queue without rewriting previously stored identifiers.
- Import Methods now uses a list-first detail workflow with one explicit save, local-only new/duplicate drafts, and guarded discard/navigation behavior.
- Import Methods can now detect and persist workbook schema metadata while keeping workbook rows and cell values session-only.
- Workbook parsing can now auto-detect headers below title rows, handle two-row grouped headers, and audit ignored repeated header rows.
- Import Methods block save when parser settings no longer match the detected schema and guide the operator through re-detection.
- Import Methods can override the header row and one/two-row span for an exact workbook sheet while preserving global quantity, repeated-header, and reference-row rules.
- The templates workspace now has durable parser regressions exposed through the root `npm test` command.
- Import Method persistence now strips raw workbook rows/cell values at the store boundary and has regression coverage for schema reloads, mapping-template synchronization, method isolation, and legacy parser settings.
- Import Methods retain up to five structurally distinct previous detected schemas and expose a read-only current-versus-previous comparison in Source Setup.
- Bulk Output Product Map assignments now require exact-row review and confirmation before one route identifier is written to several mappings.

## Current Known Friction Or Risks

- Google login may show Cross-Origin-Opener-Policy console warnings from Firebase popup behavior even when auth succeeds.
- The Lift Product Catalog panel has been iterated several times and may still need simplification around pinned catalogs, refresh behavior, and product details hierarchy.
- Automatic header detection is heuristic; live customer templates with unusually sparse or decorative headers should be checked before relying on the detected row.
- Per-sheet header overrides intentionally cover only header row/span; quantity, repeated-header, and reference-row rules remain global until live templates demonstrate a need for finer control.
- Targets should eventually get the same single-save/unsaved-change treatment as Import Methods.
- Public status gating must balance security with customer ease. Email-domain-based access has momentum, plus global allowed domains.
- Mobile support is not required for the full admin app, but login, dashboard, overview, and public status should behave well on mobile.
- Real Lift submit has not yet been attempted because Lift product mappings were not ready.

## Real Lift Submit Checklist

Before a real submit test:

1. Confirm Lift integrator has mapped the Lift Standard Graphics body/header fields.
2. Confirm route product mapping strategy:
   - `unit_number`, or
   - `product_id`
3. Confirm Momentara product keys are mapped in Output Product Map.
4. Confirm route is set to the intended environment, likely PROD for the sandbox lane.
5. Confirm sandbox profile shows LTL Demo / `1249`.
6. Confirm PROD sandbox lane checkbox is explicitly confirmed in Manual Import preflight.
7. Confirm environment credentials are present.
8. Confirm `Ext_ID` header equals `order.ext_id` in the body.
9. Confirm value rules pass.
10. Confirm API env has:

```text
PATHFINDER_ENABLE_LIFT_SUBMIT=true
PATHFINDER_LIFT_TRANSPORT_MODE=live
```

11. Generate a fresh preview after any environment/route/product mapping changes.
12. Download the submit packet before the first actual submit.

## Public Status Roadmap

Current direction:

- Public status page should feel premium and simple, not like an admin tool.
- Customers may need to request status for multiple orders at once.
- Internal logged-in users should be able to look up any order number.
- Public users should not be able to trivially enumerate order numbers.

Completed in the continuation slice:

- Multi-order requests accept up to 10 unique order numbers.
- One backward-compatible token can reference several public snapshots.
- One email opens a clean order summary and individual order details.

Recommended next slices:

1. Continue hardening the email-domain gate:
   - Check request email domain against customer-derived or configured allowed domains.
   - Global allowlist domains can request across customers.
   - Return neutral messaging even when denied.
2. Continue customer settings for approved status domains:
   - Auto-suggest from known customer/contact emails.
   - Allow manual add/remove.
   - Keep defaults conservative.
3. Expand internal status lookup:
   - Admin-authenticated users can search by order number without email token.
4. Improve status page polish:
   - Premium minimal layout.
   - Less explanatory copy.
   - Stronger mobile behavior.

## Product Mapping Roadmap

Completed in the continuation slice:

- Added and validated a direct `Map Product` action on each Pathfinder mapping row.
- The catalog drawer shows the active Pathfinder key, active Lift catalog scope, and route identifier strategy.
- Lift product selection saves through the exact-row endpoint and records the available product ID/unit number metadata.
- Route identifier resolution is strict: `unit_number` and `product_id` do not silently substitute for one another.
- Existing bulk controls, catalog presets, advanced filters, refresh, and product details remain available.
- Output Route cards summarize how many active mappings already contain the selected route identifier and how many need remapping.
- Unsaved strategy changes explicitly show the old and new identifier types and state that existing identifiers remain stored.
- A save-and-review action opens a focused Output Product Map queue containing only active rows missing the newly selected identifier.
- The queue updates as exact rows are remapped and shows a clear completion state when no gaps remain.
- Bulk product assignment is visually separated from row-level mapping and requires at least two selected rows.
- Both manual and catalog-based bulk assignments show an exact-row, route-aware confirmation before saving.
- Selected-row chips make the active bulk scope removable and visible before confirmation.

Recommended next slices:

1. Refine the existing bulk map flow only when needed:
   - Validate the new confirmation flow with live operator feedback.
   - Keep automatic/rule-based bulk mapping out of scope until a real need appears.
2. Clean details panel:
   - Show only real payload field names and values.
   - Avoid duplicate `unit_number` / `unit_numbers` display unless both are truly present in the payload and meaningful.
3. Continue Product ID strategy language cleanup:
   - If route strategy is `product_id`, Product Resolution should talk about "route product identifier", not unit number.
4. Revisit catalog scope only where live operator feedback still shows friction:
   - Preserve the current active-scope treatment, catalog-name import, and preset deduplication behavior.

## Lift Order Naming Roadmap

The requested Lift order-name setup is documented in `docs/LIFT_ORDER_NAME_STRATEGY.md`.

Implemented in the current working tree:

- Use the existing canonical `order.order_title`; the Lift adapter and seeded output template already emit it to `order.order_title` in the JSON.
- Add canonical `order.order_name` only if the verified Lift contract proves the unique name is a separate payload field.
- Added an Import Method Order Name Resolution setup with customer-provided, composite, and provided-with-composite-fallback strategies.
- Build composites from canonical paths, not raw workbook columns, with optional prefix/suffix, separator, casing, and date formatting.
- Prefer a stable customer-provided name, otherwise default to customer/destination code plus external order ID and an optional stable business date.
- Do not use the current timestamp or a random value by default; retries must resolve to the same name.
- Added current-batch duplicate detection and retained the resolved value in preview snapshots.
- Existing methods remain disabled legacy pass-through until explicitly enabled, avoiding a new blocking requirement on historical configurations.
- Add an atomic cross-job reservation only after Lift's uniqueness scope and lookup behavior are confirmed.
- Validate the complete flow in sandbox before enabling any real Lift submission.

Remaining sequence:

1. Confirm Lift uniqueness scope, length/character constraints, and lookup behavior.
2. Add cross-job reservations and deterministic collision handling only if the confirmed contract requires them.
3. Validate in a sandbox route before enabling any real Lift submission.

Browser follow-up completed on 2026-07-19:

- Confirmed the Import Method detail view places Order Name Resolution before Field Mapping without horizontal overflow.
- Hardened the login root and auth-stage sizing against the narrow left-column render shown in Chrome.
- Evenly distributed the dark-panel access chips on desktop, centered their mobile wrap, and hid the redundant `Vornan Pathfinder` eyebrow at the mobile breakpoint.
- Restored a viewport-height desktop app shell with independent sidebar and workspace overflow; max-content workspace rows prevent tall Import Method panels from shrinking or clipping.
- Aligned the composite canonical-field selector with the shared labeled setup-control styling used by Resolution Strategy, including its responsive stacked layout.
- Confirmed a centered 1160px two-column login at 1904x1009 and an edge-to-edge single-column login at 390x844 with no horizontal overflow.

## Import Methods Roadmap

Completed in the latest continuation slice:

- The main page is a method list; setup panels appear only after edit/new/duplicate opens a detail workspace.
- Source setup, product resolution, and field mappings persist through one `Save Method` action.
- New and duplicated methods remain local drafts until that save succeeds.
- Dirty navigation offers save, discard, or keep-editing choices, and browser refresh/close receives the standard unsaved-work warning.
- Saving validates the method name and output route; discarding reloads the persisted workspace.
- Empty mapping sets remain empty when switching methods instead of inheriting stale mappings.
- Source templates can be detected from XLSX, XLS, or CSV directly inside the method workspace.
- Detected file name, sheet structure, columns, row counts, and detection time persist with the method; raw rows and cell values do not.
- Matching mappings are preserved, recognized new columns are auto-mapped, and Manual Import reuses the active method's matching mappings.
- Operators can return to clearly labeled sample columns as a guarded draft change.
- Automatic detection can skip title/instruction rows, while two-row mode combines grouped header labels without collapsing duplicate child names.
- Detected schemas record the actual header row/span and any ignored repeated-header row numbers for each sheet.
- Saved parser settings are compared with the schema's parser snapshot; stale schemas must be re-detected or removed before save.

Recommended next slices:

1. Validate the header heuristics, override controls, and history comparison against the next real customer workbook.
2. Add endpoint-level request validation if live integrations begin sending malformed Import Method payloads.
3. Consider explicit restore-from-history only if operators need recovery, not just comparison.

## Destructive Action Confirmations

Implemented in the current working tree:

- Import Methods require explicit confirmation before an unsaved draft is discarded or a saved method is archived.
- The confirmation is available from both the method list and method detail header and names the exact method affected.
- Targets now have delete/discard actions in both the overview and detail header with an exact-item confirmation.
- Target environments require confirmation before draft removal.
- Saved Target deletion is rejected server-side while any customer workspace, output route, or Import Method references the Target.
- Target dependency conflicts surface as readable operator guidance.

Validation completed:

- `npm run check`
- `npm test --workspace @pathfinder/api` (12 tests passed)
- `npm run build` with no chunk-size advisory
- Browser verification covered Import Method confirm/cancel/local-draft removal and saved Target confirm/cancel without deleting persisted data.

No production deployment or real Lift submission is part of this uncommitted slice.

## Production Authentication Hotfix

- Production Google sign-in was restored to Firebase `signInWithPopup`; the failing production-only redirect branch and redirect-result handler were removed.
- Hotfix commit `eaf12af Restore popup authentication for Pathfinder` is pushed to `main`.
- Admin deployment workflow `29699177429` completed successfully with CloudFront invalidation.
- Live bundle `/assets/index-I64bNW4C.js` calls `signInWithPopup` and no longer includes the redirect-result flow.
- Live browser verification confirmed the parent Pathfinder URL stays in place when the Google sign-in surface opens.
- The Google console self-XSS warning is standard Google safety messaging and is not emitted by Pathfinder.

## Canonical Registry Roadmap

The user wants production-grade canonical schema management so non-developers can evolve canonical fields without code edits.

Recommended design:

- Stable field IDs are the source of truth.
- Display paths can change.
- Aliases preserve old mappings.
- Renames should migrate or preserve references instead of breaking templates.
- Field additions/removals should be versioned.
- Template mappings should bind to field IDs where possible, not fragile strings only.

This is a larger sprint. It should be scoped carefully before implementation.

## Transactional Email Roadmap

Current state:

- SES handoff doc exists and was updated during planning.
- `support@vornan.co` exists.
- `dmarc@vornan.co` exists.
- SES/DNS records were added by the user.

Next steps:

1. Verify SES domain identity and DKIM.
2. Confirm MAIL FROM domain if used.
3. Set `PATHFINDER_STATUS_EMAIL_MODE=ses` in production only after a smoke test.
4. Add bounce/complaint observability if not already done.
5. Keep local/dev email mode as `log`.

## Security And Privacy Reminders

- Do not commit local store data, secrets, credentials, or `.env` files.
- Passwords/secrets must remain masked in API responses.
- Never expose PackageDetails negotiated shipping rate.
- Avoid public status responses that reveal whether an order number/email combination exists.
- Keep Lift real submit guarded.
- For public status token links, avoid logging raw tokens.
- Global status allowed domains should be explicit and conservative.

## Manual Import Synchronization Follow-Up

The current working tree includes a focused Manual Import correction discovered with the real Momentara setup:

- Saved Import Method mappings now synchronize into Manual Import immediately after changes and saves.
- Pre-preview product rows generate durable keys and display saved route product IDs instead of presenting a misleading unmapped placeholder.
- The local Canonical Order and Lift payload previews now receive those resolved identifiers before validation, matching the persisted preview service instead of reporting missing products alongside mapped product rows.
- Local certification now treats API-masked saved credentials as configured, matching route diagnostics while the real secret remains unavailable to the browser.
- Manual readiness counts only mapping gaps used by the uploaded order, while Output Product Map and dashboard surfaces continue to show broader catalog coverage.
- Preview-job actions now stay disabled until a source with valid order rows is loaded, reject empty requests defensively, and use consistent `Generate Preview Job` / `Regenerate Preview Job` labels.
- Pre-persistence Ext_ID presentation now says the Pathfinder Order Number will be reserved when the preview is generated instead of displaying the misleading reusable `PF-PREVIEW` token.
- Product Resolution Review now includes the canonical line quantity beside each generated customer product key.
- Job detail now distinguishes a first `Submit to Lift` action from later `Retry Submit` attempts instead of labeling an untouched Ready job as a retry.
- The local Momentara store was checked read-only: its saved field mappings and three mapped product IDs are correct.
- Web typecheck, production build, and `git diff --check` pass. No preview, deployment, or Lift request was made during this correction.

## First Live Lift Transport Attempt

- `JOB-253878` is the current Momentara two-line Premium Graphics preview using Pathfinder Ext_ID `PFMRTM76KH9A9F` and sandbox submit customer LTL Demo / 1249.
- Its first live transport attempt is preserved as Failed. The local runtime could not resolve the former internal `prod-lifterp` hostname, so Lift received no HTTP request and returned no order number.
- The local PROD target now uses the operator-confirmed public Lift `create_order` endpoint. A non-submitting HEAD request returned HTTP 200.
- Live submit requests now include `Accept: application/json`, matching the successful Postman header contract; credentials remain masked in stored submit snapshots and API responses.
- API and web certification now allow an intentional retry from `Submit Failed` while continuing to block previews that failed canonical, Lift payload, or product-resolution validation.
- Certification for `JOB-253878` has been refreshed and is currently eligible for retry. No retry has been sent.
- Job detail now shows the required PROD + LTL Demo confirmation beside Submit/Retry, keeps the action disabled until confirmed, and displays `Submitting…` while the request is active. This fixes the prior silent no-op after a refresh cleared the transient confirmation.
- Treat the Lift credential shown during troubleshooting as exposed and rotate it; never add it to source, docs, logs, or local store JSON.

## First Confirmed Lift Order

- `JOB-994730` / Ext_ID `PFMRTNIZAX18FE` was accepted by Lift and created order `A0226692` with two lines.
- The successful Lift response returned the number inside `message: "Order Number: A0226692"` instead of a dedicated order-number field.
- Pathfinder now extracts that response shape, persists the order number, transitions the job to `Order Confirmed`, and keeps order/proof/package/status controls available.
- Read-time reconciliation repaired the already-submitted local job without sending another request.
- A read-only Pathfinder lookup returned HTTP 200 and confirmed `A0226692`, `Pending Art`, quantities 17 and 7, product `One Sheet (30.375x46.375)`, and product `Pump topper (AOM)`.
- The local API is running on port 3110 with real Lift submit still explicitly enabled. Do not send another order without the operator's confirmation.

## Shared Lift Order Rollup Foundation

The current working tree now contains the first shared order-view slice for authenticated Pathfinder and `status.vornan.co`:

- `packages/order-rollup` owns Lift order/line normalization and the Standard Graphics job-flow `1006` step/status map transcribed from the operator-supplied January 26, 2026 status table.
- The curated per-line rail follows the operator-supplied Lift sequence: Obtain Art, PDF Proof, Approve Art, Approved, Rip Art, Print, Cut, Special Finishing, Pack, Ship, Invoice, Completed.
- Lift header `ORDER_STATUS` is displayed as order-wide context. Each order line independently displays its actual `LINE_STEP_ID` / `LINE_STEP_NUMBER` resolution and rail position.
- `packages/order-rollup-ui` renders the shared responsive order context, metadata, line cards, status rail, proof preview/link area, and shipment/package area.
- The line-step rail now uses a light Vornan forest/zinnia design; Lift's raw status colors are retained only as normalized source data and do not drive the UI palette.
- Authenticated job detail uses the shared component and keeps raw JSON collapsed under Developer details. The public status app uses the same component after the API has applied its public redaction policy.
- Job detail exposes one primary `View Order`/`Refresh Order` control. Secondary status-link and raw Lift/proof/package diagnostics live under Actions, while Submit/Retry is shown there only for eligible jobs.
- The existing confirmed order `A0226692` was refreshed read-only and verified as `Pending Art`, with both lines at `6: Obtain Art`, real Lift line IDs, quantities, product names, material, and dimensions.
- Desktop and 390px mobile browser checks passed without document-level horizontal overflow. On narrow screens the long production rail remains horizontally scrollable within each line card.
- A local status token was created only for visual QA in log/local mode. No email, deployment, or Lift submit occurred.
- During local status QA, a concurrent local JSON read/write race triggered the former catch-all seed fallback and reset `data/pathfinder-lift-submit.local.json`. Lift order `A0226692` and production were not affected, but the dedicated local dev file no longer contains the configured Momentara jobs/mappings. A local Time Machine snapshot exists from `2026-07-20 16:23:27`, before the reset, and is the safest recovery source.
- The persistence path is now hardened: local writes replace atomically, malformed/transient reads fail closed, and the existing file is never replaced with seed unless it is genuinely absent. A regression test verifies malformed operator data remains byte-for-byte intact.
- Proof-thread coordination details are recorded in `docs/PROOF_THREAD_ORDER_ROLLUP_NOTE_2026-07-20.md`.

Recommended continuation:

1. Add focused snapshot/API regression coverage for the enriched public and internal order contracts.
2. Validate a real proof response once Lift posts a proof, including line matching by actual Lift `ORDER_LINE_ID`, proof thumbnail rendering, and high-resolution links.
3. Add explicit refresh/last-updated affordances and decide whether confirmed orders should refresh on demand, on a bounded interval, or both.
4. Extend the normalized header details only when confirmed Lift lookup fields are available (PO/contract, requested dates, destination, and other customer-safe fields).

## Suggested Prompt For New Thread

Use this to start the next task:

```text
Please read /Users/marcusdavies/Projects/ltl-workspace/pathfinder/docs/THREAD_HANDOFF_2026-07-18.md, check git status, and continue Pathfinder development with the next recommended slice.
```

If the next slice is not specified, the best candidates are:

1. Validate the shared Order Rollup against the first real Lift proof and harden proof-to-line matching.
2. Add bounded refresh/last-updated behavior for confirmed Lift order snapshots.
3. Validate Import Method parsing/history against the next real customer workbook.
4. Transactional email SES smoke test and production switch.

## Order Snapshot Freshness And Regression Slice

The shared rollup now has an explicit, bounded freshness policy:

- Public status links remain immutable snapshots and do not create Lift reads when customers open or revisit them.
- Authenticated Pathfinder refreshes confirmed-order data only on `View Order` / `Refresh Order`.
- Internal refresh responses are reused for 15 seconds to absorb double-clicks and repeated renders without duplicating the three Lift reads. Configure this with `PATHFINDER_ORDER_SNAPSHOT_REFRESH_MIN_MS` if production telemetry supports a different interval.
- Internal responses identify `lift` versus `recent_snapshot`, the actual check time, and the next refresh time.
- The shared rollup always displays `Last checked` internally or `Snapshot captured` publicly.
- API regressions now preserve the enriched header/line/proof/package contract and the public redaction boundary.

No polling, deployment, Lift submit, Proof decision route, Proof grant, email, or Lift Proof write was enabled by this slice.

Recommended continuation after this slice:

1. Extend customer-safe header details only from confirmed Lift fields (PO/contract, requested dates, and destination).
2. Add refresh telemetry before considering any bounded interval polling; on-demand refresh remains the safer default.

## Real Lift Proof Gallery Validation

Proof ingestion is Lift-order-native. Any order available through the approved Lift order/proof read APIs can enter the normalized Vornan Proof cache; Pathfinder provenance is not a prerequisite.

The shared Order Rollup was validated with the redacted real `A0221132` capture:

- Four sibling attachments join once each to Lift `ORDER_LINE_ID` `9301338`.
- Each proof retains a distinct filename, safe preview URL, safe high-resolution URL, state, and creation date.
- Image assets render thumbnails; PDF/download-only assets never render as broken images.
- Unsafe, non-HTTPS, or credential-bearing URLs are rejected again at the shared UI boundary.
- The public projection retains customer-safe proof cards and summary counts while excluding attachment IDs, detailed reports, approver identity, grants, sessions, and all decision capability.
- Order Rollup proof cards remain view-only. Approve/revision/upload behavior belongs only to the separately gated Vornan Proof experience.

No live Lift call, Proof decision, grant creation, link email, deployment, or Lift write occurred during this validation.

## Customer-Safe Lift Order Header Enrichment

The shared Order Rollup now resolves its header fields with an explicit source boundary:

- Confirmed Lift values take precedence for PO number, order title, requested ship date, actual ship date, order type, and overall order status whenever the order lookup returns them.
- Submitted Pathfinder values remain the compatibility source for contract number, delivery/due date, and destination when Lift omits them.
- The UI labels populated values as `Confirmed by Lift` or `Submitted order` so operators and customers can understand what has been verified without confronting a configuration contract.
- Pathfinder and `status.vornan.co` use the same responsive metadata grid and date handling.
- Date-only Lift values are formatted at local midday, preventing `YYYY-MM-DD` values from appearing one day early in US timezones.
- Public status destination data is allowlisted to company, addressee, street address, city, state, postal code, and country. Phone, email, account/billing values, delivery instructions, and unknown shipping properties do not cross the public projection.
- The real Lift lookup for completed order `A0219609` was inspected read-only and confirmed `PO_NUMBER`, `SHIP_DATE`, `ACTUAL_SHIP_DATE`, `ORDER_STATUS`, `ORDER_STEP_ID`, and `HEADER_STEP_NUMBER`. That response does not include contract or destination fields, so Pathfinder truthfully retains the submitted values for those fields.

Recommended continuation after this slice:

1. Add a compact customer-safe shipment summary as real package/tracking records become available, keeping negotiated rates and account data redacted.
2. Validate the enriched shared header visually against a freshly captured internal snapshot and its public status token after the local operator store is safely restored.
3. Consider a direct Lift-order browser in authenticated Pathfinder only as a separate explicit slice; the Proof cache already supports Lift orders that did not originate in Pathfinder.

No polling, deployment, Lift submit, Proof decision, email, or Lift write was enabled by this slice.

## Customer-Safe Shipment Summary

The same Pathfinder/Status Order Rollup now includes an order-level shipment summary and clearer line package cards:

- `@pathfinder/order-rollup` owns the package allowlist and summary aggregation.
- Customer-safe package fields are tracking number, ship method, tracker message, box number, package type, and location name.
- The summary exposes bounded package count, unique tracking-number count, ship-method count, ship methods, locations, and carrier messages. Its states are deliberately conservative: `pending`, `activity_recorded`, or `tracking_available`.
- The public projection reconstructs every package from the allowlist. It does not spread internal package records into public status.
- Negotiated rates, Lift header/shipping IDs, package dimensions, weight, account data, manufacturing/product fields, and unknown properties are absent from the public package JSON. Raw PackageDetails payloads remain internal-only.
- Shared UI shows one compact responsive shipment panel and per-line cards that distinguish a package/box from its tracking number and carrier message.
- Completed Lift order `A0219609` was inspected through the existing read-only PackageDetails endpoint: 81 line/package records, Courier activity, no tracking numbers in that capture, and `NEGOTIATED_RATE` present in the source contract. No customer values or rate data were added to fixtures or documentation.

Recommended continuation after this slice:

1. Visually validate the enriched header and shipment summary against a safely restored local operator snapshot and a newly generated public status token.
2. Add carrier tracking links only if Lift begins returning an authoritative tracking URL or an approved carrier URL contract is defined; do not guess URLs from tracking-number formats.
3. Consider an authenticated direct Lift-order browser as a separate slice if Pathfinder should show non-Pathfinder orders outside the existing Proof queue.

No polling, deployment, Lift submit, status email, Proof decision, or Lift write was enabled by this slice.

## Combined Release Checkpoint

Pathfinder, the shared Order Rollup, and the Vornan Proof read-only foundation are frozen as one release candidate on `codex/vornan-proof-foundation`.

- The complete file set has been reviewed and classified. Local Proof screenshots/comparison notes are ignored; the sanitized Proof architecture DOCX is intentional.
- Pull requests and `main` pushes now run the non-deploying `Validate Pathfinder` workflow.
- Production API, admin, and status workflows refuse feature-branch deployment and run the complete workspace tests before publishing.
- The frozen tree passes all workspace checks, all 125 tests, all production builds, all 17 Proof deployment-safety tests, API/Proof Lambda packaging, both SAM lints, workflow/script syntax, write-gate scanning, and `git diff --check`.
- Proof public reads and every Proof/Lift write capability remain disabled. The first Proof deployment must be dark and protected in non-production.
- Release procedure, smoke tests, rollout ordering, and rollback are documented in `docs/RELEASE_COORDINATION_2026-07-20.md`.

The next Git action is the intentional feature-branch checkpoint commit and push. Merge and production API/admin/status deployment must use the reviewed `main` SHA; Proof remains a separate dark non-production rollout first.

## Combined Release And Proof Dark Deployment Handoff

The release checkpoint and initial protected Proof deployment are now complete.

- Pathfinder API, authenticated admin web, and public status web deployed successfully from merged `main` SHA `5afbb69` in runs `29786460634`, `29786589756`, and `29786666131`.
- The isolated `vornan-proof-dev` stack deployed successfully from merged `main` SHA `f250f29` in run `29791214408` after the reviewed OIDC trust and least-privilege CloudFormation lifecycle policy corrections landed through PRs #4-#8.
- CloudFormation is `CREATE_COMPLETE`; the SPA is published behind CloudFront and managed WAF.
- Workflow and independent smoke checks confirm public reads disabled, customer decisions disabled, direct API bypass rejected, and both QA/public-production approval parameters false.
- DNS was not changed. No Proof grant, link email, public session, decision, Lift submit, Lift Proof write, or customer-data synchronization occurred.

Recommended next slice:

1. Run the isolated read-only QA lifecycle against the dark `dev` distribution using controlled non-customer fixtures or an explicitly approved read-only test order.
2. Record cache/sync diagnostics, security headers, direct-origin rejection, responsive UI evidence, and immutable audit behavior.
3. Keep public reads and all write/decision gates off during QA.
4. Treat any DNS alias, production Proof trust, public-read enablement, grant creation, or customer email as a new separately reviewed and approved change.

## Jobs Management And Drill-In UX

The next operator-facing sequence has started with the Jobs cleanup slice on branch `codex/jobs-management-ux`, based on `origin/main` commit `87c5706` in the isolated worktree `/tmp/pathfinder-jobs-management`.

- Jobs list and job detail are now separate surfaces. Selecting a job opens its detail without leaving the surrounding customer/global Jobs context, and `All jobs` returns to the list.
- Active/Archived/All filtering and Updated/Created/State sorting are shared by both Jobs entry points.
- Operators can archive or restore one job from its row/detail Actions menu, or select visible rows for a confirmed bulk action.
- Archive is soft and reversible. It records `archived_at` and the operator email while retaining job state, Lift order data, attempts, audit history, and status links.
- Single and bulk archive APIs validate customer ownership; the bulk endpoint accepts 1-100 deduplicated job IDs.
- Controlled action menus now dismiss on outside click or Escape.
- Full repository validation passes on the merged Proof PR #11 baseline: every workspace check, all 139 tests, and all production builds.

Recommended continuation:

1. Checkpoint this Jobs slice after Proof PR #11 is reviewed and merged.
2. Begin Manual Import method reuse: allow the operator to select a saved Import Method so parsing settings, field mappings, product resolution, order-name rules, output route, and submit profile are preloaded while preserving a clearly labeled ad-hoc mode.
3. Follow with the customer-specific public order dropbox using a published Import Method, minimal pre-submit validation, customer branding/context, email verification, rate limits, durable intake audit, and no customer-facing mapping controls.

## Manual Import Saved Method Basis And UI Polish

The saved-method reuse slice is complete in the same `codex/jobs-management-ux` worktree and remains uncommitted pending an intentional checkpoint.

- Manual Import exposes an `Import basis` selector containing active saved Import Methods plus an explicit `Ad-hoc manual mapping` option.
- A saved basis drives workbook parsing, field mappings, product resolution, order-name resolution, Ext_ID strategy, output route, and that route's enabled submit profiles. Switching the basis immediately remaps the loaded column set and clears stale preview state.
- Ad-hoc previews are intentionally ephemeral: the preview job is persisted, but no ad-hoc Import Method is created and no saved method's mappings or last-run metadata are changed.
- The API rejects a stale explicitly selected method with a clear 400 response while retaining the legacy fallback for older callers that omit `import_method_id`.
- Submit Profile customer data now wraps in a narrow-safe stacked layout. Jobs selects match standard application controls, and the Transactional Email header warning has white contrast text.
- Full validation passes: every workspace check, all 140 tests, and every production build. Local browser verification found no horizontal overflow or console errors.

Recommended continuation:

1. Review and checkpoint the combined Jobs management + Manual Import saved-basis work, then push it for the normal review/deployment process when requested.
2. Build the customer-specific public order dropbox around a deliberately published Import Method; do not expose parser, mapping, product, route, or submit-profile configuration to the customer.
3. Keep the public intake boundary separate from external Lift submit: validate and persist the intake first, then use the existing operator certification/submit workflow unless a later explicitly approved automation policy is introduced.

## Customer Order Dropbox Foundation

The confirmed Jobs management and Manual Import saved-basis work was committed as `c71663a` and pushed to `origin/codex/jobs-management-ux`. The next slice is underway on `codex/customer-order-dropbox`.

- Each Active Import Method now has a `Customer Order Dropbox` publication panel. Operators control the customer headline/instructions, approved email domains, row ceiling, submit profile, and whether the page is published.
- Saving a published method creates a private server-generated key and displays the `status.vornan.co/intake/<private-key>` address. Disabling publication makes that page return unavailable without deleting the Import Method.
- The existing status application renders the Vornan/Pathfinder customer page. It accepts spreadsheet upload or pasted grid content, requires the configured work-email gate, and shows only product, quantity, final dimensions, and ready/review status.
- All parsing and order behavior comes from the saved Import Method. The public browser receives no parser configuration, mappings, route IDs, product identifiers, credentials, or email-domain allowlist.
- Customer confirmation creates an ordinary Pathfinder preview job with `public_intake` audit metadata and a Pathfinder reference. The operator must still review/certify and explicitly submit from authenticated Pathfinder; the public route cannot call Lift.
- Public upload requests default to a 5 MB maximum, obey the method's 1-1000 row ceiling, and are rate-limited by page, email, and IP.
- Focused API coverage proves wrong-domain rejection, bounded preview data, internal-only job persistence, no submitted state/attempt, and immediate disable behavior.
- The customer-facing default headline is customer-neutral (`Put your print order in motion.`), while the smaller customer label retains page context. Publication and email requirements use the same accessible Pathfinder switch treatment.

Before a release checkpoint, finish full checks/build/tests, browser-test the admin publication controls and public page at desktop/mobile widths, and verify there is no horizontal overflow or public leakage. No production deployment or real Lift submit is authorized by this slice.

Recommended continuation after the foundation is validated:

1. Add an operator intake indicator/filter so dropbox-created jobs are immediately recognizable in Jobs. (Started on `codex/public-intake-job-visibility` after checkpoint `30d079e`.)
2. Add explicit private-link rotation/revocation controls if customer URLs need scheduled rotation beyond the current publish/unpublish gate.
3. Decide whether work-email possession must be verified with a one-time code/link after transactional email delivery moves beyond log mode.
4. Keep Wrike GET/webhook automation separate; it can later feed the same saved Import Method and preview-job boundary.

## Public Intake Job Visibility

The Customer Order Dropbox foundation was committed as `30d079e`. The immediate operator follow-up is underway on `codex/public-intake-job-visibility`.

- Customer and global Jobs lists now distinguish `Customer dropbox` from `Operator` intake.
- The Intake filter narrows either list without changing the active/archive or sorting behavior.
- Authenticated job detail exposes the dropbox submitter email and received timestamp; none of this provenance is added to the public status surface.

## Customer Dropbox Private-Link Lifecycle

The operator visibility checkpoint was committed as `833c5ed` and pushed to `origin/codex/public-intake-job-visibility`. Private-link lifecycle work continues independently on `codex/public-intake-link-lifecycle`.

- A published dropbox now offers `Rotate link` and `Revoke link` beside `Copy page`.
- Rotation immediately invalidates the old URL, generates a new private key, and leaves publication enabled.
- Revocation immediately invalidates the URL, clears the key and publication timestamp, and disables publication. A later saved republish generates a different key.
- Both actions use explicit confirmation copy describing the immediate customer impact and are unavailable until ordinary Import Method edits are saved.
- Focused API coverage exercises the complete current-key/old-key lifecycle. No Lift submit, public automation, email verification, or Proof capability is enabled.
- Full workspace checks, all 149 tests, and all production builds pass. Local browser QA covered both confirmations and the 390px action layout without horizontal overflow or console errors.

Recommended continuation after this slice:

1. Review and checkpoint the lifecycle branch after full validation and responsive browser QA.
2. Decide whether customer work-email possession needs a one-time code/link once transactional email delivery is approved beyond log mode.
3. Keep Wrike GET/webhook ingestion as a separate source adapter feeding the same saved Import Method and preview-job boundary.

## Customer Dropbox Email Verification Foundation

Dropbox PR #18 was merged to `main` at `5a587a3`, and this follow-up branch was started from the subsequently synchronized `origin/main` baseline `b53dc48` as `codex/public-intake-email-verification`.

- `PublicIntakeConfig` now carries `require_email_verification`, defaulting false and forcing `require_email` true when enabled.
- The public API provides request/confirm endpoints for a six-digit code. Challenge IDs, codes, emails, and verification tokens are never persisted in raw form.
- Challenges expire in ten minutes, lock after five failed attempts, bind to one page key/email pair, and become consumed before the preview job is created.
- DynamoDB reuses the existing TTL-enabled order-status-token table with a distinct prefixed key and a conditional compare-and-set consumption write. Local storage keeps a separate optional verification collection for development/tests.
- The status application exposes a minimal verification step; changing the email clears the challenge, and submitting another order requires fresh verification.
- Admin exposes the per-method toggle only when authenticated `/api/email/status` reports the runtime available. The deployment gate defaults false.
- Current AWS read-only audit: SES identity, DKIM, and custom MAIL FROM are successful, but SES `ProductionAccessEnabled` is false and no GitHub `PATHFINDER_STATUS_EMAIL_MODE` variable is set, so deployments remain in `log` mode.

Full repository validation passes: every workspace check, all 150 tests, every production build, and `git diff --check`. Local browser QA completed code request, code confirmation, the verified-email state, and row preview at desktop and 390px mobile with no horizontal overflow.

Do not enable the production verification gate or SES mode until SES production access, recipient policy, delivery telemetry, bounce/complaint handling, and operator rollout approval are complete. This slice does not deploy, send real email, submit to Lift, or change Proof gates.

## Wrike Ingestion Contract Foundation

Email-verification PR #20 merged to `main` at `e4813d7`. The Wrike contract work then started from that synchronized baseline on `codex/wrike-ingestion-contract` in the isolated `/tmp/pathfinder-wrike-ingestion` worktree; the Proof branch in the main checkout was not changed.

- `Wrike` is now a scheduled Import Method source with a compact operator contract for folder/project scope, ordered workflow status, polling or webhook-plus-reconciliation, attachment rules, and reconciliation interval.
- A dedicated adapter package owns normalization, readiness, newest-workbook selection, and deterministic account/task/attachment/version identity.
- The contract is dark and preview-only. It contains no credentials or customer workbook data and cannot submit to Lift.
- `docs/WRIKE_INGESTION_STRATEGY.md` records the OAuth, webhook, attachment, idempotency, failure, and Momentara discovery decisions.
- Full validation passes every workspace check, all 161 tests on the reconciled Proof baseline, every production build, and `git diff --check`.
- Desktop and 390px local browser QA pass with the card spanning the setup grid, a clean single-column mobile layout, no horizontal overflow, and no browser errors.

Recommended continuation:

1. Validate and checkpoint this dark configuration slice.
2. Confirm Momentara's Wrike folder/project ID, Ordered status/custom-field ID, workbook naming/version behavior, regional host, and technical-user/OAuth approval.
3. Implement secret-backed read-only connection health before any task discovery or attachment download.

## Wrike OAuth Connection Health

Wrike ingestion-contract PR #21 was green and merged to `main` as `b79730e`. The next slice started from that exact baseline in the isolated `/tmp/pathfinder-wrike-connection-health` worktree on `codex/wrike-connection-health`; the Proof checkout was not modified.

- Authenticated Settings now owns one platform-level Wrike OAuth connection; credentials do not live in an Import Method or browser response.
- The local and AWS Secrets Manager drivers support a dedicated `<secret-prefix>/connectors/wrike` record.
- Saving credentials performs no external request. The explicit test is server-gated by `PATHFINDER_ENABLE_WRIKE_CONNECTION_TEST`, default false.
- When deliberately enabled, the health test refreshes OAuth and performs only the Wrike `GET /contacts?me=true` authorized-user query under `wsReadOnly`.
- Regional hosts are restricted to bare HTTPS `wrike.com` hostnames, token rotation is persisted, and responses expose only configured flags and safe health metadata.
- Rotated OAuth credentials are retained inside the secret boundary even when the subsequent current-user health check fails, so a post-refresh outage does not strand the next retry.
- No task/folder discovery, attachment download, webhook, polling, background worker, Wrike write, preview creation, Lift action, real credential entry, or deployment is part of this checkpoint.

Full validation passed 169 workspace tests, all 55 Proof deployment-safety tests, every workspace check/build, diff hygiene, and responsive desktop/390px browser QA with the server gate disabled.

Recommended continuation after review:

1. Confirm and explicitly approve one Wrike test task, folder/project ID, workflow status/custom-field ID, regional host, and dedicated technical-user OAuth grant.
2. Add a bounded read-only discovery preview for only that approved scope; return identifiers/counts needed for operator confirmation without downloading attachments.
3. Keep attachment retrieval and preview-job creation as later, separately reviewable slices.

## Wrike Approved-Scope Discovery Preview

Wrike connection-health PR #24 was reviewed green and merged to `main` as `1ffbb44`. The next branch, `codex/wrike-discovery-preview`, started from that exact baseline in the isolated `/private/tmp/pathfinder-wrike-discovery-preview` worktree; the Proof checkout was preserved.

- Wrike Import Methods now save one `approved_discovery_task_id` for an explicit operator-reviewed scope.
- Authenticated operators have a compact read-only preview action only when the Import Method is saved, the contract is complete, OAuth is configured, and the separate server gate is enabled.
- The server refreshes OAuth, queries the exact approved task, verifies direct or nested folder/project scope and ordered status, then requests attachment metadata with URLs disabled only after scope matches.
- The browser receives IDs, counts, and checks only. No task copy, filenames, URLs, file contents, tokens, or arbitrary provider fields are returned or persisted.
- `PATHFINDER_ENABLE_WRIKE_DISCOVERY_PREVIEW` defaults false everywhere. No gate was enabled, no real credential was used, and no deployment or external Wrike request was performed during development.
- Attachment download/selection, durable source audit, job creation, polling, webhooks, Wrike writes, and Lift actions remain separate and unavailable.
- Release validation passes every workspace check, all 173 workspace tests, every production build, all 61 Proof deployment-safety tests on the merged Proof baseline, and `git diff --check`.
- Local in-app browser QA passes at 1280px desktop and 390px mobile with the discovery gate disabled, the preview action visibly unavailable, the safety boundary intact, and no horizontal overflow.

Recommended continuation:

1. Checkpoint this completed dark slice.
2. Before any real Wrike preview, explicitly approve one task/folder/status scope, least-privilege technical-user OAuth credentials, the environment, and a bounded QA window; enable only the discovery gate for that window.
3. After successful read-only QA, implement attachment selection/download plus durable source-audit evidence as the next separate slice. Continue to stop before Pathfinder preview-job creation.

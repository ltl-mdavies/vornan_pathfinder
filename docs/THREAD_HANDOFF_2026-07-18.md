# Pathfinder Thread Handoff - 2026-07-18

This document is the working handoff for continuing Pathfinder development in a fresh Codex thread. It summarizes the current repo state, major milestones, live infrastructure, useful docs, and the next slices of work.

## One-Minute Context

Pathfinder is a Vornan-branded order translation and routing platform. The current MVP takes customer order input, especially Momentara XLSX workbooks, maps it into a Canonical Order, resolves products against a route-specific output product map, generates Lift Standard Graphics payloads, and prepares or gates Lift submit. It now also has a public order status surface at `status.vornan.co`, backed by Lift order/proof/package lookup integrations and tokenized status request flows.

The platform is no longer just a local prototype. The admin web app, API, and public status app have AWS production hosting paths, Firebase Google Auth, DynamoDB persistence, Secrets Manager support, SES transactional email planning, and GitHub Actions deployment workflows.

## Repo And Git

- Local repo: `/Users/marcusdavies/Projects/ltl-workspace/pathfinder`
- Main branch: `main`
- Remote repo: `ltl-mdavies/vornan_pathfinder`
- Current committed HEAD: `d45f2d1 Add per-sheet header overrides`
- Branch state before the Import Method persistence regression sprint: `main`, synchronized with `origin/main`
- Commit `932d6eb` was deployed successfully to the admin app, status app, and API.
- Commits `aaac73c`, `a6bceb5`, `e5dbbb5`, and `d45f2d1` have been pushed but have not been deployed.
- The working tree now contains the intentional Import Method persistence regression and source-metadata sanitization changes; they remain uncommitted pending review.

Recent commits:

```text
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

Current in-progress slice:

- Adds method-level persistence regressions for source schemas, parser settings, per-sheet overrides, mappings, and saved mapping templates.
- Verifies partial updates preserve the active method's mappings without changing a neighboring method.
- Normalizes legacy parser snapshots that predate per-sheet override maps.
- Allowlists persisted source-schema metadata so raw workbook rows and cell values are rejected at the store/API boundary.
- No production deployment or real Lift submit behavior is part of this slice.

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

Recommended next slices:

1. Refine the existing bulk map flow only when needed:
   - Keep multi-row selection clearly separate from the primary row-level workflow.
   - Add an explicit confirmation before one Lift product is assigned to several Pathfinder rows.
2. Clean details panel:
   - Show only real payload field names and values.
   - Avoid duplicate `unit_number` / `unit_numbers` display unless both are truly present in the payload and meaningful.
3. Continue Product ID strategy language cleanup:
   - If route strategy is `product_id`, Product Resolution should talk about "route product identifier", not unit number.
4. Revisit catalog scope only where live operator feedback still shows friction:
   - Preserve the current active-scope treatment, catalog-name import, and preset deduplication behavior.

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

1. Consider a schema version/history view if operators need to compare template changes over time.
2. Validate the header heuristics and override controls against the next real customer workbook before adding more per-sheet parser settings.
3. Add endpoint-level request validation if live integrations begin sending malformed Import Method payloads.

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

## Suggested Prompt For New Thread

Use this to start the next task:

```text
Please read /Users/marcusdavies/Projects/ltl-workspace/pathfinder/docs/THREAD_HANDOFF_2026-07-18.md, check git status, and continue Pathfinder development with the next recommended slice.
```

If the next slice is not specified, the best candidates are:

1. Import Methods schema version/history if operators need template comparison.
2. Add confirmation and separation to the existing bulk product-map flow.
3. Transactional email SES smoke test and production switch.
4. Mobile polish for login, dashboard, overview, and public status.

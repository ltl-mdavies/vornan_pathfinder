# Shared-shell local review

This runs the **actual Admin App** against synthetic, schema-generated fixtures. It is not a replacement application or an API deployment.

```sh
npm ci
node --import tsx/esm tests/ux/generate-fixtures.mjs
npx vite --config tests/ux/vite.config.ts
```

Open http://127.0.0.1:5210. The generated JSON and evidence screenshots are ignored by Git. The production build does not import this entry point.

### Combined Proof/catalog guard review

The new generic catalog is off by default. To exercise it against synthetic records only:
`PATHFINDER_UX_PORT=5440 PATHFINDER_UX_CATALOG=true npx vite --config tests/ux/vite.config.ts`.
Use `?catalogReview=ready`, `reader`, `unknown`, or `pending`; the latter holds a simulated write for eight seconds then returns an uncertain result. Open a synthetic customer → Catalog. `tests/ux/catalog-preview.csv` is a new-row preview fixture for the first customer. All writes terminate in the in-memory adapter, never an external API. Counters show simulated writes and sign-outs. Item saves are deliberately rejected or interrupted; this fixture does not prove server persistence.

Verify preview Keep/Discard and sign-out protection; pending controls; unresolved journal survival on reload; read-only status checking without replay; isolation when switching customers; preservation of Catalog for another allowed customer and Overview fallback when the new catalog is unavailable. The existing Artwork Catalog is a separate unchanged tool. The UI gate does not replace API grants.

Run without `PATHFINDER_UX_CATALOG` to verify the new tab stays hidden. `&noCatalogIdentity` simulates absence of the stable signed-in identity and also hides it. For Proof guard/sign-out checks use the existing `?proofSettings=pending` fixture; its controls simulate sign-out without logging out of any real account. Do not deploy this harness.

### Deterministic startup checks

Use `PATHFINDER_UX_PORT=5214 npx vite --config tests/ux/vite.config.ts` for an isolated follow-up beside the existing review. API requests still terminate in this same in-memory adapter.

- `?startupHold=targets,registry`: customers finish first while global bootstrap remains pending. No customer-directory action or legacy loading panel should appear. **Release startup reads** completes the held requests. Reload resets the gate.
- `?startupHold=directory`: holds the first directory read. The shared shell and compact loading message remain available.
- `?startupFail=directory`: initial directory read fails once; **Try again** recovers.
- `?startupHold=workspace&startupFail=workspace&wrike_oauth=connected&wrike_customer_id=1249`: exercises the existing customer-scoped OAuth return URL using fixtures only. It does not connect Wrike. Release shows the scoped workspace error, with retry/directory controls. Retry loads LTL Demo, never the background default customer.
- Opening Example new customer still requires explicit **Set up workspace**; root startup never offers that action just because a background customer is unconfigured.

The harness bypasses AuthGate with an explicitly labeled synthetic session; these checks are not proof of real authentication or provider behavior. The authenticated lazy fallback is covered separately by its source contract and visual review.

Startup follow-up acceptance, October 24, 2026: runtime `d6c37b1`, isolated branch `codex/pathfinder-startup-followup`, baseline deployed `cc7c652`. Development and Pathfinder UX independently verified held root startup, reload, release to Dashboard, directory error/retry, and LTL Demo 1249 OAuth-return workspace error/retry. UX reviewed at 1366 × 768. Loading has no directory action, legacy panel or workspace skeleton; actual customer errors retain compact recovery controls. General customer/job URL deep links are not implemented by the existing App and were not added in this slice.

All workspace typechecks, the Admin build and 1,385 tests passed (API 800, Proof 76, Status 17, Admin 252, shared packages 240). The first sandboxed API run could not bind local Supertest ports; rerunning with local bind permission passed without source changes. The existing bundle-size build warning remains. Development screenshots are in `output/startup-review/`; UX evidence is in its `login-startup-review/startup-checks.json` and accompanying screenshots. No login/auth behavior, public app, API or provider code was changed. The authenticated lazy fallback is source-contract covered; the synthetic App harness does not prove a real Firebase session restore. This follow-up remains **local and undeployed**, pending the coordinated login selection/review and Development release process.

## Safety boundary

### Proof settings draft guard (synthetic only)

`?proofSettings=success&wrike_oauth=connected&wrike_customer_id=1249` opens the actual App's Customer Settings with in-memory Proof policies. No API/provider transport is used. The OAuth query only selects the existing Settings return route; no OAuth exchange occurs. Other modes: `failed` (400), `pending` (held until **Release synthetic request**), `unconfirmed` (503 without applying), `lost-response` (apply in memory, then 503). The visible request counters count simulated operations only. Unknown operations remain blocked by the existing harness.

**Test unload handler** dispatches a cancelable synthetic beforeunload event to the real App listener and reports whether it was prevented. It does not prove that a browser will show its native reload/close dialog. Controller drafts and unresolved requests persist only within the running App, not through a full browser reload. Fixtures reset on reload.

- All fetch requests terminate in the in-memory adapter; unknown routes fail closed.
- Mutations return 423, except explicitly simulated workspace setup and the opt-in integration scenarios below. Neither reaches a server or provider.
- No real email, Lift, Wrike, Proof approval, submission, archive or provider action is performed.
- CSP restricts connection origins to the local harness and blocks frames/form submission. Pop-up actions are disabled.
- Feature flags here are test inputs only: existing Catalog eligibility remains LTL Demo 1249 and intake visibility remains Momentara 284619.
- The masthead labels the session **Local review · sample data**. Never use fixture rows as evidence of production state.

## Scenarios

| Query | Scenario |
| --- | --- |
| No query | 64 synthetic jobs across Momentara/Wrike and Silicon Pasture/JSON, including two archived jobs; LTL Demo has no jobs |
| `?slow=174094` | Delays Silicon Pasture workspace, source-connection and detail reads 1.8 seconds; switch away before they complete |
| `?zeroJobs` | Empty global feed; Momentara Jobs → More → Intake follow-up still exposes a request without a job and a synthetic delivery receipt |
| `?membershipError` | Membership unavailable; directory must not call missing membership inactive/unconfigured |
| `?jobsError` | Job feed unavailable from first request; show error/retry, not successful zero results |
| `?jobsStale` | Two successful job reads, then failure; retain loaded rows and last-success timestamp |
| `?customerWorkflows` | Adds 12 synthetic product mappings with mixed states, dimensions and long names, plus paused/draft methods. Uses existing manual-XLSX method configuration; names are not proof of Wrike/JSON-specific editor coverage. All writes still fail closed with 423. |
| `?customerWorkflows&adminReview` | Customer Settings includes the real connector definition catalog with no configured connections. Global Settings includes a synthetic log-mode email status. No emails or provider calls are sent. |
| `?adminReview&emailSes` | Synthetic SES configuration; this is not proof that production SES is enabled or healthy. |
| `?adminReview&emailError` | Email status fails from the first read; delivery mode must be unknown, not log mode. |
| `?adminReview&emailStale` | First email read succeeds, subsequent Refresh fails; preserve the last read data and timestamp with a stale warning. Add `&emailSes` to test this for SES. |
| `?adminReview&emailSlow` | Delays each email read by 2.5 seconds. |
| `?adminReview&connectionsError` | Customer source-connection read returns a synthetic 403. |

Example new customer 300001 is not configured initially. Opening it must not create a workspace. **Set up workspace** exercises the original frontend flow against the simulation only. Reload resets this setup.

Other administrative API routes are intentionally not fully simulated. A local fixture error in those inner editors is not evidence of a production API failure. The acceptance scope is shell continuity and the directory/Jobs workflows, with existing API/domain suites verifying unchanged business behavior.

See the root `design-qa.md` and `docs/pathfinder-ux-slice1-handoff.md` for evidence, limits and release boundaries.

## Catalog stress and local-file review

`?catalogStress` adds 35 synthetic rows to the five bundled products, including long multi-word names and unbroken identifiers. Open Customers → LTL Demo → Catalog. This changes only the test entry point's in-memory fixture array; production builds do not import it. Use the original Pump Topper Chevron row for inspection navigation. Added rows are density fixtures, not connected products or inspection reports.

Run `node tests/ux/generate-artwork-inputs.mjs` to create a temporary directory containing the bundled PDF/PNG, an optional JPEG converted with macOS `sips`, an invalid PDF, and a sparse 250 MB + 1 byte file for selection-limit testing. These files contain no customer artwork. The oversized fixture must be rejected before reading/hashing. Choose a valid file afterward to verify recovery. Nothing is uploaded or persisted by Catalog.

`?catalogSlow` delays real local file reads by 20 seconds. Verify processing focus, Tab/Shift+Tab containment, Escape, completion and return focus. `?catalogLate` additionally remounts the App one second into the read, simulating leaving the workspace. Its visible QA output records release of a late preview URL; the fresh App must stay on Dashboard rather than showing the old result. Both scenarios patch browser APIs only in this test entry point and never change the production analyzer or persist files.

## Internal Proof queue review (Slice 2)

The actual Admin queue now receives 54 synthetic lines across 18 orders and three customers. The API simulation returns 27 lines per global cache page or 9 per customer page. Display pagination is separate from cache loading. Mixed states, missing timestamps, stale snapshots, and long product names are intentional.

| Query | Scenario |
| --- | --- |
| `?proofEmpty` | Successful empty cache; tools remain available. Cached order lookup fixtures still exist. |
| `?proofSlow` | Each queue read takes 1.8 seconds; counts must stay unknown until success. |
| `?proofError` | First-load 503; unknown counts and retry, not successful zero results. |
| `?proofRecover` | First Dashboard/queue reads fail, then Retry succeeds; focus moves to Search. |
| `?proofRestricted` | 403 restriction; permissions are not changed. |
| `?proofDisabled` | 404 feature unavailable; existing tools remain independently gated. |
| `?proofStale` | Dashboard + global queue initially succeed, then refresh fails. Customer scope succeeds once, then fails. Retain last-success data/time. |
| `?slow=174094` | Also delays the Silicon Pasture Proof queue; switch away to test late responses. |

Cached internal tool fixtures include `A9000000` (Momentara), `A9000001` (Silicon Pasture), `A9000002` (LTL Demo), through `A9000017`. All grant, approval, upload, publication and email capabilities are disabled in the synthetic health response. No external actions are available. Opening a row uses cached GET inspection, not a public access grant. Customer lookup of another customer's order must fail closed.

Dashboard automatically reads the global queue once on initial load; therefore `proofStale` permits two successful global reads before failure. Reload resets counters. Do not interpret this deterministic fixture schedule as production retry behavior.

## Isolated integration review

Open `?customerWorkflows&adminReview&integrationReview&reviewCase=my-review`. This renders the actual Admin components against a test-only contract simulator. The masthead and fixed review label explicitly identify **simulated saves**. It is not a real API integration or evidence of production persistence.

Only these writes can succeed:

- Create a canonical field or edit its metadata. Validation, duplicate paths, change history, snapshots and snapshot comparison are simulated.
- Change the **name only** of an existing customer output route or import method. Routing, policy, credentials, activation and mapping changes remain blocked.

Changes are stored under `pathfinder-ux-integration-v1:<reviewCase>` in **sessionStorage**, scoped to the browser tab and case. Reload retains them. Use a different case to start clean, or **Reset simulated data** to clear that case. Workspace setup retains its older in-memory-only behavior and resets on reload. No jobs, secrets or full customer workspaces are persisted by the integration simulator.

| Additional query | Scenario |
| --- | --- |
| `&saveRecover` | First eligible save per path returns 503 without changing the record; retry succeeds. The failure budget survives reload. |
| `&integrationDenied` | Eligible writes return 403. This tests error handling, **not** a new viewer/editor/admin role model. |
| `&snapshotError` | Snapshot and comparison reads return 503. First create a field using the same review case without this flag. |
| `&snapshotRecover` | First snapshot/detail comparison read per resource returns 503; **Retry snapshot** recovers. Reload resets these read-failure counters. |
| `&connectionsError` | Source-connection read returns 403 rather than a successful empty list. |
| `&proofingError` | Proofing API configuration read returns 403 rather than an unconfigured record. |
| `&proofingRecover` | First Proofing configuration read per environment returns 503; **Retry configuration** recovers that environment only. Reload resets these read-failure counters. |

Integration mode adds paused/draft methods whose real source types are **Wrike** and **REST API**, a synthetic configured Wrike connection with provider-action capabilities disabled, and masked Proofing API presence metadata with no credential values. These are richer editor fixtures, not connected services. Submit, email, OAuth, credential save/clear, provider test, proof approval and unsupported writes still fail closed. Off-origin fetches are rejected before routing.

Review script: Settings → New Draft Field → enter `order.qa_reference` and a label → save/failure/retry → reload and search → Governance → Open Latest. Targets → Lift ERP → Output Routes → change Route Name only → Save Customer Route → reload and reopen. Check a different customer to verify isolation. Do not edit other target fields while testing route-only save; the existing shared-target guard must remain intact.

Run `npm run test --workspace @pathfinder/web` for the simulator contract/safety tests. Standalone fixture typing uses strict mode: `npx tsc --noEmit --strict --module ESNext --moduleResolution Bundler --target ES2022 --jsx react-jsx --esModuleInterop --resolveJsonModule --skipLibCheck tests/ux/integration-fixtures.ts`.

## Isolated submission review

Open `?submissionReview=ready&reviewCase=my-review`, then the single synthetic job from Dashboard. The actual Admin UI receives simulated submit responses; **no provider request, production reservation, or reconciliation worker runs**. Do not combine this mode with `integrationReview`; submission review takes precedence. All non-simulated writes remain blocked.

| Value of `submissionReview` | Scenario |
| --- | --- |
| `ready` | Certified synthetic job. Submit becomes uncertain, with one attempt and no confirmed Lift number. |
| `uncertain` | Starts with an uncertain attempt. The UI must not offer another submit. |
| `confirmed` | Starts with a reconciled order and the unchanged historical uncertain attempt. |
| `changed` | Submit returns a reviewed-payload mismatch without recording an attempt. |
| `blocked` | Submit returns a certification refusal without confirming an order. |
| `network` | Simulates losing the browser response after a reservation; reopening the job reveals the uncertain attempt. |

The fixed **Simulate reconciliation** control advances only the original uncertain synthetic job to confirmed without reloading. Use the product's Refresh job action to inspect the new state and audit history. It is a QA control, not a product action or API endpoint. **Reset simulated submission** clears this case and reloads. Session storage contains only an outcome enum under `pathfinder-ux-submit-v1:<scenario>:<reviewCase>`, not customer data, payloads or credentials. The visible QA panel counts submit, preview and job-read requests in the current page instance. **Fail next job read** makes the next original-job GET return 503; retry succeeds.

The runtime response advertises mock transport and a simulated enabled gate solely to exercise the UI; the real API environment is untouched. These fixtures complement the actual API integrity, reservation and reconciliation tests; they do not establish live transport or automatic Wrike writeback behavior. Strict fixture typing uses the same command above with `tests/ux/submission-fixtures.ts`.

Add `&submissionSlow` to `submissionReview=ready` for an eight-second response delay after the simulated reservation. This adds a second synthetic job so reviewers can navigate away while the first response is pending and verify that a late result does not replace the newly opened detail.

### Manual Import recovery

Open `http://127.0.0.1:5210/?submissionReview=network&manualImport&reviewCase=manual-review-1` with a new case name for each clean run. Navigate Customers → Empirical – Momentara → Manual Import. Choose **Use Sample**, product key **SKU**, order identity **Order Number**, then **Generate Preview Job** in the upload panel. The fixture supplies approved synthetic sample mappings; the actual frontend still performs its local validation. Wait for automatic certification to finish, then use **Submit to Lift**.

- `network`: lost response after simulated reservation. Submit and certification refresh stay disabled. Fail next job read → Refresh job preserves the lock; retry shows pending; Simulate reconciliation → Refresh job shows confirmed. The submit counter must remain 1 throughout.
- `rejected`: explicit 422 with failed certification, no accepted order. Submission remains disabled until an authoritative reread/review. No uncertain-order warning is fabricated for this known refusal.
- `success`: immediately returns a confirmed job. Submit remains disabled even though simulated certification remains positive.
- `ready&submissionSlow`: delays submit response eight seconds. Use Sample and repeat the two column choices and preview generation before completion; the second persisted preview has a distinct job ID. The old response must not replace its state/feedback. Alternatively switch to Silicon Pasture while pending; no old job or attempt may become its current preview.
- `&manualReadSlow`: job GET delay of eight seconds, for navigation during refresh.
- `&previewSlow`: preview POST delay of eight seconds, for navigation during preview creation.

Preview generation in this mode is an in-memory contract simulation, not an invocation of the production preview builder. First preview uses the original synthetic job; later previews get distinct IDs and independent outcomes. Additional previews live only until reload. Reconciliation/fail-next-read controls target the original job. All external/unsupported writes remain blocked; no server credentials or real customer files are used.

## Provider-free sign-in review

Run `PATHFINDER_UX_PORT=5214 npx vite --config tests/ux/vite.config.ts`.
Open http://127.0.0.1:5214/auth.html?state=signed-out.
Supported state values: `signed-out`, `checking`, `signing-in`, `error`,
`expired`, `restricted`, `unconfigured`. The disclosure below the page
provides a state selector. Google action only simulates busy; Sign out only
returns to signed out. This entry imports the actual AuthScreen presentation,
not AuthGate, Firebase or the application API. It does not authenticate, email,
or alter live records. Auth preview is outside the production web build.

Reference, screenshots, responsive checks and limits: ../../design-qa.md.
The Google mark in public/brand is extracted unchanged from the prior auth
component; the Vornan/scout logo is the existing official asset.
Deployment remains held pending independent UX and user review.

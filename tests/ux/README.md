# Shared-shell local review

This runs the **actual Admin App** against synthetic, schema-generated fixtures. It is not a replacement application or an API deployment.

```sh
npm ci
node --import tsx/esm tests/ux/generate-fixtures.mjs
npx vite --config tests/ux/vite.config.ts
```

Open http://127.0.0.1:5210. The generated JSON and evidence screenshots are ignored by Git. The production build does not import this entry point.

## Safety boundary

- All fetch requests terminate in the in-memory adapter; unknown routes fail closed.
- Mutations return 423, except explicitly simulated workspace setup, which changes only the current browser's configured-customer set.
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

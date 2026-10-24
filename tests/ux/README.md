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

Example new customer 300001 is not configured initially. Opening it must not create a workspace. **Set up workspace** exercises the original frontend flow against the simulation only. Reload resets this setup.

Other administrative API routes are intentionally not fully simulated. A local fixture error in those inner editors is not evidence of a production API failure. The acceptance scope is shell continuity and the directory/Jobs workflows, with existing API/domain suites verifying unchanged business behavior.

See the root `design-qa.md` and `docs/pathfinder-ux-slice1-handoff.md` for evidence, limits and release boundaries.

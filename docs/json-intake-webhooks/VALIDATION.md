# Local validation record — 2026-09-28

Baseline and refreshed origin/main: `14ff397b9b1bc317d9c22cb6023b95ba2360a5f7`. Branch: `codex/json-intake-foundation`. The accompanying foundation commit is the local candidate; record an exact release/merge SHA separately if later proposed for release.

## Executed

| Check | Result |
| --- | --- |
| Handoff manifest transfer | All 36 immutable entries: SHA-256, byte count and preserved file mode match. Mutable coordination files copied separately. |
| `npm run check` | All workspace TypeScript checks passed. |
| `node --import tsx/esm --test apps/api/tests/json-intake.test.ts` | 16 passed, including loopback auth/status, concurrent identity reservation, cross-process receipt CAS/restart, existing shared local ledger restart, crash boundaries, stale claim rejection, operator-review preservation, integrity/expiry/errors and URL refresh. Rerun after final directory fsync tightening. |
| `npm run test --workspace @pathfinder/api` | 623 passed, zero failures (includes the 16 new tests). Existing intake, public intake/auth, Proof, Status and writeback API regressions included. |
| `npm run test --workspace @pathfinder/templates --workspace @pathfinder/lift-adapter --workspace @pathfinder/wrike-adapter` | 29 template, 15 Lift adapter, 55 Wrike adapter tests passed. |
| `npm run check --workspace @pathfinder/api` | Rechecked after final foundation changes. |
| Immutable sent HMAC vector | Exact raw-body MAC/event ID match; altered trailing byte rejected. No signing implementation or partner delivery added. |
| Local original-PDF integration check | Four privately retained handoff PDFs read only from local files, retained unchanged through this service, byte/hash/approval checks passed. Retry reused one receipt and one shared local attempt. Zero jobs/submissions. Temporary private test store removed afterward. |
| `git diff --check` and staged privacy review | Required before local commit; handoff/artwork/runtime files excluded. |

One initial loopback test run failed because the filesystem sandbox disallowed the local listener. It passed with approved loopback-capable execution. A quantity-conflict test was updated to keep declared area consistent after the adapter gained area validation; the changed valid order then exercised 409 as intended. No failing checks remain in the final focused run.

## Scope and limits

The synthetic `%PDF-` fixture deliberately proves integrity checks only. It is not a structurally valid production PDF and tests/status explicitly retain `inspection: not_run`. The private original-PDF check verifies unchanged source bytes and approval linkage; it does not rerun PDF geometry, contour, color or malware inspection. The earlier source inspection reports remain unchanged in the private handoff.

No browser/UI changes. Full frontend browser regression, deployment-contract/packaging checks, production DynamoDB durability/fencing, current deployed surface/config inventory, production smoke, customer activation, shipping/callback delivery, and rollback exercise were not run. They are release gates under RELEASE_COORDINATION.md, not satisfied by these local tests. The API router is unmounted/default-disabled, test-only; no live Lift/Wrike/email/callback or production config/data action occurred.

## Release ledger

- PR / merge SHA: none; local review foundation only.
- Changed existing files: `.gitignore` (private handoff exclusion), `packages/canonical/src/index.ts` (type exports only).
- New files: isolated JSON intake adapter/auth/local-store/service/router, canonical extension, sanitized fixture, tests and these design/validation documents.
- Production/config/IAM/schema migration diff: none. Local receipts are versioned 1 and append-only; no existing shared storage mutation/migration is required by this unmounted module.
- Existing hotfixes: main re-fetched at completion; no intervening changes beyond kickoff baseline.
- Deployment artifacts/workflows/current surface baselines: not checked; no deployment requested.
- Rollback for this local slice: stop the test harness/remove its mount; preserve private receipts/assets for investigation. Never delete shared production data. Future release requires verified per-surface artifact/config rollback and explicit user authorization.

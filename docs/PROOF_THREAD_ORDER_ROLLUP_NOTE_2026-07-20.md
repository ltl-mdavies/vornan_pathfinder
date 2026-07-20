# Proof Thread Coordination Note — Order Rollup

The concurrent Order Rollup work that temporarily blocked the Proof thread is now complete enough for shared validation.

## Resolved blockers

- `@pathfinder/order-rollup` now exists at `packages/order-rollup` and is declared in the API, web, and status workspace dependencies.
- `@pathfinder/order-rollup-ui` now exists at `packages/order-rollup-ui` and is declared in the web and status workspace dependencies.
- The `apps/api/src/server.ts:1104` `material` type mismatch was normalized to a string-or-null value.
- `npm install --ignore-scripts` updated the shared lockfile with both Order Rollup packages while preserving the concurrent Proof package entries.
- Repository-wide `npm run check` passes, including `@pathfinder/api`, `@pathfinder/proof`, `@pathfinder/lift-proof-adapter`, and `@pathfinder/proof-domain`.

## Shared API/store changes the Proof thread should retain

- `apps/api/src/server.ts` normalizes Lift order lookup data into internal and public order snapshots: authoritative header status, per-line step/status, Lift line ID, quantity, material, and final dimensions.
- `apps/api/src/store.ts` extends the public status snapshot types with those normalized order/line fields.
- Local JSON store writes are now atomic, and non-`ENOENT` read/parse failures fail closed instead of replacing an existing store with seed data.
- `apps/api/tests/local-store-durability.test.ts` verifies malformed local operator data remains byte-for-byte intact.

## Proof safety boundary

- No Proof decision capability, public-read gate, grant gate, link-delivery gate, or Lift write gate was enabled by the Order Rollup work.
- Proof data remains read-only in this slice. The shared rollup only renders proof thumbnails and links when a normalized snapshot already contains them.
- Proof ingestion is Lift-order-native: any order exposed by the approved Lift read APIs is eligible, regardless of whether Pathfinder created it.
- The redacted real `A0221132` capture now validates the integration point: four sibling attachments match real `ORDER_LINE_ID` `9301338` exactly once and render through the shared view-only proof gallery.
- Do not duplicate the order rollup inside the Proof app; keep decision capabilities exclusive to the separately gated Proof experience.

## Local development caution

Local QA exposed a prior non-atomic store race that reset `data/pathfinder-lift-submit.local.json`. Production and Lift order `A0226692` were unaffected. A local Time Machine snapshot exists from July 20, 2026 at 4:23:27 PM and is the safest recovery source for that dedicated dev file. Keep concurrent API processes on separate `PATHFINDER_LOCAL_STORE_PATH` values.

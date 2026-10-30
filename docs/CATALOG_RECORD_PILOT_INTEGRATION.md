# Catalog record integration contract

This candidate adds authenticated catalog records, repeatable standard-template imports, reasoned item edits, and persisted PO reconciliation receipts. It does not enable a pilot, submit an order, replace artwork, approve a proof, send email, or migrate a legacy customer.

## Source boundary

Base: `8ce652c216bbd7193216d63ea5c326ddc23c19c3`. Shared-file changes are limited to the API router import/mount after `requirePathfinderAuth`, two workspace dependency declarations, and the lockfile linkage. The main App, Proof, canonical order model, Lift adapters and existing intake behavior are unchanged. No customer-specific adapter, catalog data, material crosswalk, historical order or live art URL is part of this candidate.

`packages/catalog-domain` is generic. The frontend obtains customer identity and records through `catalog-records` APIs. Import customer/source identity must match the server registry; only `standard-v1` is supported here. Legacy export conversion remains a separate private migration task. Product/material selections require separately reviewed mappings; this candidate does not infer them or build Lift payloads.

## Activation and permissions

Both `PATHFINDER_ENABLE_CATALOG_DRAFTS` and `PATHFINDER_ENABLE_CATALOG_RECORDS` must equal `true` for record routes. Leave both disabled for integration. Disabled configuration creates no cloud repository or clients. Enabled invalid grant/storage configuration returns a sanitized catalog-only 503 and leaves unrelated API routes available. Order-review draft routes return 423 unconditionally.

A future reviewed configuration must supply `PATHFINDER_CATALOG_CUSTOMER_ACCESS` as an array of `{customer:{id,name,source:"standard-v1"},readers:[verifiedUid],editors:[verifiedUid]}` and an explicit table, bucket and prefix. No email matching or implicit grant exists. Reader grants cannot write. Every request checks authenticated actor and customer scope before storage; browser visibility is not authorization. `catalogAvailable` is a default-off presentation helper for eventual parent integration, not an App change in this patch.

Existing permanent role permissions cover catalog-record manifests/blobs only, not order-review draft storage. Inspect exact IAM resources and integration release configuration separately. Do not use a temporary validation identity as a pilot grant.

## Main App navigation integration

Mount `AuthenticatedCatalogWorkspace` keyed by both customer ID and authenticated operator identity. Register its controller using `onNavigationController(customerId, controller)`. Return a cleanup closure that clears the parent's registration only if the current stored controller is that exact instance. Ignore stale customer/operator callbacks. `snapshot()` is synchronous, including busy state set before asynchronous transport.

- Block navigation while `busy` is true.
- Use the existing App leave prompt for ordinary `dirty` edits; call `discardUnsaved()` only after explicit discard. A false result means do not discard or navigate that way.
- Permit navigation when `busy=false` and `dirty=false`, even if `unconfirmed=true`. Do not call discard in this case. Unconfirmed local journals survive leaving and reopening.
- Never erase journals, call a write, or automatically retry during navigation, remount, or opening status. The parent App guard remains Development's integration task.

A lost response records an unconfirmed operation in local storage. Reload restores it; status checks are read-only. The UI exposes last checked information and an attempted-changes download. A same-key retry requires an explicit user action after a successful status check; failed checks keep retry disabled. Different customers/operators have separate journals. Storage denial fails before transport rather than silently losing recovery evidence. The journal is browser recovery state, not a substitute for server storage or backup.

## Storage and capacity

Records use immutable hashed blobs with conditional manifest updates. Actor-bound request IDs preserve exact replay, reject changed bodies and stale revisions, and prevent duplicate imports/saves. A manifest has a 350,000-byte application cap. The focused capacity test starts near that cap and verifies an oversized write leaves committed revision, history and existing receipts unchanged; an unpublished blob can remain but is never referenced by a committed manifest. Plan bounded history/indexing before broad rollout; current headroom is not indefinite scalability.

## Validation and remaining gates

Full workspace tests/typecheck and web builds passed before the final callback signature change. Focused client/navigation tests, web typecheck, generic catalog review build and dependency scans were rerun after that change. API focused tests also cover permissions, invalid-config isolation, persistence/replay/conflict, artwork denial and capacity. Exact logs and hashes travel in the private handoff rather than public customer evidence.

`tests/catalog-auth-review` is loopback-only with synthetic data and in-memory storage; never deploy its fake auth. Run with `node --import tsx/esm node_modules/vite/bin/vite.js --config tests/catalog-auth-review/vite.config.ts`. The privacy verifier bundles actual UI/API entrypoints, records all first-party inputs, rejects private modules, and accepts private canaries from an external JSON file without emitting them. Scan built assets as well as source.

Still required: parent App wiring after Proof changes, combined navigation/auth regression and UX review, exact deployed revision verification, independently verified customer identity/fresh source migration, named pilot users and capabilities, and an explicit activation decision. Prior isolated cloud validation is useful baseline evidence, not evidence that this new generic revision is already deployed.

Rollback is to retain default-off gates and revert only this integration patch if necessary. Do not delete catalog storage, versions or receipts. No database migration or production mutation is included.

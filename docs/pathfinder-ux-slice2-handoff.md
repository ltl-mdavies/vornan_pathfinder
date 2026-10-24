# Pathfinder UX Slice 2 — internal Proof queues

## Candidate and authority

- Base: accepted local Slice 1 `facfa49de6cce34832547c2f871f4712bcb4a9e0` on `codex/pathfinder-ux-shell`.
- Worktree: `/private/tmp/pathfinder-ux-shell`.
- Preview: `http://127.0.0.1:5210`, **synthetic data only**, actual Admin App.
- Scope authorized through Marcus's “Proceed please” in Pathfinder UX, coordinated with Development. Development owns edits and release preparation; UX independently reviews.
- Local only. No push, merge, deployment, live settings or provider actions authorized by this checkpoint.
- Status: **accepted for local UX review**, no blocking findings in the reviewed scope. This is not deployment approval.

## Included

- Shared global/customer Proof queues, compact typography and controls inside the accepted shell.
- Order/customer grouping (customer scope always groups by order), collapse, search, customer/state filters, adaptive local pagination that budgets for group headers and mixed statuses.
- Cache cursor loading remains distinct from local display pages. Loaded counts never imply a complete Lift inventory. Mixed lines can count in multiple state filters.
- Unknown counts before success, first-load error/retry, 403/404 explanations, last-success rows/time retained after refresh failure, per-line stale snapshots and null timestamps.
- Queue stays mounted when its order tools open. Back restores grouping/search/page/collapse state and meaningful row focus. Explicit global rail navigation clears a selected customer order; Dashboard's deliberate open-order path remains intact.
- Existing global tools behind a compact disclosure. Customer tools offer cached order lookup even with an empty queue. Opening internal tools does not create customer grants or contact Lift.
- Synthetic harness includes populated, partial, slow, empty, error, stale and restricted states; all provider mutations remain blocked.

## Safety correction beyond styling

`ProofOpsPanel` already checked `expectedCustomerId` on cached inspection, but its sync handler did not require that same ownership. Scoped sync now requires a cached order matching both expected customer and entered order number before POST. Cross-customer discovered-order opening is rejected, and the LTL discovery panel is hidden for a different expected customer.

This is an additional frontend guard, not a replacement for server authorization. No backend capabilities, allowlists, activation windows or permissions are changed. Global uncached order synchronization remains in the existing globally scoped tools. Customer lookup explicitly explains that path. Existing approval, revised-art, grant, publication, audit and email handlers are retained.

## Protected boundaries

- No edits to public Proof custom PDF controls, public Order Status, API routes/contracts, intake/reconciliation/comment-back, JSON webhooks, workers, domain packages, infrastructure, runtime flags, dependencies or lockfile.
- No Catalog inner workflow or import/product mapping redesign in this slice.
- Do not deploy this worktree's synthetic harness; normal Admin build excludes it.
- Preserve ongoing production changes through fresh-main reconciliation at any future release checkpoint; never overwrite entire old files onto newer production work.

## Verification and remaining checks

Final complete regression run: **1316 passing** (API800, public Proof76, Status17, Admin183, other packages240), workspace typecheck and Admin production build passed after all corrections. `git diff --check` is clean. Build retains the existing large-chunk warning.

Logs: `/private/tmp/pathfinder-ux-proof-final-tests.log`, `/private/tmp/pathfinder-ux-proof-final-check.log`, `/private/tmp/pathfinder-ux-proof-final-build.log`. Keyboard refinements preserve focus after Retry/final load-more/filter reset. Collapsing global tools preserves the mounted panel and entered fields. A true empty cache no longer shows an inert reset action.

Development browser evidence lives in ignored `tests/ux/evidence/proof-*.png`. It includes 1366×768 global/customer queues, 1600×900 and1920×1080, grouped pagination, filtered empty recovery, stale/first-error/restricted views, customer switching and mismatched lookup rejection. Back from global grouped page2 restored both grouping/page and exact originating button focus. Customer footer fits below713px with long-name fixture after the density correction.

No native200% browser zoom or exhaustive screen-reader certification claimed. Arbitrary long content may wrap and use the workspace scroller; critical product names are not truncated. Cache contents are not a full order inventory. Synthetic review proves frontend behavior, not live provider state.

Independent UX acceptance: `http://127.0.0.1:5211/`, with24 inspected screenshots and seven review steps. Evidence under `/private/tmp/pathfinder-ux-proof-review`: `results.json`, `measurements.json`, `behavior-checks.json`, `candidate-snapshot.json`. All7 reviewed source/fixture SHA256 hashes matched the final worktree before commit. Delayed customer switching, gated tab order, restricted/disabled states, drafts, keyboard return/recovery, and larger desktop views passed. The internal `ProofOpsPanel` remains the existing legacy workflow within the shared shell; its inner UI is not claimed redesigned.

## Later release gate

Only after explicit deployment approval: fresh main/source/live baseline reconciliation, exact diff review, full regression run, affected-route smoke test, Admin-only release unless separately approved, production read-only verification, and documented rollback. Development remains release owner. Catalog is the next separate UX checkpoint.

# Local sprint slices

## Slice 2: read-only Exceptions stack

Adds a customer-partitioned, bounded, cursor-based ledger query, safe exception
projection, and authenticated API route plus a customer navigation view. The view
includes pre-job failures and confirmed orders needing success feedback. Counts
are explicitly page-local; empty pages retain their next cursor. Customer changes
cancel outstanding requests and reset all displayed data. The component uses the
existing authenticated API client, not a new token or transport mechanism.

The API requires `PATHFINDER_ENABLE_INTAKE_EXCEPTIONS=true` and membership in
`PATHFINDER_INTAKE_EXCEPTIONS_CUSTOMER_IDS` (comma-separated). Navigation also
requires `VITE_ENABLE_INTAKE_EXCEPTIONS=true`. All values remain unset/default-off.
The route lives behind existing Pathfinder admin authentication, not public Status
access. It does not fetch Lift customer data, discover Wrike tasks, or mutate records.

Queries use the existing optional intake table with a consistent tenant partition
query, max 100 records per page; no new index or scan. Cursors validate tenant and
shape, but are pagination markers rather than authorization credentials. Pages are
not a point-in-time snapshot under concurrent updates; the view deduplicates IDs.
Local JSON enumeration remains development-only. No infrastructure migration runs.

Validation: 937 workspace tests; 16 browser regressions including new empty-page,
customer-switch and API-failure coverage; 126 deployment-contract tests; all
workspace typechecks/builds and diff whitespace validation. All passed using
synthetic inputs. No external delivery or production smoke tests.

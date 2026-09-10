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

## Slice 3: Wrike assurance and follow-up planning

Consumes the existing scoped discovery result to select exact verified-status
intent candidates, including pending prequalification failures. It does not depend
on mentions or mutable observation timestamps. Capture is a dependency-injected,
bounded, default-disabled seam that reserves the existing intake ledger before
any downstream preparation; it is not wired into the production scheduler.
Missing contract reasons remain internally owned because the existing discovery
code combines bad customer data with missing Import Method configuration. Customer
corrective text cannot safely be inferred from that combined reason alone.

The read-only outcome projector matches the exact customer, connection, task and
Import Method to existing job records. It requires one job and at most one actual
transport attempt; multiple jobs/attempts go to manual review. It recognizes direct
accepted live submissions or the existing strict reconciled association history,
preserves EXT_ID identity, and never issues a provider lookup or create-order call.
Uncertain submits remain reconciling. Duplicate EXT_ID and order-name errors remain
internally owned. Confirmed orders without a posted success writeback produce a
repair plan referencing the existing writeback machinery. Prepared/uncertain
writebacks and explicit operator suppression require review rather than automatic
reposting. These are projections/plans, not new authoritative transport records.

Customer-safe correction drafts cover all six approved corrective categories and
are unavailable after transport or confirmation. Internal drafts use the existing
transactional email type, system category and fixed `pathfinder@vornan.co` recipient.
The bounded watchdog produces review plans and stable per-revision deduplication
keys; it has no timers, deliveries, mutation worker or blind retries. The existing
scheduled telemetry module now has a pure source-neutral count builder with no
provider content or cursor data. It is not emitted by a production worker yet.

Storage validation rejects malformed persisted records rather than dropping them
from query results. Local corrupt reservations fail without overwriting the file;
Dynamo query/get failures surface through the Exceptions API as unavailable.

Validation: final full suite 946 workspace tests; 16 browser regressions and 126
deployment-contract tests; all-workspace check/build; API Lambda packaging and
whitespace validation passed. All delivery functions remain absent/unwired.

### Reconciliation required before scheduler wiring

The project brief specifies `Sent to Print – LTL` (en dash); the existing adapter
fallback at `packages/wrike-adapter/src/index.ts` uses `Sent to Print - LTL`
(hyphen). The actual live saved configuration was not queried. Do not normalize
these labels or change a live default to silently resolve the difference. The
new selector requires the configured label to equal an explicitly approved label
and its status ID to match the one verified by existing discovery. User input was
requested; scheduler integration waits for that boundary to be resolved.

### Next bounded slice

Once the exact label is resolved, wire default-off capture after scoped discovery
and before evidence/preparation filters, then persist observed outcomes with
revision-checked recovery from existing ledgers. Settle multiple-workbook identity,
existing-job backfill, corrected-evidence recovery and terminal-intent re-entry
before activating capture. Provisioning, SLA values, a durable delivery outbox or
receipt integration, scheduled watchdog execution, dispatch and success-link repair
all remain later work requiring validated default-off slices and explicit approval
before production activation. Draft deduplication keys alone are not delivery
receipts or exactly-once guarantees.

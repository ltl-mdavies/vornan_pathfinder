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

### Historical reconciliation (resolved in slice 4)

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

## Slice 4: resolved status-label compatibility

The user approved accepting both `Sent to Print - LTL` and `Sent to Print – LTL`,
with the hyphenated form as the default. The earlier label blocker is resolved.
A shared narrow normalizer extends existing case/whitespace comparison only for
these two labels. Discovery workflow verification and immediate pre-submit checks
use it while preserving exact saved status-ID and task-status checks. Even if a
workflow contains both labels under different IDs, only the configured ID qualifies.
Assurance identity always uses `Sent to Print - LTL`, avoiding duplicate attempts
when the display dash changes. Other labels and em dashes are not aliases.

All 948 workspace tests, 16 browser regressions, 126 deployment-contract tests,
and all-workspace check/build passed. No live configuration or default changed;
the compatibility code is local and has not been deployed.

## Slice 5: default-off scheduled capture and outcome observation

A separate scoped gate now connects assurance to the existing scheduled Wrike
pipeline. Capture runs after metadata discovery/credential preservation and before
confirmed-task filtering or workbook preparation, including pending metadata
prequalification failures. The preparation wrapper records safe internal failure
before returning the original error; raw parser details are not persisted.
The disabled wrapper returns the original preparation callback unchanged.

After existing submit/reconciliation/writeback stages, the cycle reads the existing
scoped store snapshot and projects job, transport and feedback outcomes into the
intake ledger using guarded, revision-checked transitions. It does not add a Lift
call or change existing submission, reconciliation, or writeback rules. Verified
unmapped-product jobs may become customer-owned only before transport. Confirmed
orders without success feedback retain their order association and become internal
action required. Later posted success feedback closes the same attempt.
Ambiguous/changed identities stay internally owned without replacing linked IDs.
Terminal withdrawn/superseded attempts do not restart automatically.

Repeated unchanged observations create no event and do not reset the SLA deadline.
Late work may retain an already-overdue deadline; it cannot manufacture a new past
deadline. Confirmation followed by missing feedback starts a new explicit follow-up
deadline. These are observational state updates, never a second preparation or
submission workflow.

All of the following must be deliberately configured to enable capture:

- `PATHFINDER_ENABLE_INTAKE_ASSURANCE_CAPTURE=true` (unset is disabled).
- `PATHFINDER_INTAKE_ASSURANCE_CUSTOMER_ID` and
  `PATHFINDER_INTAKE_ASSURANCE_IMPORT_METHOD_ID` exactly match the active scheduler.
- `PATHFINDER_INTAKE_ASSURANCE_SLA_SECONDS`: explicit integer, 60–604800.
- `PATHFINDER_INTAKE_ASSURANCE_MAX_CANDIDATES`: explicit integer, 1–1000.
- Existing intake persistence configured; Dynamo requires the optional intake table.

None are enabled or provisioned by this slice. Existing scheduler, preparation,
Lift submission and writeback gates retain authority. The assurance flag alone
cannot activate a disabled scheduler, as tested through the real server entrypoint.
Invalid enabled scope or limits fail before provider discovery. Discovery exceeding
the capture limit fails visibly rather than silently dropping excess intents.

Remaining before production activation: durable infrastructure/IAM and rollout
review, multi-workbook and legacy-backfill QA, and an independent bounded ledger
sweep that follows requests after they disappear from current Wrike discovery.
This cycle observes current captured discovery only; it does not replace the
existing uncertain-submit recovery queue. A task's later reconciliation may need
that independent sweep to refresh its assurance record. Feedback/notification
receipts, dispatch, automatic link repair and scheduled watchdog execution remain
unimplemented and disabled. Drafts/plans are not delivery guarantees.

Slice 5 validation: 956 workspace tests passed across the matrix (487 API tests
passed with serial file execution after intermittent concurrent Proof fixture
socket resets; 469 other workspace tests passed normally). Typecheck/build, 16
browser regressions, 126 deployment-contract tests and API/Proof packaging passed.
See the integration ledger for the exact validation sequence.

## Slice 6: independent durable recovery sweep

The standalone Lambda event (`source: pathfinder.intake`, `detail-type: Intake
Assurance Sweep`, `detail.automation: observe_durable_outcomes`) now observes
persisted intake requests independently of current discovery. Event payloads do
not select the customer or operating limits. Runtime scope comes from explicit
configuration. No schedule, infrastructure, flag enablement or delivery is added.

Required settings when `PATHFINDER_ENABLE_INTAKE_ASSURANCE_SWEEP=true`:

- Shared assurance customer, Import Method and SLA settings from slice 5.
- `PATHFINDER_INTAKE_ASSURANCE_CONNECTION_ID`: explicit connection.
- `PATHFINDER_INTAKE_SWEEP_PAGE_SIZE`: 1–100 attempts.
- `PATHFINDER_INTAKE_SWEEP_MAX_PAGES`: 1–10 pages per invocation.
- `PATHFINDER_INTAKE_SWEEP_LEASE_SECONDS`: 30–900 seconds.
- `PATHFINDER_INTAKE_SWEEP_SNAPSHOT_LIMIT`: 1–10000 records per existing
  customer job/submit partition. Overflow fails without advancing the current
  page; operators must choose a reviewed bound appropriate to the customer.

Each scope has a durable revision, cursor, pass count and leased owner token.
Dynamo checkpoints occupy `intake-sweep#<customer>` in the existing intake table;
validated Exceptions queries cannot address that reserved partition. Conditional
acquisition and renewal protect ownership. Every intake mutation combines lease
ownership and intake revision checks in one Dynamo transaction. Local development
uses the existing serialized JSON mutation queue; distributed concurrency requires
Dynamo, not multiple processes writing the same local JSON file.

Progress commits after a complete page. Failure retains the last committed cursor;
expiry allows another invocation to retry. Already-applied observations are
idempotent and keep the existing deadline. Completing a pass resets the cursor so
new requests inserted before it are considered on the next pass. Empty/filtered
pages retain their cursor. Snapshot reads use consistent tenant queries, at most
100 items per query and at most snapshot-limit-plus-one pages per partition;
repeated cursors, corrupt rows and excess records fail closed. Snapshots are not
cross-table transactions: newer intake rows wait for a later snapshot, and strict
existing association checks remain authoritative. No observation initiates a
provider request, preparation, submission, link repair or notification.

The sweep can adopt an existing job or later confirmed outcome after a source
leaves discovery. Terminal withdrawals/supersessions and confirmed requests with
recorded feedback are skipped. Multiple jobs/transports retain conservative manual
review. Repeated unresolved observations preserve age and deadline. A confirmed
order missing feedback follows the existing explicit follow-up deadline policy.
Completion/failure logs contain aggregate counts and fixed categories only.

Before activation: validate the single approved customer/connection/Import Method
scope, table and transaction/condition-check IAM permissions, production-sized
bounds and duration, schedule/retry/lease settings, multi-workbook identities and
legacy backfill. Feedback/notification delivery receipts and dispatch remain the
next separate slice; no exactly-once delivery claim is made here.

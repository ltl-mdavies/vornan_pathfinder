# Intake Assurance foundation

This records the original foundation PR boundary. Subsequent local, default-off
work is tracked in `sprint-slices.md` and `integration-ledger.md`.

## Slice 1 boundary

Provider-neutral, default-dark domain and durable pre-job ledger. No server route,
UI, scheduler hook, new infrastructure, deployment, submission, feedback delivery,
or email invocation. The exported frozen posture has all four capabilities false;
there is deliberately no environment switch that can activate this slice.
`reserveThenPrepare` is a dependency-injected seam exercised only by synthetic tests.

The objective is eventual coverage of every observed intent, including invalid
requests that cannot create a job. This PR alone does **not** provide production
coverage or an operating watchdog. Current live behavior remains the baseline.

## Architecture audit and reuse

- `server.ts::runConfiguredWrikeIntakeCore` and `wrike-scheduled-intake.ts` already
  implement scoped polling, evidence preparation, bounded candidates and reuse.
  Scheduled discovery does not depend on mentions. Later capture must occur as
  soon as the exact **Sent to Print – LTL** intent is observed, before order-grid,
  contract or required-data validation can discard the candidate. Reusing only
  the final prequalified candidates would miss the failures this project targets.
- `store.ts::reserveSubmitAttempt` conditionally persists transport identity before
  submission. Intake records reference this ledger; they never replace its key,
  request fingerprint, EXT_ID, route, company, profile, or transport response.
- `server.ts::reconcileScheduledWrikeUncertainJob` uses the strict EXT_ID selector
  and full identity verification in `wrike-scheduled-reconciliation.ts`, then
  `associateJobWithLiftOrder`. Its recovery queue revisits uncertain jobs even
  when absent from discovery. No new create-order path is needed or permitted.
- `prepareWrikeStatusWriteback`, `finalizeWrikeStatusWriteback`, and the scheduled
  success writeback path remain authoritative. The recent scoped-job cache fix
  makes reconciled orders available for same-cycle feedback; preserve it.
- `email.ts` supplies transactional SES delivery. A later internal adapter must
  use its `system` category and initially address `pathfinder@vornan.co`. This PR
  imports only email types and does not call the service.
- `wrike-scheduled-telemetry.ts` and `wrike-scheduled-health.ts` remain the
  operational reporting paths. Later slices add intake counts and watchdog
  findings to these paths, without replacing their existing fields or alarms.

## Exact data model

`IntakeSignal` schema 1 contains customer, provider, connection, source ID, intent
key, intent occurrence and observed timestamp. It contains no workbook payload,
email address, credentials or raw provider exception. An occurrence is a stable
source event/revision or an adapter-controlled initial occurrence, not a poll
 timestamp. A new attachment is evidence, not automatically a new submission.

`attempt_id` is `intake_` plus SHA-256 of the JSON tuple of the six identity fields.
Observation time is excluded. All identity fields must be nonempty and trimmed.
Tuple encoding prevents delimiter collisions and scopes identity to tenant and
connection. Corrected evidence normally resumes the existing pre-submit attempt;
a deliberately new request gets a new occurrence. Wrike re-entry semantics and
legacy-job backfill must be settled and tested in the adapter slice before capture.

`IntakeAttempt` holds the signal, revision, state, owner, safe reason, creation and
update times, next-action deadline, and immutable references to job, submit attempt
and confirmed order. It also holds the success writeback ID, superseding attempt
ID and last applied event. `IntakeEvent` carries an event ID, expected revision,
time, next state, safe reason, associations and next-action deadline.

The stored record is a current-state ledger with its last transition, not an
unbounded embedded event log. Exact last-event replay is a no-op; stale events fail
revision checks. Historical event retention/export is a later observability slice.
No automatic expiration: unresolved work must not disappear through TTL.

Local storage extends the existing Pathfinder JSON store with optional
`intake_attempts`; old stores are valid and unrelated fields are preserved. Local
mutations are serialized for this ledger and bypass stale read scopes. As with
existing local submit reservation, this is for single-process development, not
multi-process production concurrency or concurrent independent legacy writers.

DynamoDB uses the existing client, item encoding and persistence-driver selection,
with optional `PATHFINDER_INTAKE_ATTEMPTS_TABLE` (partition key `customer_id` string,
sort key `attempt_id` string; numeric `revision`; string `state`; serialized `data`).
The variable is read only when explicitly calling intake persistence. No table is
provisioned in this slice. Intake needs a distinct entity table because legacy
submit-attempt scans require a transport response and cannot safely ingest
pre-job failures. Existing submit/writeback tables and contracts are unchanged.

Reservation uses conditional create; collisions read consistently and verify
identity. Transitions consistently read then condition on the current revision.
Storage failures propagate; no evidence work runs without acknowledged reservation.
A crash after reservation or preparation leaves a durable unresolved record and
original deadline. Duplicate discovery does not automatically repeat preparation;
a later watchdog must inspect durable evidence/job identity before recovery.
A lost write acknowledgment similarly requires a read before retry.

## Lifecycle, ownership and safe failure rules

Normal path: received → preparing → ready → reconciling → confirmed. Ready requires
a durable job. Reconciling requires an existing submit-attempt reference.
Confirmation requires job, submit attempt and verified order association. The
adapter must obtain that association from the existing strict reconciliation
contract; passing an arbitrary order number is not an authorized verification path.

Customer action covers missing/invalid/ambiguous grids, contract mismatch, missing
required data and unmapped products. Adapters may throw `IntakePreparationError`
with a validated safe code. Unknown errors become internal Pathfinder failures;
raw messages are never persisted or transformed into customer comments.

Internal action covers submission timeouts, duplicate EXT_ID/order name, Lift or
Pathfinder failures, reconciliation ambiguity and missing/failed success feedback.
Manual review is internally owned. Once a submit reference exists, the core blocks
preparation, customer correction, withdrawal and supersession; reconciliation or
internal review must resolve transport uncertainty without blind resubmission.
Confirmed order identity cannot be changed. A feedback failure retains confirmation
while assigning internal action, and successful repair returns to confirmed.

Withdrawal and supersession are terminal before transport; supersession requires
a different attempt ID. The future coordinator must verify that referenced
attempt exists and belongs to the same customer before committing supersession.
All unresolved states require a deadline. Confirmed/withdrawn/superseded states
have no deadline. Clock regression, unsafe transitions and changed event replays
fail closed. Remediation must never reset age merely because a poll repeats.

## SLA, visibility and delivery seams

This slice accepts explicit next-action timestamps without inventing production SLA
values. `intakeWatchdog` is a pure projection of overdue work and confirmed orders
missing a success writeback reference; it never sends or repairs anything.
The future worker requires bounded paginated tenant queries, oldest-deadline
selection, leases, retry/backoff policy and durable dispatch receipts before enablement.
A Wrike adapter must inspect the existing success writeback ledger and actual
Status-link evidence; a generic comment ID alone is not proof of a Status link.

Effect keys are deterministic for attempt revision and effect type. Delivery
interfaces accept these keys; they do not promise exactly-once delivery. Later
implementations must reserve in the existing writeback ledger or a durable internal
notification receipt, reconcile uncertain deliveries, and suppress duplicate
comments/alerts. Repeated watchdog reads of an unchanged revision share one key.
Customer wording must come from approved safe templates, never exception text.

The provider-neutral Intake Exceptions view will project attempt state, owner,
reason, source, age/deadline and linked job/transport/writeback references. It must
include attempts with no job and confirmed orders whose source feedback needs
repair. No view or listing endpoint is added by this foundation PR.

## Sequential delivery and activation

1. This foundation: model, local/Dynamo persistence and synthetic contract tests.
2. Wrike capture before parsing, exact status resolution, legacy mapping, safe
   classification and read-only exception projection behind new default-off gates.
3. Strict existing transport/reconciliation and missing Status-link recovery
   coordination, durable feedback/notification deduplication and watchdog queries.
4. Provider-neutral Exceptions UI, operational SLA configuration and bounded QA.

Before each slice and each PR/deployment: fetch main, inspect all intervening
commits, integrate without reverting newer behavior, rerun the complete relevant
regression matrix and update `integration-ledger.md`. Stop if intent conflicts.
Deployment and enabling production capture/delivery require explicit approval;
no customer communication, SES message or Lift submit is part of development QA.

## Recovery implementation update (slice 6)

The independent observation worker and leased durable cursor now exist behind
`PATHFINDER_ENABLE_INTAKE_ASSURANCE_SWEEP` (default off). It reads bounded tenant
partitions from the existing intake, job and submit ledgers and applies existing
strict outcome projections without using current Wrike discovery. Dynamo updates
atomically check both lease ownership and intake revision; incomplete pages replay
from the last committed cursor. Local JSON remains a single-process development
backend. See `sprint-slices.md` for explicit configuration bounds and activation
prerequisites. Notification/customer feedback dispatch, durable delivery receipts,
backoff and success-link repair are still future work. No schedule is provisioned.

## Delivery implementation update (slices 7–8)

Durable per-channel delivery receipts and a guarded dispatcher now exist. Claims
check intake/receipt revisions and scheduled lease ownership before transport;
uncertain or acknowledged sends cannot automatically rearm. A default-off internal
notification event uses a separate cursor and bounded, single-attempt SES dispatch
to the fixed internal recipient. Customer-feedback transport is still injected
only, and successful-order Status-link repair retains its existing ledger. See
`sprint-slices.md` for the conservative one-message-per-channel policy, receipt
uncertainty limitations and activation prerequisites. Nothing has been enabled.

## Visibility and Wrike feedback update (slices 9–10)

The gated Exceptions view now includes independent read-only delivery receipts,
so uncertain sends remain visible after intake resolution. The Wrike correction
adapter has a separate default-off gate, scoped saved configuration, bounded
requests and durable preflight/claim checks. Only existing unmapped-product jobs
currently qualify; all other correction templates await stronger evidence checks.
No new capability has been activated. See `sprint-slices.md` for rollout limits,
source-freshness caveats and recommended remaining work.

## Reconciliation, freshness and repair update (slices 11–13)

Authorized operator attestations now reconcile uncertain delivery with an atomic,
immutable audit and no automatic rearming. Feedback verifies exact current workbook
identity and source timestamps; legacy/multiple-workbook cases remain review-only.
A separate default-off status-link repair worker reuses the existing writeback
ledger and refuses previously prepared/failed/uncertain records. The engineering
review and remaining rollout approvals are recorded in `review-and-rollout.md`.
No production capability has been activated.

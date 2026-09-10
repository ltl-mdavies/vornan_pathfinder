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

## Slice 7: durable delivery receipts

New source-feedback and internal-notification receipts use a reserved
`intake-delivery#<customer>` partition in the intake table, or the serialized local
JSON development store. These receipts are separate from existing successful-order
Status-link writebacks, which retain their own ledger and transport rules.
Receipts store a hash of the approved payload and its intake revision, not message
bodies. Preparation and dispatch claims atomically check the current intake
revision and receipt revision. Claiming writes `uncertain` before any possible
provider call; only a provider message/comment identifier permits `sent`.

One automatic delivery is allowed per channel per intake lifetime in this initial
policy. Sent or uncertain slots cannot rearm on later revisions. Before dispatch,
stale drafts can cancel or refresh against the current intake revision. This
conservative policy prevents notification loops and repeated customer comments;
repeat follow-ups, delivery-uncertainty reconciliation and operator-authorized
retries require later policy and tooling. This is not an exactly-once delivery
promise. A crash after claim but before sending can leave an unsent uncertain
receipt requiring review. This slice adds no dispatcher, runtime gate or sends.

## Slice 8: guarded dispatch and default-off internal notifications

The dispatcher regenerates approved payloads from the intake ledger, prepares the
receipt, rereads the intake, then atomically claims the exact intake/receipt
revision before invoking transport. Scheduled notification claims also check the
sweep lease in that transaction. A stale revision, lost lease, unavailable store
or exhausted send budget prevents dispatch. Provider timeout, missing message ID,
or failed acknowledgement persistence leaves `uncertain`; automatic replay is
suppressed. `sent` means provider acknowledgement, not proof of mailbox delivery.
An already-in-flight request cannot be cancelled by later intake state changes.

The Lambda event is `source: pathfinder.intake`, `detail-type: Intake Assurance
Notifications`, `detail.automation: notify_internal`. Event content cannot choose
a tenant, recipient or message. A separate gate
`PATHFINDER_ENABLE_INTAKE_INTERNAL_NOTIFICATIONS=true` requires the existing explicit
assurance customer/connection/Import Method/SLA and sweep page/max-page/lease
settings, plus `PATHFINDER_INTAKE_NOTIFICATION_MAX_SENDS` (1–100). The independent
notification cursor uses the `internal_notification` purpose; recovery's existing
cursor identity is unchanged. This worker reads persisted intake state only; job
and submit reconciliation remains the observation worker's responsibility.

SES mode is mandatory before any receipt mutation. Log mode cannot count as
successful delivery. Messages use the safe system template and fixed recipient
`pathfinder@vornan.co`. The email helper accepts an opt-in single-attempt SES client
for this path, avoiding invisible SDK retries; other email callers keep their
existing client and behavior. The send cap counts transport invocations, including
uncertain outcomes. Deferred items remain eligible on later passes. Same-channel
sent/uncertain receipts suppress further automatic sends across all later intake
revisions under the conservative slice-7 policy.

Source-feedback dispatch is available only through an injected callback and safe
Wrike correction payload, with no production Wrike sender or customer-feedback
runtime flag wired. Existing successful-order Status-link writebacks keep their
own ledger and adapter. No new worker performs Lift submission or automatic link
repair. Next work is operator visibility/reconciliation for uncertain deliveries,
the customer-feedback adapter and carefully reviewed repeat-follow-up policy.
Activation still requires explicit approval, production IAM/SES and scope review,
SLA/cap/lease/schedule choices, and synthetic-to-production rollout validation.

## Slice 9: operator receipt visibility

The existing authenticated, customer-allowlisted Exceptions gate now also covers
`GET /api/customers/:customerId/intake-deliveries`. It enumerates the separate
receipt partition in bounded, tenant-bound pages. Receipts remain visible even
when their intake request is resolved. The read-only UI shows channel, attempt,
provider acknowledgement reference and uncertainty. Message bodies, payload hashes
and credentials are not exposed. Uncertain delivery explicitly requires provider
review before retry; no retry, rearm or manual acknowledgement control is added.
Pagination and loading/errors are independent of the unresolved-intake table.

## Slice 10: default-off Wrike customer-feedback adapter

A separate `PATHFINDER_ENABLE_WRIKE_INTAKE_FEEDBACK=true` gate controls the Lambda
event `source: pathfinder.intake`, `detail-type: Wrike Intake Feedback`,
`detail.automation: customer_correction`. Event payloads cannot select the tenant,
connection, task or message. Explicit shared scope/SLA/sweep settings are required,
including the snapshot record limit, plus `PATHFINDER_INTAKE_FEEDBACK_MAX_COMMENTS`
(1–50 per invocation). The `source_feedback` cursor is separate from recovery and
internal notifications. No schedule or flag is provisioned/enabled here.

Only `unmapped_product` corrections currently have the required durable job
evidence. The adapter requires exactly one matching task/connection job in the
approved Import Method, the same linked job, `Needs Mapping` classification, no
order and no submit history at all (including blocked transports). Other safe
wording templates remain blocked pending equivalent source-evidence validation.
The saved Import Method and connection must both be active, the saved scope must
match, and the status label must be one of the approved hyphen/en-dash variants.
Focused consistent Dynamo reads replace any workspace creation or tenant scan.

Before a claim, the adapter verifies the exact current task/status via the existing
Wrike workflow/task checker and persists rotated credentials. Durable job/submit
evidence is checked again after verification and after the claim. The receipt
claim remains conditional on intake/receipt revisions and the worker lease. The
existing Wrike comment adapter makes one POST without automatic retries; individual
provider requests are bounded to 15 seconds. Rotated credentials are preserved on
success and reported failure. Missing acknowledgement or persistence failure
leaves a visible uncertain receipt and blocks automatic replay. A post-claim
preflight failure can likewise leave an unsent uncertain receipt for review.

This is not an atomic transaction across Wrike, the job ledger and delivery.
Changes after the final checks cannot cancel an in-flight comment. Source edits
not yet reflected in the current job require freshness/multi-workbook QA before
activation. The adapter does not classify new raw workbooks, retry an order,
resubmit to Lift, repair success links or rearm a sent/uncertain channel.
One automatic correction per channel/intake remains the conservative policy.

### Suggested next steps after slices 9–10

1. Add evidence-backed operator reconciliation for uncertain receipts, with audit
   records and explicit authority; do not add a blind resend button.
2. Finish freshness and multi-workbook/backfill validation, then extend customer
   correction categories only where current evidence supports the classification.
3. Integrate success-link repair through its existing writeback ledger and settle
   repeat-follow-up/SLA policy, including how changed failure reasons are escalated.
4. Review the accumulated local changes for a PR. Separately approve infrastructure,
   IAM/SES/Wrike scopes and a bounded staged rollout; start with visibility and
   observation, then internal notifications, then narrowly scoped customer feedback.

## Slice 11: audited operator delivery reconciliation

A separately gated POST endpoint at
`/api/customers/:customerId/intake-deliveries/:attemptId/:kind/reconcile` accepts
an operator attestation: `provider_acknowledged` with provider ID, or
`confirmed_not_delivered`. Both require an evidence reference, event ID and exact
receipt revision. Authority comes exclusively from the authenticated UID and
explicit operator/customer allowlists, never request-body identity. The flags are
`PATHFINDER_ENABLE_INTAKE_DELIVERY_REVIEW`,
`PATHFINDER_INTAKE_DELIVERY_REVIEW_CUSTOMER_IDS`, and
`PATHFINDER_INTAKE_DELIVERY_REVIEW_OPERATOR_UIDS`; all are unset by default.

Receipt and audit persist in the same conditional write. The audit records the
operator, timestamp, evidence reference and request digest. Exact request replay
is idempotent; changed replays and competing reviews conflict. Confirmed
non-delivery closes the receipt as `closed_without_delivery`; it never rearms
sending. The read-only table shows review evidence and the closed outcome.
This endpoint records human-verified provider evidence; it does not independently
query SES or Wrike to prove delivery. No reconciliation or retry was performed on
real records during implementation.

## Slice 12: source freshness and legacy/multi-workbook boundaries

Feedback now requires exact current attachment and version identity, valid captured
evidence identity/hash, a current task timestamp no newer than the job capture,
and matching workbook metadata no newer than capture. A bounded metadata-only
Wrike read uses existing version normalization without download URLs or workbook
bytes. Partial, oversized, duplicate and malformed metadata listings fail closed.
Metadata is checked before and after the receipt claim. Verification returns the
current task timestamp; missing timestamps suppress customer feedback.

Legacy jobs lacking identity require explicit backfill review; multiple current
workbooks require an identity decision. Neither case is automatically migrated or
messaged. Synthetic coverage verifies changed/removed/added workbooks, changed task
metadata and missing legacy fields. This closes the known old-version feedback
path, but cannot make provider edits and local dispatch an atomic transaction.
Mapping/configuration changes and production metadata completeness still need
scoped rollout QA. Customer wording remains limited to unmapped-product jobs.

## Slice 13: existing-ledger success-link repair

The separate `PATHFINDER_ENABLE_INTAKE_STATUS_REPAIR` gate controls the
`Intake Status Link Repair` event (`source: pathfinder.intake`,
`detail.automation: existing_success_writeback`). It requires explicit shared
scope/snapshot/SLA/sweep bounds, `PATHFINDER_INTAKE_STATUS_REPAIR_MAX` (1–50), and
existing scheduled-writeback permission for the exact customer/Import Method.
Its durable cursor uses `status_link_repair`; no other worker cursor changes.

Only a strictly verified existing order/submit association and a unique matching
job with no prior writeback qualify. Prepared, failed, uncertain, posted and
operator-suppressed records do not start another send. The coordinator calls the
existing success-link writer, which preserves its conditional job/writeback claim.
Optional exact order and connection checks protect the repair call without changing
older callers. Successful repair is observed back into the intake ledger using
lease/revision guards. Lost outcomes remain governed by existing writeback records;
there is no alternate receipt, comment path, Lift submission or blind retry.

The initial repeat-follow-up policy remains one automatic delivery per intake and
channel. Unchanged polling does not reset SLA age. Changed reasons stay visible
but do not rearm sent/uncertain channels; audited non-delivery closure also does
not rearm. Future repeat notifications require a separately reviewed incident or
cadence policy. See `review-and-rollout.md` for the concrete remaining approvals
and implementation limits. No schedule or capability is enabled by this slice.

## Follow-up: aggregate Wrike feedback budgets

Feedback requires explicit maximum provider requests and elapsed milliseconds per
dispatch. A shared monotonic deadline and counter cover OAuth, both current-scope
checks, workbook metadata and the comment. Exhaustion before claim blocks; after
claim it preserves uncertainty with no automatic resend. Safe aggregate telemetry
records request count, elapsed time and exhaustion. Runtime settings have no
defaults and the elapsed limit must be shorter than the sweep lease. Deep ancestry
and elapsed-budget tests supplement the existing scope-change tests. See
`activation-prerequisites.md` for remaining production sizing and infrastructure holds.

## Follow-up: durable Wrike intent observations

A pure status resolver and local/Dynamo CAS store now track qualified ready/exit/
re-entry observations. Continuous-ready edits and polling retain one generation;
only an observed strictly newer exit followed by a strictly newer ready status
advances it. Missing/coarse/regressed timestamps and unverified scope fail closed.
The persisted future intake identity includes every scope dimension and generation
and is stable across retries and restarts. It is an identity proposal, not permission
to create an intake, prepare a job or submit. No live capture path calls it yet.
The shared manual/scheduled integration and post-transport policy remain the next
review boundary. All existing gates and the current capture behavior are unchanged.

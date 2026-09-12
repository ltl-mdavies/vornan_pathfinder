# Intake Assurance activation prerequisites

This dossier records the coordinated Development and Live Support assessments of
merged main `c7e07e8c7f496dae2941cb051366e6c49d9a8930`. It is a source preparation
plan, not deployment or activation approval. No production inventory was read.

## Current Wrike feedback scope correction

Feedback now reuses `discoverApprovedWrikeTask` before receipt claim and again
before comment dispatch. Each call uses the exact intake task and saved method
configuration, with no cached ancestry shortcut. Existing discovery verifies
folder/root ancestry, configured title or custom item type, exact status, vendor
and contract rules. Blocked qualification suppresses feedback. Saved method and
connection status/configuration are reloaded at both boundaries, followed by fresh
status/timestamp and workbook metadata checks. Rotated credentials are preserved.

A change detected after claim leaves the receipt uncertain and never automatically
retries. No local check makes provider edits and a comment atomic. These additional
reads increase preflight time: the direct-root synthetic success fixture uses 15
requests, including the comment. Deep ancestry may require more bounded reads.
Production lease and schedule sizing must include this cost and credential refresh.

Live Support's narrow review of `433d7dd` found no source-merge blocker, but retained
an aggregate provider-budget activation hold. Each of the two discovery passes
can walk up to 32 ancestry folders, in addition to exact-task, status, workbook
and credential reads. The 15-request direct-root fixture is not a general bound.
The current per-request 15-second timeout does not impose an end-to-end deadline.
Before activation, enforce and measure total provider requests and elapsed dispatch
time, including both preflight passes. Budget exhaustion must prevent the comment
(and leave a claimed receipt uncertain). Test deep-ancestry exhaustion and size
leases and schedules against the resulting full-operation bound.

The next source slice implements this budget with explicit
`PATHFINDER_INTAKE_FEEDBACK_MAX_REQUESTS` (1–256) and
`PATHFINDER_INTAKE_FEEDBACK_MAX_ELAPSED_MS` (1–120000). There are no operating
defaults. Enabled runtime configuration requires the elapsed budget to be shorter
than the sweep lease. One monotonic deadline starts before dispatch reads and
spans both discovery passes, OAuth, metadata and the comment. Every provider fetch
counts, including failed requests; the shared deadline aborts in-flight fetches.
Checks before claim/dispatch prevent a late comment even when local persistence
takes time. Local persistence is not cancelled or raced against a timeout.

Pre-claim exhaustion blocks without sending; post-claim exhaustion remains uncertain
and suppressed on replay. Per-dispatch aggregate telemetry reports provider request
count, elapsed milliseconds and request/time exhaustion without task IDs, URLs or
provider error text. Synthetic six-folder ancestry succeeds at exactly 27 requests,
blocks before claim at 10, and becomes uncertain without a comment at 26.
Independent review remains required. Production limits, whole-page lease sizing,
schedule cadence, alarm thresholds and overhead margin still need approved workload
evidence; a per-dispatch limit alone does not bound a multi-attempt sweep's duration.

Live Support reviewed exact source head `e747da1` and confirmed that this closes
the aggregate-budget engineering condition, with no source-merge blocker.
Development also reviewed exact source head `e747da1`, returned source-merge GO
and confirmed the engineering condition closed. Current PR-head CI must pass
before merge. Production sizing and activation holds above remain in force.
No production action accompanied either review.

## Task re-entry: next engineering slice

The shared capture integration replaces the live cycle's fixed `initial` occurrence
when the existing capture gate is enabled; activation remains held.
Neither poll time, task edit time, workbook version/hash nor comment time proves
a new order request. The existing one-task/one-order protection must remain.

Development recommends a prospective provider-specific observation cursor:

- Use a reserved intake-table partition keyed by customer, connection, Import
  Method, task and exact intent status. Store generation, current status membership,
  last exact status, source update time, observation time and current attempt ID.
- Persist cursor changes with CAS. Observe in-scope, identity-matching tasks both
  inside and outside the trigger status; ready-only discovery cannot prove exits.
- First ready observation establishes generation one. Continuous ready polls and
  workbook corrections reuse it. Only a durably observed, strictly newer exit and
  subsequent ready entry can advance the generation, once.
- Missing/regressed/ambiguous timestamps fail closed. Out-of-scope observations
  cannot arm re-entry. A missed exit remains replay, never inferred new intent.
- Only explicitly withdrawn/superseded pre-transport work may automatically start
  a later generation. Any submit, uncertainty, confirmation or sibling job routes
  to manual review without another prepare/submit. Do not withdraw after transport.
- Manual and scheduled capture must share one resolver. A crash between cursor CAS
  and attempt reservation must recover the same deterministic attempt/generation.

Implement and review the pure resolver and durable cursor first, then wire both
capture paths and unfiltered status observations behind the existing disabled gate.
Test races, crash recovery, continuous-ready corrections, missed exits, timestamp
ambiguity, scope isolation, manual/scheduled interchange and all transport postures.
Reusable tasks for multiple orders require an explicit operator-authorized policy.

The observation foundation provides `observeWrikeIntent` plus local and Dynamo
cursor persistence. Its identity includes customer, connection, Import Method,
exact task and exact trigger status. A generation-bound future intake signal/ID is
stored with the cursor. Its shared capture caller now performs the guarded intake
handoff described below before allowing the existing preparation path.
Dynamo uses a reserved `wrike-intent#<customer>` partition with consistent reads and
revision CAS; conflicting writers reread, with four bounded attempts. Local storage
uses the existing serialized intake mutation queue and remains single-process only.
Schema, scope, revision, lifecycle, timestamp and derived-identity corruption fail
closed on reads and mutation. A generation-zero outside observation has no intake ID.

Only explicitly verified scope/identity observations are accepted. Provider scope
verification is an integration prerequisite: these booleans are not a replacement
for current Wrike discovery. The resolver itself performs no provider reads. The
manual and scheduled callers use qualified scoped discovery; manual preparation
performs a bounded metadata discovery restricted to its requested task before
evidence capture, and scheduled discovery also records qualified non-ready tasks.

Both callers use one shared service. Automatic preparation requires generation one
with persisted proof of a qualified non-ready baseline and a strictly newer ready
entry. Initially-ready tasks, subsequent generations, legacy `initial` records,
existing unbound/conflicting jobs, any transport/order/association/writeback history
or incomplete evidence require manual review. No task reuse or legacy migration is
inferred. Manual review remains sticky during automatic outcome reconciliation.

The cursor now stores `entry_proven` and its baseline status/source/observation
timestamps. Pre-integration experimental cursors missing those fields fail closed;
inventory/migration review remains necessary before rollout. A Dynamo transaction
checks the exact cursor data/revision and conditionally puts the deterministic
attempt; local storage performs the equivalent in one serialized mutation. A crash
after cursor commit can recover the same signal; a stale handoff fails and the next
caller re-resolves from durable state. No job or provider transaction is implied.

The existing capture flag controls both entry points. Full history snapshots require
an explicit `PATHFINDER_INTAKE_SWEEP_SNAPSHOT_LIMIT`; there is no operating default.
Enabled capture also requires `PATHFINDER_INTAKE_ASSURANCE_CONNECTION_ID`.
Connection identity and history bounds are validated up front; the saved active
connection must match before lookup/discovery, and capture checks it again before
cursor or intake effects. Changing the method's connection does not extend the
approved capture scope. The guarded discovery core also covers manual batch intake.
Manual metadata read cost, observation/candidate bounds and freshness must be included
in rollout sizing. Shared integration remains subject to independent review, source
validation and production QA. All deployment/activation approvals remain separate.

Live Support's integration review additionally requires aggregate request/time
budgeting and telemetry for manual and scheduled discovery before activation.
Filtering manual discovery to one requested task happens after the bounded upstream
folder scan, so it does not reduce that scan's provider/credential-rotation cost.
The history limit must cover complete retained tenant job/submit partitions or fail
closed. Name an owner for initially-ready/legacy manual-review items and inventory
pre-baseline cursor rows. Table transaction and condition-check IAM remains required.

The discovery-budget source slice now requires explicit
`PATHFINDER_INTAKE_DISCOVERY_MAX_REQUESTS` (1–256) and
`PATHFINDER_INTAKE_DISCOVERY_MAX_ELAPSED_MS` (1–120000) when capture is enabled.
The same provider budget implementation serves feedback and capture discovery.
One counter/deadline covers each complete upstream scan: OAuth, all roots/pages,
workflow/status and custom-field metadata, and any enabled shipping metadata.
Manual filtering occurs only after the full budgeted result is accepted.

The shared helper is used for manual, scheduled and manual-batch capture discovery;
capture-disabled discovery retains its existing path. Returned credential rotations
are persisted on success or adapter error. Credential persistence is not raced or
cancelled; a final budget check prevents accepting a result after that persistence
exceeds the deadline. Partial scans and budget exhaustion never reach cursor capture.
Telemetry contains only mode, attempted provider requests, elapsed milliseconds and
exhaustion category. A shared abort deadline supplements the 15-second fetch timeout.

Independent review and production budget selection remain required. These limits
apply per discovery, not to a whole multi-candidate ingestion run. Existing page/task
ceilings remain 10 pages per root and 10,000 tasks; candidate count and repeated
manual preflight scans must be included in whole-invocation timeout, cadence and
credential-rotation workload sizing. No production limits or alarm thresholds have
been selected, and no infrastructure/deployment/activation is implied.

## Infrastructure preparation

Live Support's repository-only assessment found no Intake Assurance table, runtime
environment wiring, schedule or alarm in `infra/aws/api-cloudformation.yaml`.
Existing table policies do not grant access to a new intake table. Prepare a
separately reviewed infrastructure slice with:

- A customer/attempt-keyed encrypted Dynamo table with PITR, deletion protection,
  retain/update-replace retention, output and environment binding.
- Table-specific Get/Put/Query and transaction/condition-check IAM. Do not widen
  existing job/submit permissions or add scans.
- Independently default-false capability wiring. Customer/connection/method IDs,
  operator UIDs, SLA, page/snapshot/run caps and lease bounds have no invented defaults.
- Separately disabled schedules for recovery, notifications, feedback and repair,
  reviewed retry policy, DLQ and alarm ownership. Preserve the existing Wrike rule.
- Explicit default-false admin build-flag parity and Lambda environment byte-budget
  validation before adding more environment variables.

The existing API deployment workflow supplies a hand-maintained parameter override
list. Live Support identified parameter preservation as a release hazard. Before
using any release path, obtain the authoritative deployed template and complete
current parameter manifest, preserve NoEcho values with UsePrevious semantics,
inspect the exact change set, and prepare rollback. Repository defaults alone are
not evidence that current production settings will be preserved.

## Evidence requiring production access or operating decisions

Inventory the intake table (if any) and verify the assertion that no capture or
migration occurred: pre-projection experimental rows fail closed. Baseline existing
ingestion, scheduler, writeback and Proof settings/queues before any release.
Select one customer/connection/method/exact status, inspect current discovery and
legacy/multi-workbook scope, and choose workload-based bounds and incident owners.

Verify scoped Wrike read/write and Secrets rotation authority, SES identity and
configuration, the internal recipient owner, alarm/DLQ destinations and operator
allowlists. None of these production checks was performed for this dossier.

Release order remains default-off infrastructure/code, approved read-only visibility,
bounded capture/recovery, a separate internal-notification window, then separately
approved feedback or repair. Rollback disables only new gates/rules and preserves
all intake, delivery and writeback records, especially uncertain receipts.

## Storage-only source preparation

The API template now proposes an independently default-false
`IntakeAssuranceStorageEnabled` parameter. Its true branch creates only the intake
attempts table, narrowly scoped API IAM, `PATHFINDER_INTAKE_ATTEMPTS_TABLE` binding
and `IntakeAssuranceTableName` output. It does not activate any capability.
All capability/scope/budget values, schedules, notification/feedback/repair and
production deployment remain held. No existing scheduler, queue, alarm, provider,
Secrets or API behavior is changed.

Run `npm run test:proof-deploy` for the offline template contract checks. The
historical fingerprint in `scripts/tests/fixtures/intake-storage-baseline.json`
records the pre-storage template; later intentional infrastructure changes must
review and update this contract explicitly. The test evaluator uses fixture
resource identifiers and parameter defaults: its environment byte count is only
fixture evidence, not a production headroom assertion. Check the complete actual
candidate environment (UTF-8 keys plus values, maximum 4,096 bytes) before release.

Rollback after provisioning disables capability gates/rules while retaining the
storage binding and table. Turning the storage condition off retains the physical
table but detaches it from the stack; turning it on again can cause a table-name
collision and require an explicitly reviewed resource import. Do not use the
storage condition as a routine operational stop switch. The standard hand-maintained
API deployment workflow remains held pending authoritative current-template and
complete parameter preservation, including NoEcho UsePrevious values, and exact
change-set review. No production manifest count is inferred from repository defaults.

## Capture configuration source preparation

The first capability wiring is capture only. `IntakeAssuranceCaptureEnabled`
defaults false, independently of storage. With capture false, all nine new capture
environment bindings are omitted, even if parameter values are retained. Capture
true requires storage true plus explicit customer, import method and saved
connection IDs, SLA (60–604800 seconds), candidate cap (1–1000), complete-history
snapshot cap (1–10000), and per-discovery request/time limits (1–256 requests,
1–120000 ms). All eight setting parameters default to empty; no operating values
are selected. Identifier restrictions match the runtime guard. If existing scheduled
intake is enabled too, its customer/method must match capture; existing schedule,
submit/writeback behavior, permissions and other gates are unchanged.

This adds no recovery, notification, feedback, repair, operator-review or UI gate,
no schedule, no new IAM and no deployment workflow variables. The prior storage
fixture fingerprint is advanced to the reviewed storage merge `8ae1ad0`; the new
capture delta test removes only the new parameters/condition/rules/environment
bindings before comparing every previous template property. Existing storage
branch tests remain in place. Tests also pass emitted capture values into the real
runtime parser and check missing fields, identifier rejection and numeric bounds.

The synthetic capture fixture uses 3,791 environment bytes, leaving only 305 bytes
under 4,096. This is not production headroom: actual identifiers, existing enabled
flags and resolved resource names can exceed the limit. Before any release, create
a complete candidate variables JSON map from authoritative effective settings and
run `node scripts/intake-environment-preflight.mjs /path/to/candidate-variables.json`.
The offline command reports only UTF-8 byte totals/counts, refuses oversized maps,
and does not fetch production or print environment names/values. It cannot prove
that a supplied map is complete or that other Lambda/CloudFormation constraints
are satisfied; those remain change-set review responsibilities.

Discovery limits cover each full discovery, not an entire multi-candidate
invocation or recovery lease. There is no runtime SLA-to-discovery or lease-to-
discovery numeric relationship to invent in this template. Choose total invocation
bounds against repeated discovery/preparation, downstream evidence work, the
300-second Lambda timeout, current cadence and credential rotation. Retain the
separate operating-value, exact status/workbook scope, manual-review ownership,
legacy/cursor inventory, parameter-preservation, actual headroom and rollout holds.
This source preparation does not authorize capture activation.

Enabled capture additionally requires `StorageDriver=dynamodb`; provisioning a
retained table alone is insufficient. The Lambda runtime checks the driver and
nonempty trimmed table binding before parsing scope/discovery settings. An absent
application runtime marker does not bypass the guard when AWS supplies its Lambda
function-name marker. Intentional non-Lambda development fixtures remain local.

## Recovery configuration source preparation

`IntakeAssuranceRecoveryEnabled` independently defaults false and creates no
schedule. When enabled it requires retained storage, `StorageDriver=dynamodb`,
explicit safe customer/method/connection IDs, SLA and complete-history snapshot
limit, plus empty-default page size (1–100), page count (1–10), and lease duration
(30–900 seconds). An enabled existing scheduled intake must match its customer and
method. Recovery may remain enabled with capture disabled for an independently
approved durable-outcome observation window.

The five shared scope/SLA/snapshot bindings emit when capture OR recovery is active.
Recovery's four gate/page/count/lease bindings emit only when recovery is active;
capture-only candidate/discovery settings remain absent in recovery-only mode.
Both active conditions require storage. CloudFormation separately requires the
DynamoDB driver, and the shared Lambda runtime guard independently checks driver
and table binding before enabled capture or sweep configuration becomes usable.
Because notification/feedback/repair reuse the sweep parser, that guard also
protects their enabled configurations; this slice does not enable those capabilities.
Recovery identifiers now reject trailing whitespace/newlines as capture does.

Synthetic complete environment totals: 3,316 bytes all off, 3,378 storage only,
3,791 capture only, 3,763 recovery only, and 3,943 combined (153 bytes remaining).
Valid longer IDs can overflow the 4KB limit; the candidate-environment checker
rejects that case. No production headroom is asserted. Further capability wiring
must address cumulative environment size before any activation; do not assume
all capabilities will fit concurrently. No identifiers or operating values have
been selected for production.

The existing recovery algorithm remains bounded by page size/count (at most 1,000
attempts per segment), complete-history snapshot limit and durable lease/fencing.
Existing tests cover overlap, lease expiry, replay, page caps, filtered pages,
repeated cursor and snapshot failure. This slice adds no provider discovery,
transport, job creation, writeback, schedule, IAM or deadline algorithm. The 300s
Lambda timeout, whole-invocation workload sizing, cadence and selected lease remain
release checks; a lease limit is not a promise every selected workload finishes
before timeout. Keep authoritative parameter/NoEcho preservation, exact change-set
review, environment proof, table/import posture, inventory and isolated recovery QA
as separate holds. The historical fingerprint now compares the approved capture
merge `6e01feb` after removing only recovery additions and restoring the five prior
capture-only environment conditions.

## Compact budget serialization

The template now serializes the same explicit numeric parameters into two entries:

- `PATHFINDER_INTAKE_CAPTURE_LIMITS`: `1|max_candidates|max_requests|max_elapsed_ms`.
- `PATHFINDER_INTAKE_RECOVERY_LIMITS`: `1|page_size|max_pages|lease_seconds`.

The leading `1` is the format version; remaining fields are ordered positive decimal
integers within the existing runtime ranges. The template emits each entry only
under its existing active condition and omits its three old individual budget keys.
All parameters, patterns, rules, gates, shared scope/SLA/snapshot fields, storage
requirements, schedules and IAM remain unchanged. These entries cannot enable a
capability or select its scope. Each active parser reads only its own entry.

Complete legacy individual settings remain supported. If compact and legacy values
coexist, all three legacy fields must be present and textually identical to the
compact values; partial or conflicting mixed settings fail closed. Unknown versions,
wrong field counts, blank fields, whitespace, exponent/decimal/leading-zero syntax,
invalid bounds and oversized payloads are rejected without echoing contents. No
process environment mutation or global expansion is performed. Disabled parsers
ignore malformed inactive entries. Adjacent enabled sweep consumers use the same
recovery budget parser, preserving their independent capability gates.

The complete synthetic combined environment is now 3,789 bytes, leaving 307 bytes;
capture-only is 3,703 and recovery-only is 3,697. The all-off/storage-only totals
remain 3,316/3,378. Savings are 88 capture bytes and 66 recovery bytes for both short
and long scope IDs. Valid long IDs can still exceed the limit, so actual full
candidate verification remains mandatory. This is additional headroom, not proof
that every future capability or production configuration fits.

Any later release must package a runtime that understands version 1 with this
compact template. A rollback to a pre-compact runtime must restore complete legacy
budget entries through a reviewed parameter-preserving template/environment change;
never leave an older binary with only compact entries. Default-off gates, actual
headroom proof, deployed parameter/NoEcho preservation, exact change-set review,
retained storage and separate deployment/activation approval remain required.

## Read-only visibility configuration

`IntakeAssuranceVisibilityEnabled` independently defaults false. Enabling requires
retained storage, `StorageDriver=dynamodb`, `RequireFirebaseAuth=true`, and one safe
explicit `IntakeAssuranceCustomerId`. Only the existing API visibility flag and
`PATHFINDER_INTAKE_EXCEPTIONS_CUSTOMER_IDS` singleton allowlist are added; the same
customer parameter is reused without emitting duplicate capture/recovery scope.
Visibility-only emits no method/connection/SLA/snapshot/budget settings and enables
no capture, recovery, delivery review, notification, feedback or repair capability.

The API configuration guard returns disabled before inspecting any other setting.
Enabled visibility requires exact auth=true and one safe, trim-stable customer ID;
comma-separated multiple IDs are rejected. Lambda additionally requires DynamoDB
and a nonempty trimmed attempts-table binding. Existing Firebase token/domain
middleware remains ahead of the unchanged read-only exceptions/deliveries router.
UI state never authorizes API access. Requests for another customer are rejected
before reads; existing pagination, cursor, projection/redaction and no-store behavior
remain. No write or operator-attestation route is enabled.

Admin builds use `VITE_ENABLE_INTAKE_EXCEPTIONS` (default false) and
`VITE_INTAKE_EXCEPTIONS_CUSTOMER_ID` (default empty). Existing workflow source maps
these from `PATHFINDER_ENABLE_INTAKE_EXCEPTIONS_UI` and
`PATHFINDER_INTAKE_EXCEPTIONS_UI_CUSTOMER_ID`; no repository variable was changed.
Local deployment source supplies the same defaults. Absent/malformed flags are off.
Navigation and component mounting require an authenticated session, exact safe
configured customer match, and agreement between selected and resolved customer
identity. On mismatch the fetch-owning component is not mounted. The existing
components expose only read/refresh/pagination controls.

Synthetic complete Lambda environment totals are 3,467 bytes for visibility only
and 3,878 for capture+recovery+visibility (218 remaining). Actual IDs and other
production flags may overflow 4KB; full candidate measurement remains required.
API and Vite gates/customer scope must be reviewed together for any future read-only
window, alongside token/domain access, retained-table/schema/inventory, authoritative
parameter/NoEcho preservation and exact change-set review. No browser publication,
API deployment, repository setting change or production smoke was performed.

## Offline parameter and rollback evidence validation

The read-only `scripts/intake-deployment-preflight.mjs` now checks supplied complete
parameter inventories, declared deltas, NoEcho preservation, full environment maps
and exact original-value rollback. See `deployment-preflight.md` for the packet
schema, canonical digest definition, synthetic example, restrictions and remaining
review obligations. No production evidence has been collected. A passing packet
establishes internal consistency only; it never approves deployment, evaluates the
change set, proves provenance/freshness or replaces real environment derivation.
The standard API workflow remains held pending authoritative parameter preservation.

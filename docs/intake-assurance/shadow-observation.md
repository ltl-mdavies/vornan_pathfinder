# Source-only Wrike shadow observation

Shadow observation is separate from enforcing capture. It runs only at the end of
an ordinary completed scheduled run, after preparation, submission, writeback and
the existing operations snapshot. It consumes that run's discovery and results;
it does not discover again, refresh credentials, call a provider or replace a
preparation callback. Manual intake is unchanged.

CloudFormation wiring is included and defaults off: `IntakeShadowEnabled` defaults
to false, and the three shadow environment bindings are absent while disabled.
The source configuration section below describes the five new parameters. No
schedule, IAM, UI or deployment workflow change is included. This source slice
does not authorize activation; resolved environment evidence and release review
are still required before deployment, followed by a separate activation review.

## Configuration contract

- `PATHFINDER_ENABLE_INTAKE_SHADOW`: exact `true` enables the optional end-of-run
  observation. Anything else returns before configuration, persistence or telemetry.
- `PATHFINDER_INTAKE_SHADOW_SCOPE`: `1|customer|method|connection|status_id`.
  All four IDs must be exact safe identifiers and match the verified existing run.
- `PATHFINDER_INTAKE_SHADOW_LIMITS`: `2|max_candidates|sla_seconds|max_elapsed_ms|expires_at_ms`.
  Bounds are 1–25 tasks, 60–604800 seconds and 50–1000 milliseconds respectively.
  Expiry is an absolute 13-digit Unix millisecond timestamp, strictly in the future
  and at most one hour away when observation starts. Version 1 is rejected.
  Missing, invalid, expired or overly distant expiry returns before scope parsing,
  store creation and telemetry. The enabled flag still defaults off.
- Existing DynamoDB storage and the intake table binding are required. Local-file
  persistence is intentionally unsupported for this mode.

Other Intake Assurance capture/enforcement, recovery, visibility, delivery,
notification, feedback and repair gates must be off. Conflicting or invalid
configuration causes shadow observation to fail without table access and emits
only an aggregate marker. It does not override another capability enabled
separately: existing enforcing-capture behavior remains unchanged if its own gate
is enabled. A shadow pilot must not co-enable it.

## Isolated records and bounded effects

The only additional I/O is a consistent Get and conditional Put per selected task,
against the existing intake table, in `intake-shadow#<customer>` partitions. Keys
are deterministic hashes of customer/method/connection/task/status. The normal
attempt reader uses the exact customer partition, so shadow rows cannot become
actionable recovery/delivery records or alter the enforcing intent cursor.

Each row holds an observed cursor, an embedded manual-review attempt and bounded
existing preparation/job/submit/writeback outcomes. Only exact-status candidates
from the canonical validated selector are eligible. Each must resolve to exactly
one discovery record; out-of-status observations are not persisted. This pilot
cannot prove a status exit/re-entry it did not observe, and does not infer one.
Its SLA
deadline is observational; no worker reads this partition for action. First-seen,
unproven entry and later-generation evidence never authorizes or blocks a live
operation. No auto-promotion from shadow to active attempts is provided.

All candidate identities, timestamps, status evidence, duplicates and record-size
bounds are checked before opening the store. Overflow skips the observation batch
instead of truncating discovery or failing ordinary intake. At most 25 existing
job links and 25 submit/writeback observations per task are copied. Rows are latest
observations per scoped task, not an unbounded history per poll. A repeated identical
discovery/result is a read-only replay; changed observations update through CAS.
The limit is per cycle, not a lifetime tenant retention limit.

A dedicated DynamoDB client uses one SDK attempt. The whole batch shares an abort
deadline at the earlier of the storage timeout or absolute expiry, and no operation starts after cancellation. Lambda supplies its remaining
time; observation skips without a reliable remaining-time value or the configured
budget plus a two-second completion margin. The client is destroyed after the batch.
No unawaited background persistence or Promise.race timeout is used.

Errors, stale observations, CAS conflicts and timeouts stop shadow work and emit
only fixed status/count telemetry. They do not replace the original result or
change its candidate/error counts. Partial shadow writes may persist; an aborted
request has an uncertain write outcome and is not retried. A later run reconciles
through the deterministic key/CAS. Telemetry/cleanup failures are isolated too.
The feature adds bounded latency; it does not promise literally zero timing impact.

## Validation and future release boundary

Tests cover original discovery/preparation/submission/writeback call counts and
results, first-seen and reused-task non-blocking behavior, duplicate replay,
scope/status/metadata/overflow rejection, persistence/telemetry failure isolation,
shared abort, Lambda time margin, tenant keys and conditional SDK requests. The
actual disabled-scheduler test also enables the shadow flag with unusable storage
and confirms no provider/assurance activity. Existing enforcing tests remain intact.

Any pilot requires a separately reviewed runtime artifact and template/settings
change, exact-one-customer approval, real environment byte calculation and an
ordinary-cycle comparison. Keep all other gates off. Rollback disables only shadow
observation and preserves table records; inspect ambiguous/partial observations
without replaying customer or provider operations.

## Source configuration wiring

`IntakeShadowEnabled` defaults to false. Enabling it requires retained intake storage,
DynamoDB, the existing ordinary Wrike scheduler, and capture, recovery and visibility
all disabled. It reuses the explicit assurance customer, import method, connection
and SLA parameters. Customer and method must match the scheduler. The saved connection
and exact custom status are checked again against ordinary discovery at runtime.

Four additional empty-default parameters require explicit values: `IntakeShadowStatusId`,
`IntakeShadowMaxCandidates` (1–25) and `IntakeShadowMaxElapsedMs` (50–1000), and `IntakeShadowExpiresAtMs`.
CloudFormation validates expiry shape and presence; runtime validates its time range.
Only the three shadow environment bindings become present; the shared enforcing
scope bindings remain absent. No resource, IAM permission, schedule, UI or provider
setting is added. The existing storage grants already cover shadow GetItem/PutItem.

This is source wiring only. Before deployment, preserve every current parameter and
validate the serialized JSON of the full resolved Lambda environment against 4096 UTF-8 bytes using real candidate
values. Synthetic fixture headroom is not production headroom. Keep shadow disabled
for any runtime rollout. Activation requires a separate exact customer/method/connection/
status scope, per-cycle bounds, observation window, cumulative write allowance and stop
criteria review. Disabling shadow removes its three bindings; retain storage and its data.


## Expiry rollout and pilot stop

Expiry is packed into version 2 of the existing limits binding, adding 14 bytes
compared with version 1 for a 13-digit timestamp. No extra environment key is added.
Keep shadow disabled while deploying this runtime and template contract; the older
runtime rejects version 2 and the new runtime rejects version 1. Review the exact
candidate environment again before activation. Set the final absolute time near
activation, allowing for deployment duration without exceeding the one-hour horizon.
Do not extend or refresh expiry automatically.

The observer checks its clock before constructing the store and before each read
and write. Invalid time stops work. Expiry cancels the shared request signal and
suppresses subsequent telemetry; cleanup still runs. Timer dispatch can be delayed
by the event loop, and a request sent before cancellation can have an uncertain or
committed outcome. Expiry is a boundary for starting operations and requesting
cancellation, not a guarantee that DynamoDB cannot commit an in-flight request later.
Read-only after-checks must account for that uncertainty without retrying writes.

The pilot's 10-write allowance remains a staffed monitoring threshold, not an atomic
cumulative quota. A hard cumulative maximum requires a separate durable quota design.

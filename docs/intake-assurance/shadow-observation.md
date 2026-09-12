# Source-only Wrike shadow observation

Shadow observation is separate from enforcing capture. It runs only at the end of
an ordinary completed scheduled run, after preparation, submission, writeback and
the existing operations snapshot. It consumes that run's discovery and results;
it does not discover again, refresh credentials, call a provider or replace a
preparation callback. Manual intake is unchanged.

The default flag is absent/off. No infrastructure parameter, schedule, IAM, UI or
deployment workflow change is included. This source slice cannot be interpreted as
activation authority; future template wiring, environment evidence and release
review are still required.

## Configuration contract

- `PATHFINDER_ENABLE_INTAKE_SHADOW`: exact `true` enables the optional end-of-run
  observation. Anything else returns before configuration, persistence or telemetry.
- `PATHFINDER_INTAKE_SHADOW_SCOPE`: `1|customer|method|connection|status_id`.
  All four IDs must be exact safe identifiers and match the verified existing run.
- `PATHFINDER_INTAKE_SHADOW_LIMITS`: `1|max_candidates|sla_seconds|max_elapsed_ms`.
  Bounds are 1–25 tasks, 60–604800 seconds and 50–1000 milliseconds respectively.
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
deadline, and no operation starts after cancellation. Lambda supplies its remaining
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

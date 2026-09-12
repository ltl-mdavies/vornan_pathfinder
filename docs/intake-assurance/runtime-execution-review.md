# API runtime-only execution — 2026-09-12

The user approved publishing the runtime review and executing the exact existing
change set once, subject to fresh prechecks and postchecks. PR #342 contains the
approved review at `74f38b1`. This execution record remains local pending explicit
publication approval. No Intake Assurance capability activation was included.

## Executed candidate

Source commit: `6c247a271a576377fcc8b56d2238bdf9dc441bdb`.
ZIP SHA-256: `46d1824b4a540539697fa92770fb0606d6e783d4d5274cf4f5951a4d77c6dcb1`.
The unique reviewed change-set ID was used; its report name is
`intake-runtime-only-20260912-46d1824b4a54`.

Development and Live Support confirmed no known competing release or incident.
Just-in-time checks verified exact baseline identity, all 114 parameters, unchanged
template/environment/resources, candidate identity and sole AVAILABLE status, S3
version/checksum/size, healthy table, alarms and queues. The scheduler and scoped
table policy were also compared with the prior completed storage deployment.

One execution request was accepted, using an exclusive local attempt marker and
`AWS_MAX_ATTEMPTS=1`. No retry or substitute change set was sent. Stack events show
only stack/API function update transitions and successful completion. The stack
is `UPDATE_COMPLETE`; the exact change set is `EXECUTE_COMPLETE`.

## Post-execution verification

- Lambda's deployed code hash and size match the approved immutable package.
  Runtime, handler, role and all other substantive configuration remain unchanged;
  code-update revision/time metadata changed as expected.
- Only the API artifact parameter changed. All other parameters, including the
  NoEcho and separate Proof worker reference, are preserved. The deployed template
  is unchanged.
- All 38 resources retain their physical IDs. The complete 70-variable environment
  is identical to the preflight map: 3,658 bytes, with 438 bytes remaining.
- API role, inline policies, attached policies and the Proof worker's complete
  Lambda configuration compare equal to preflight. The intake table remains ACTIVE,
  encrypted, PITR-enabled and deletion-protected with unchanged configuration.
- All five monitored alarms remain OK, both queues are empty with unchanged
  configuration, and the scheduler rule/targets are unchanged.
- Provider-free HTTP checks passed: health 200 with the expected service identity,
  unauthenticated API 401 and unauthenticated Proof API 401. These check startup and
  authentication boundaries; no authenticated customer/status/provider workflow
  smoke, customer job submission or feature activation was performed.

The private runtime-execution manifest binds raw pre/post snapshots, execution
records, events and smoke evidence. Directory/file permissions remain 0700/0600.
The single-attempt statement is bounded to the local execution record, not an
independent CloudTrail count. No raw parameter/environment values or credentials
are published here.

Development independently verified all 54 manifest-bound files and the complete
pre/post comparison, returning deployment verified / GO to close the runtime
release. It confirmed only the API code-key parameter and expected Lambda code/
revision/time fields changed; all environment, resource, IAM, worker, table and
operational state was preserved. The advancing PITR latest-restorable timestamp
is expected metadata movement. Its verdict leaves all activation work held.

Live Support independently verified the same 54-file evidence set and returned
runtime release GO. It confirmed code-only Lambda changes, unchanged table item
count/size and configuration, all capability flags absent/off and healthy smoke
results. Both independent reviews support closing this runtime release.

## Result and next boundary

The new API runtime is deployed with all Intake Assurance capabilities off. Storage
and runtime foundations are now present; this is not customer activation evidence.
The inherited dependency advisories documented in `runtime-release-review.md`
remain unchanged and are not represented as remediated.

The immediate proposed readiness step is a separately authorized read-only check
after an ordinary existing scheduler cadence, using existing logs/metrics without
manual invocation. Confirm no new assurance activity or errors, all gates off,
table state and operational health unchanged; respect eventual consistency of
table counters and avoid copying customer/provider identities into reports.

After that validation, prepare a single-customer read-only visibility pilot plan:
exact customer scope, API/Admin gate pairing, authenticated
operator access, compatible Admin build, parameter/environment preservation,
monitoring and rollback evidence. Preparing that plan must not enable visibility,
publish Admin changes or activate capture/recovery/provider-writing capabilities.
Those actions need separate concrete review and approval.

Keep storage and records intact. Any runtime rollback must explicitly restore the
prior artifact while preserving the existing table, environment and capability-off
posture; do not detach storage as routine recovery.

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

## Task re-entry: next engineering slice

Current capture still uses `intent_occurrence: "initial"`; activation remains held.
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

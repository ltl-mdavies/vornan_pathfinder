# Intake Assurance: review and staged rollout

## Review scope

The local branch now contains durable pre-job intake tracking, a gated Exceptions
view, independent recovery, delivery receipts, bounded internal notifications,
read-only receipt review, a narrow Wrike correction adapter, audited operator
reconciliation, current-workbook freshness guards and existing-ledger success-link
repair. The accepted status aliases remain hyphen/en dash, with hyphen canonical.
The integration ledger records each local commit and regression checkpoint.

Production main was repeatedly checked against
`ae7ba0a9d76fabcd6523b363e46fc17143e91c1d`. The existing draft PR initially contained
only the foundation. Following explicit approval to coordinate independent review,
the accumulated commits through `9adf8a2` were pushed and draft PR #330 was updated.
No merge, deployment, infrastructure, schedule or flag activation has been
performed. Review this branch before merging; the patch spans the API/store,
Wrike adapter, narrow web components and synthetic tests.

## Policy currently implemented

- One automatic message per intake and channel. No automatic rearming, repeated
  uncertain send, legacy backfill or multi-workbook identity migration.
- Only existing unmapped-product jobs qualify for customer correction, with exact
  current workbook identity and source timestamp checks. Other correction templates
  are retained but not enabled by the adapter.
- An allowlisted authenticated operator can attest provider acknowledgement or
  confirmed non-delivery with an evidence reference. The audit is immutable and
  revision guarded. Non-delivery closes without scheduling a new send.
- Success-link repair uses the existing writer only when there is no prior
  writeback record. Existing failed/prepared/uncertain records require review.
- All schedules, limits, recipients/connection authority and enablement remain
  explicitly controlled; no production operating values have been invented.

## Remaining engineering/operational limits

Independent Development review requested changes before merge: impossible
persisted lifecycle combinations and writeback ID rebinding. The follow-up
validates lifecycle invariants on reads and transitions, stores and checks the
complete resulting-state projection on each event, and prevents replacement of
an assigned writeback ID. Development re-reviewed exact source head `dd24f06`,
confirmed both merge blockers resolved and found no new blocker in the correction.
Normal PR review and separate merge approval remain required.
Experimental records created before this projection requirement fail closed;
there is no automatic migration or repair, and capture has not been activated.
Inventory the intake table and verify that no capture/migration occurred before
deployment or activation; the compatibility assessment depends on that assertion.

Capture activation remains blocked on an authoritative task re-entry/occurrence
policy: the current fixed `initial` occurrence cannot represent reuse of a terminal
task. Customer feedback activation also requires validating current folder/root,
task identity and custom item type against the scoped discovery contract. Current
status and workbook freshness checks alone do not establish that full scope.
Resolve these engineering holds before the corresponding rollout steps below.

The follow-up scope guard reuses exact-task discovery before and after receipt
claim, including folder ancestry and configured task identity. It also reloads
configuration and task freshness. Development reviewed exact source head
`433d7dd0e14a18479ecfe18f8c9b435ead4d457a`, confirmed the scope defect closed and
found no correctness merge blocker; GitHub validation passed. The task re-entry
resolver and deployment infrastructure remain outstanding; see
`activation-prerequisites.md` for the coordinated implementation/release dossier.

The subsequent shared capture slice now wires manual/scheduled discovery through
the durable cursor and guarded intake handoff. Preparation requires a persisted
qualified non-ready baseline followed by the first newer ready entry. Initial-ready
tasks, reuse, legacy identities and unsafe history remain sticky manual review.
This replaces the fixed occurrence in the capture-enabled runtime; activation
still awaits independent integration review, cursor inventory and production QA.

Dynamo is required for distributed workers; local JSON supports serialized work in
one process only. Provider actions and local state are not one atomic transaction.
An already-in-flight request cannot be withdrawn by a later source/config change.
Provider acknowledgement is not proof of mailbox receipt. Source metadata that
is missing, partial, stale or ambiguous suppresses feedback and needs operational
review. Legacy and multiple-workbook cases need a scoped inventory and identity
policy before backfill. Mapping/configuration changes still require scoped QA to
confirm job re-evaluation precedes customer correction.

The operator endpoint records human attestations; it does not independently query
provider delivery evidence. Retry/rearm controls are intentionally absent. Broader
correction classification and a repeat-escalation policy remain separate changes.
Existing status-link publication and credential-rotation behavior are reused, so
production IAM/Secrets/Status capability review is required before repair activation.

## Approval sequence

1. The user approved pushing the accumulated commits and updating draft PR #330
   for independent review; that step is complete. Code review and separate merge
   approval remain required. This approval does not imply deployment or enablement.
2. Review storage/IAM (including transaction condition checks), Secrets access,
   read/write Wrike connection authority, SES configuration, operational ownership,
   scope IDs and explicit bounds. Select SLA, lease durations, polling/retry windows
   and per-run caps from observed workload; do not copy synthetic fixture values.
3. Approve a deployment with all new gates off, then separately approve visibility
   and capture/recovery for one customer. Validate records, pagination, deadlines,
   duplicate suppression and legacy/multi-workbook inventory before delivery.
4. Approve internal notifications in a bounded window. Validate provider receipts,
   uncertainty handling and operator review before enabling customer communication.
5. Approve narrow customer correction and success-link repair separately, after
   synthetic-to-production scope and freshness checks. Keep failed/uncertain
   writebacks blocked, and observe duplicate prevention before widening scope.

Rollback starts by disabling the relevant new delivery/repair gates and schedule;
retain intake, receipt and writeback ledgers for recovery and audit. Do not delete
uncertain records or reset their revisions. Flag rollback does not cancel an
already-in-flight provider request. Visibility/recovery may remain available under
their own approved gates while operators reconcile outcomes.

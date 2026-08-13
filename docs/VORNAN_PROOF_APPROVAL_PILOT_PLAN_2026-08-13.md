# Vornan Proof approval pilot plan — 2026-08-13

Status: repository preparation and read-only candidate selection only. This plan
does not authorize deployment, customer setting changes, grant creation, a Lift
read refresh, a Lift decision, email, upload, publication, or production data
mutation.

## Objective

Qualify customer Proof approval with one exact Momentara-associated LTL Demo
order, then transition to configuration-driven customer onboarding. Revised-art
upload, malware processing, publication, direct asset delivery, operator revised-
art action, and automatic retry remain outside this pilot.

## Selected bounded candidate

Read-only durable evidence on 2026-08-13 identified order `A0226753`:

- Pathfinder customer workspace: Momentara `284619`;
- Proof/Lift customer cohort: `1249`;
- retained Proof aggregate: five current proofs, one actionable pending task;
- customer Proof setting: `View only` with `Simple` review profile;
- order overrides: none; and
- active grants and sessions: zero at selection time.

This is a provisional candidate, not approval to act. Immediately before any
activation, one separately authorized GET-only refresh must confirm the same
customer, order, current attachment, Proof version, task actionability, and line
association. Stop if any identity or current-proof value changed.

## Required customer setup model

The existing durable customer policy is the intended control plane:

- access: `disabled`, `view_only`, or `review`;
- review profile: `simple` or `advanced`; and
- optional exact-order override.

For the pilot, the only intended policy mutation is an order override for
`A0226753` from inherited `view_only/simple` to `review/simple`. Do not enable the
Momentara customer default. Capture the prior workspace record/version and audit
count before the save, verify exactly one additive audit entry afterward, and
prove Import Methods, mappings, output routes, Jobs, order IDs, submit attempts,
status records, and scheduled intake parameters are unchanged.

Before production setup enablement, replace the current general store-save path
for customer Proof settings with a narrow conditional write against the exact
customer policy/workspace version. A stale Admin page must fail with a conflict;
it must never overwrite a newer setting or cause unrelated customer, Import
Method, mapping, Job, order, attempt, status, or runtime record to be rewritten.

The pilot must stop unless the public Proof runtime enforces the resolved saved
policy at grant creation, session/current-order resolution, public DTO/profile,
and decision execution. A global deployment flag by itself is not customer
authorization.

## Repository and live gates

Before any separately authorized activation:

1. validate current merged main, Proof artifact identity, and live SPA hashes;
2. run full check/test/build, Proof deployment-contract tests, and Playwright;
3. run the corrected aggregate-only Proof window monitor;
4. capture all Pathfinder stack parameters, fifteen protected counts, scheduler,
   recent natural cycles, alarms, and rollback artifacts;
5. capture Proof core/audit counts, grants/sessions, queues, alarms, and all Proof
   platform gates;
6. verify no shared deployment is active and use API-first / isolated-Proof-second
   ordering for any reviewed platform change; and
7. require an inspected parameter-preserving change set before execution.

## Approval-only execution sequence

Each numbered transition requires its own evidence and stop decision.

1. Save the exact order override through authenticated Admin; no direct table edit.
2. Enable only the platform grant/approval capability required for the pilot.
   Customer revision upload, asset upload, scan, publication, delivery, email,
   operator revised-art action, and revised-art Lift submission remain false.
3. Create one private review grant for `A0226753`; send no email.
4. Exchange the one-time token, identify the reviewer, and confirm the current
   proof on desktop and mobile.
5. Prepare one exact approval against the current task, attachment, and Proof
   version. Re-read before transport.
6. Perform at most one Lift approval PUT, transition through uncertain/reconciling
   semantics, and immediately reconcile with an authoritative GET. Never retry
   automatically.
7. Confirm the durable decision/audit record, current Proof state, and any shared
   attachment effects across every associated Lift line.
8. Revoke the grant, end the session, remove the order override, and restore every
   temporary platform gate.
9. Repeat protected-count, scheduler-cycle, queue, alarm, and data-continuity
   checks. Stop on any unrelated Pathfinder or Proof change.

## Stop conditions

Stop without a Lift write if the order/customer association is missing or
ambiguous, the saved policy is not authoritative, the proof is no longer current,
the attachment/version changed, shared-attachment impact cannot be enumerated,
another deployment is active, an alarm is non-OK, a queue is nonempty, protected
counts drift unexpectedly, or any Pathfinder intake/submit/writeback/publication
parameter differs from the captured baseline.

After a transport timeout or ambiguous response, do not retry. Preserve the
attempt and reconcile through authoritative Lift evidence.

## Setup-driven go-live acceptance

After platform qualification, bringing a customer into Proof must require only:

1. select the customer in Admin;
2. choose `Proof off`, `View only`, or `Review enabled`;
3. choose the reviewed use-case profile;
4. optionally add an exact-order exception; and
5. save and audit the setting.

No application artifact, CloudFormation deployment, environment-variable change,
credential change, or direct data edit is allowed for ordinary customer
onboarding or offboarding. Global infrastructure switches remain emergency kill
switches and release boundaries only.

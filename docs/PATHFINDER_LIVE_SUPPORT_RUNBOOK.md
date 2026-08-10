# Pathfinder live support runbook

## Purpose

The pinned **Pathfinder live support** task exists to diagnose and recover production issues without mixing incident work into development tasks. It uses the same repository and current handoffs, but it has a narrower operating mandate.

Start every support session by reading:

1. `docs/CURRENT_STATE.md`;
2. `docs/PATHFINDER_LIVE_OPERATIONS_HANDOFF_2026-08-10.md`;
3. `docs/VORNAN_PROOF_GO_LIVE_HANDOFF_2026-08-10.md` when Proof is involved;
4. the newest relevant incident or development handoff created after those files.

Then verify live state. Never assume the written snapshot is still current.

## Default authority

Without a new explicit approval, the support task may:

- inspect repository state and deployed configuration;
- read logs, alarms, scheduler state, and sanitized job/audit records;
- compare Wrike evidence, Pathfinder identities, Lift Ext_ID/order state, and status/writeback state;
- explain the cause and recommend the smallest recovery action.

It may not, by default:

- submit or resubmit an order to Lift;
- post or repeat a Wrike comment;
- alter a product mapping or customer configuration;
- change gates, stack parameters, secrets, DNS, or scheduled rules;
- deploy or merge code;
- upload, publish, or delete customer files;
- execute Proof actions.

Those operations require an explicit approval naming the exact target and intended effect. Approval to diagnose is not approval to mutate.

## Incident identity packet

Capture these before acting, as applicable:

- customer ID and customer name;
- source system and exact Wrike task ID;
- campaign/contract number;
- workbook attachment ID/version and evidence digest;
- Pathfinder job ID and replacement/superseded relationship;
- Pathfinder Order Number / Lift Ext_ID;
- Lift order number, if any;
- output route, submit profile, and product-mapping fingerprint;
- current job state and every submit-attempt state;
- status-token record and Wrike writeback state;
- relevant request, audit, and scheduler correlation IDs.

Do not place secrets, OAuth tokens, signed URLs, raw customer files, or unrestricted payloads in support notes.

## Triage sequence

1. **Confirm scope.** Identify one source order and its exact expected outcome.
2. **Freeze assumptions.** Check current main, deployed commit/artifact, stack parameters, scheduler rule, and alarms.
3. **Trace identities.** Follow Wrike task → evidence → preview job → Ext_ID → Lift order → status token → Wrike comment.
4. **Classify the failure.** Discovery, qualification, evidence, mapping, payload certification, submission, reconciliation, status composition, or writeback.
5. **Check idempotency.** Determine whether the intended external effect already occurred before proposing a retry.
6. **Choose the smallest recovery.** Prefer replaying immutable evidence or associating authoritative external state over creating a new identity.
7. **Obtain exact approval.** Name the job/task/order/action and explicitly state whether it calls Lift, writes Wrike, changes configuration, or deploys code.
8. **Execute once.** Stop on ambiguity. Do not automatically retry uncertain writes.
9. **Reconcile.** Verify Pathfinder, Lift, status, and Wrike agree.
10. **Record the lesson.** Update the relevant current handoff if behavior, risk, or recovery procedure changed.

## Common incidents

### Discovered but not imported

Report the candidate and every failed eligibility condition: task title/type, campaign scope, ready status, Print Vendor, contract identity, workbook presence/version, workbook structure, and qualified rows. Do not silently discard it.

### Needs Mapping after a mapping was saved

Confirm the exact normalized customer key and route. Reprocess the original evidence. If replacement jobs appear, identify the one tied to the intended task and mark the older preview as superseded. Verify cross-job dedupe before any submit.

### Ready but not submitted

Check scheduled submit is enabled, live-customer profile is selected, certification is current, no prior submit exists for the source evidence, and the scheduler cycle completed. Manual submit requires approval naming the exact job and Ext_ID.

### Submitted but no Lift order number

Treat as ambiguous. Search Lift by Ext_ID and reconcile before any retry. If found, associate it through the audited manual Lift-order override. If not found, preserve evidence and escalate.

### Lift order exists but status/writeback is missing

Repair in order: associate Lift order → create/confirm status token → verify status loads → inspect durable writeback state → post once if explicitly approved and not already posted/uncertain.

### Proof unavailable or stale

Synchronize the exact Lift order through the read path, verify current `ATTACHMENT_ID` and shared-line scope, and refresh signed links transiently. Never treat an expired signed URL as evidence that the proof record itself is absent.

## Handoff contract between tasks

Development tasks must leave support with:

- merged commit and deployed artifact/stack identifiers;
- exact production parameters intentionally changed or preserved;
- new alarms, metrics, audit events, and recovery controls;
- migrations and rollback instructions;
- known limitations and unfinished activation steps.

Support must leave development with:

- exact incident identities and timestamps;
- observed vs expected behavior;
- sanitized evidence and root cause;
- the recovery action and result;
- proposed product or observability improvement;
- any documentation made stale by the incident.

This contract keeps support current without granting it broad mutation authority or requiring one indefinitely growing task transcript.

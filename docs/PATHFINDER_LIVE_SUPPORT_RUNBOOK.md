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

### Customer workspace setup or configuration save fails

Stop before retrying setup, saving an Import Method/Output Route, generating a preview, or invoking any external action. Capture the selected customer ID, request time/correlation, current Customers/CustomerWorkspaces/ImportMethods/OutputRoutes counts, customer-scoped Jobs/SubmitAttempts counts, and DynamoDB throttles by table. A failed response is not proof that setup failed: verify whether the exact customer/workspace/method/route records were retained before proposing any action.

The 2026-08-14 `LTL Demo / 1249` incident retained one valid isolated setup while the legacy whole-store writer later throttled on broad Job rewrites. Preserve those records. Do not delete, reseed, recreate, directly edit DynamoDB, or repeat setup. Until the focused persistence fix is deployed, do not save the `1249` Import Method or Output Route because those deployed paths can repeat the broad rewrite. Customer `1249` must remain at zero Jobs and zero Submit Attempts until a separately approved Manual XLSX preview/submit checkpoint.

After the focused fix is deployed, a workspace read is read-only and a missing workspace requires explicit Admin confirmation. Setup/configuration responses must never contain an AWS exception or documentation URL. A conflict instructs the operator to reload; a temporary failure states whether setup was retained when known and that no preview or Lift order was submitted. Validate the exact customer-scoped table delta and confirm Jobs, cache, mappings, attempts, other customers, Wrike, Lift, and Proof remain untouched.

The same incident class affected the `1249` Lift product-catalog refresh: Lift showed 18 catalog-`6338` products, but Pathfinder retained its unchanged 337-row cache because the deployed whole-store writer throttled while rewriting Jobs before it reached cache replacement. Do not repeat refresh merely to test it. Preserve the 334 catalog-`8102` rows and all 278 ProductMappings. After the focused API release, obtain explicit authorization for one exact customer-`1249` / `route-ltl-lift-91-standard-graphics` / catalog-`6338` refresh. Capture cache counts by catalog, ProductMappings, Jobs/SubmitAttempts, Jobs write throttles, gates, and external-effect ledgers before and after. The only expected mutation is an additive unique LiftProductCache delta; Jobs, mappings, workspace/configuration, attempts, Preview/Lift/Wrike/Proof records, and existing cache rows must not change. A failure must retain the old cache and return fixed nontechnical copy.

### Discovered but not imported

Report the candidate and every failed eligibility condition: task title/type, campaign scope, ready status, Print Vendor, contract identity, workbook presence/version, workbook structure, and qualified rows. Do not silently discard it.

For Momentara, inspect every configured campaign root independently. Current roots are GPA `34000804` and IBA `49405755`; overlapping task visibility must deduplicate to one evidence identity. For workbook quantity failures, distinguish blank/zero rows (intentionally excluded), configured text placeholders such as hardware `TBD → 0.5`, and unsupported text (action required). The current pending-intake response is capped at 100 candidates sorted by task ID, so absence from that view is not proof that an order-like task was outside the scanned roots. Compare aggregate qualification counts and, when the suspected order is known, reconcile its exact task ID or campaign/contract name.

For a scheduled aggregate candidate failure, inspect `candidate_failure_details` only after confirming the deployed API artifact includes that contract. Correlate its validated `task_id`, `stage`, `reason_code`, `job_ids`, and `evidence_ids`; never infer identity from aggregate counts. The event deliberately omits messages and customer content. If the deployed artifact predates this telemetry or the identity is null, report the observability gap and do not run discovery or recovery merely to manufacture a diagnostic record.

The 2026-08-11 preparation incident for task `MAAAAAEN2Ujj` is resolved. Its two legitimate proof PDFs exposed the former single-proof assumption; Momentara temporarily combined the proof, Pathfinder submitted once, and Live Support reconciled confirmed Lift order `A0228322` after the create request timed out. The original uncertain attempt remains immutable. Multi-reference-proof ZIP intake is now deployed and active for Momentara. Three later Ready siblings remain protected by cross-job idempotency and have no submit attempts or Lift association: `job_20260811184302_9b59b9`, `job_20260811192804_cc0adc`, and `job_20260811194303_68f7fa`. Do not normalize them without separate explicit approval.

### Needs Mapping after a mapping was saved

Confirm the exact normalized customer key and route. Reprocess the original evidence. If replacement jobs appear, identify the one tied to the intended task and mark the older preview as superseded. Verify cross-job dedupe before any submit.

### Ready but not submitted

Check scheduled submit is enabled, live-customer profile is selected, certification is current, no prior submit exists for the source evidence, and the scheduler cycle completed. Manual submit requires approval naming the exact job and Ext_ID.

### Submitted but no Lift order number

Treat as ambiguous. Search Lift by Ext_ID and reconcile before any retry. If found, associate it through the audited manual Lift-order override. If not found, preserve evidence and escalate.

### Lift order exists but status/writeback is missing

Repair in order: associate Lift order → create/confirm status token → verify status loads → inspect durable writeback state → post once if explicitly approved and not already posted/uncertain.

### Source review appears after Lift confirmation

Do not infer a customer workbook edit from a broad processing-fingerprint change. Confirm the exact source-change event, workbook evidence/version, reference-proof set, Pathfinder job/Ext_ID, and Lift order. Current historical events may lack component-level impact evidence; describe those as **Unable to verify source impact**, not as a proven customer change.

The repository-ready classifier compares the effective Lift-bound header, lines/product identity, workbook content, and stable proof set without publishing or calling Lift/Wrike. A technical-only result requires no operator warning. Material or unavailable impact remains stopped before publication/transport/writeback. The supported dispositions are **No Lift update needed** and **Mark reviewed** for one exact event. Either action is an internal, conditional, append-only Jobs-item update; it does not update Lift or Wrike. Obtain explicit approval naming the job, event ID, and disposition before using it in production. Never batch-clear legacy events or use a disposition to bypass an uncertain-submit reconciliation.

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

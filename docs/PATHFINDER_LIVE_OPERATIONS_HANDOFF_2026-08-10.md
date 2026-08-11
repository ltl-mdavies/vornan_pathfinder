# Pathfinder live operations handoff — 2026-08-10

## Mission

This document is the current operational handoff for the live Momentara-to-Lift path. It replaces launch-era assumptions that scheduled intake only created previews or required a human to submit every discovered order.

## Verified production state

Read-only AWS inspection on 2026-08-10 confirmed:

- API stack `vornan-pathfinder-api-prod`: `UPDATE_COMPLETE`.
- EventBridge rule `vornan-pathfinder-api-prod-wrike-scheduled-intake`: `ENABLED`, `rate(15 minutes)`.
- scheduled customer: `284619`;
- scheduled Import Method: `method-1784901795973`;
- maximum candidates per cycle: `25`;
- scheduled intake: enabled;
- scheduled Lift submission: enabled;
- scheduled Wrike status writeback: enabled;
- external Lift submit: enabled;
- live Lift transport: enabled;
- live-customer submit: enabled;
- workbook evidence and qualified reference-document evidence: enabled;
- direct document publication base: `https://go.vornan.co`;
- Wrike connection test: enabled;
- manual intake, discovery preview, and rehearsal gates: disabled.

The API errors, throttles, scheduled-candidate-failure, and scheduled-invocation alarms were all `OK` at reconciliation time. Alarm state is evidence at a moment in time, not a perpetual health guarantee.

## Production flow

1. EventBridge invokes the scheduled intake every 15 minutes.
2. Pathfinder scans the configured GPA Campaigns boundary for eligible Placard Order tasks.
3. Up to 25 candidates are processed independently. A failure in one candidate must not prevent the others from progressing.
4. A qualified workbook and at most one qualified reference PDF are captured, version-bound, and published as immutable direct HTTP 200 documents through `go.vornan.co`.
5. Each candidate produces or replays its own preview job. Exact evidence and idempotency identities prevent blind duplicate submission.
6. A Ready live-customer job may submit to Lift through the live transport.
7. Pathfinder reconciles the Lift order number and creates the tokenized status page.
8. The scheduled path posts the success comment to the exact Wrike Placard Order task.

Lift submission must never be retried blindly after a network timeout or ambiguous response. Reconcile by Ext_ID and authoritative Lift state first.

## Current recovery behavior

The `codex/pathfinder-operations-control-plane` repository checkpoint adds an explicit operator recovery path for a Wrike `Needs Mapping` or blocked `Failed` job. It recomputes the existing job from its original source rows and current product mappings while retaining the job ID, Pathfinder Order Number, canonical order ID, Lift Ext_ID, Wrike task/evidence identity, publications, and scheduler marker. The job receives a nontechnical recovery audit entry.

This recovery refuses to run if the job or any sibling for the same Wrike source task has an associated Lift order or any submit attempt beyond the known pre-transport `Blocked` / `Gate Locked` states. A `Submission Uncertain` or other possible transport attempt always requires reconciliation and is never retried automatically.

The same checkpoint also adds:

- Jobs-list refresh every 15 seconds only while a Jobs view and browser tab are visible;
- a bounded **Run discovery now** control inside the saved active Wrike Import Method;
- reuse of the scheduled discovery, qualification, evidence, `go.vornan.co` publication, and preview-preparation service path for operator discovery;
- an explicit guarantee that operator discovery does not submit to Lift, post a Wrike status, or mark jobs for immediate scheduled submit;
- a pending-intake view for order-like tasks found in configured roots but blocked by task identity, ready status, Print Vendor, or Contract Number, with actionable operator messages;
- sanitized discovery and mapping-recovery audit events.

The repository checkpoint is not merged or deployed as of 2026-08-11. The verified production parameters and behavior above remain unchanged. A later deployment must preserve every scheduler, Lift, publication, writeback, and persistence parameter and must complete the deployment guardrails below.

### Lift order-date output correction

The same draft checkpoint now corrects the Lift order-date boundary after production evidence showed a two-digit source year such as `26` could be interpreted by Lift as year `0026`.

- Lift targets expose an **Order Date Format** setting with `MM/DD/YYYY` and `YYYY-MM-DD` choices.
- Existing Lift targets without the new setting normalize compatibly to the required `MM/DD/YYYY` production default; deploying code does not rewrite the stored target record.
- `order.requested_ship_date` and `order.due_date` are formatted after output-template mappings and before value normalization, so the stored preview shows the exact value intended for Lift.
- The HTTP request builder applies the same formatter again as a defensive boundary for previously prepared jobs.
- `M/D/YY`, `MM/DD/YYYY`, and ISO `YYYY-MM-DD` inputs are accepted; a two-digit year is expanded into the 2000s and month/day are zero-padded.
- Impossible or unrecognized dates fail closed before Lift transport with a field-specific operator message.
- A changed request still passes through the existing reviewed-payload fingerprint and submit-idempotency controls. No uncertain Lift write is automatically retried.

This correction is repository-only and is not active in production. Before deployment, inspect one non-transport preview containing both date fields and confirm `MM/DD/YYYY`; do not submit a customer order solely as a smoke test.

The discovery fingerprint still includes the route-wide mapped-product set. A mapping change can therefore invalidate more previews than the exact product dependency requires. The explicit recovery control updates one intended blocked job in place, but dependency-aware discovery invalidation remains hardening debt.

Known hardening debt:

- replace route-wide invalidation with dependency-aware invalidation based on the product keys actually used by each job;
- persist discovery-run history beyond structured runtime audit logs so earlier pending-intake snapshots can be compared in the UI;
- add dependency-aware supersession labels for any replacement jobs created outside the explicit in-place recovery control;
- extend guided recovery beyond product mappings to other known-safe pre-transport validation failures;
- add success/failure notifications that do not require daily babysitting.

## Newly confirmed Momentara requirements — 2026-08-10

These requirements were confirmed after the production-state reconciliation and are implemented by the additive multi-root/text-quantity checkpoint. Production activation remains a separate, recoverable configuration change after the compatible API/Admin deployment.

### Multiple campaign roots

Momentara may place otherwise identical Placard Order campaigns beneath more than one Wrike parent folder. The confirmed roots include GPA Campaigns (`34000804`) and IBA Campaigns (`49405755`).

Implemented contract:

- replace the Import Method's single campaign-folder setting with an ordered, user-configurable set of up to ten Wrike folder IDs;
- migrate the existing GPA folder into that set without changing its identity;
- add the confirmed IBA folder through the authenticated folder picker rather than hard-coding a display name;
- run the same discovery, qualification, workbook, mapping, submit, and writeback contract for every configured root;
- deduplicate by exact Wrike task/evidence identity if roots overlap or a task is visible through more than one Wrike hierarchy;
- report candidate and failure counts by root so one inaccessible folder does not silently hide orders or stop the other roots.

The saved legacy `folder_id` remains the first configured root for backward compatibility. Deploying this code does not itself add IBA or alter the live GPA scope.

The first rollout should add IBA alongside GPA while preserving the currently working GPA production path.

### `TBD` hardware quantities

Momentara may enter `tbd` or `TBD` in a hardware quantity cell when the final quantity is not yet known. For Lift order creation, this value must become numeric quantity `0.5`.

This should be an Import Method normalization rule, scoped to the configured workbook section and quantity column, rather than a global hard-coded workbook exception. The initial rule is:

- trim whitespace and compare case-insensitively;
- `tbd` → canonical quantity `0.5`;
- positive numeric values → preserve the numeric value;
- blank or numeric zero → exclude the row under the existing order-line eligibility rule;
- any other nonnumeric token → block that candidate with an actionable validation message.

The canonical order, validation, preview, and Lift payload layers must preserve `0.5` without integer coercion or rounding. UI preview and certification must make the transformation visible so an operator can distinguish an intentional TBD placeholder from a real half-unit order.

The workbook setup now exposes **Text Quantity Rules** per detected section. The persisted parsed row records the original matched text, configured rule, and resolved numeric quantity. This provides replay/audit evidence without changing other sections or accepting arbitrary fractional source quantities.

Required regressions include hardware and non-hardware sections, whitespace/case variants, blank/zero exclusion, unsupported text, fractional payload preservation, replay stability, and simultaneous discovery from GPA and IBA roots.

### Safe production activation sequence

1. Capture named backups of every production Pathfinder DynamoDB table and record the deployed commit and stack parameters.
2. Deploy the backward-compatible API/Admin artifact while preserving all current scheduler, submit, writeback, publication, and data-store parameters.
3. Verify the existing GPA-only method still normalizes to one root and the scheduler completes normally.
4. Add IBA folder `49405755` beside GPA `34000804`, then run a bounded read-only discovery preview before the next scheduled cycle. Confirm per-root counts and task deduplication.
5. Add `TBD → 0.5` only to the actual hardware section/quantity column. Re-detect the saved source workbook and verify blank/zero rows are excluded, `TBD` rows show the transformation evidence, and unsupported text blocks with an actionable reason.
6. Save once, verify the stored Import Method can be read back exactly, then monitor the next scheduler cycle, alarms, created/replayed jobs, Lift submits, and Wrike writebacks.

## Manual recovery rules

### Mapping failure

1. Preserve the Wrike task ID, workbook evidence identity, job ID, Ext_ID, and unresolved product key.
2. Map the exact customer key to the correct stable Lift `product_id`.
3. Reprocess from the original immutable evidence. Do not edit a stored payload by hand.
4. Confirm the replacement job is Ready and contains the expected line/product resolution.
5. Before submitting, search all jobs and Lift for the same source evidence and Ext_ID.
6. Submit once. Reconcile the Lift order, status link, and Wrike comment.

### Ambiguous Lift submit

1. Do not retry.
2. Search Lift using the exact Ext_ID and any returned order number.
3. If the order exists, manually associate the Pathfinder job using the audited Lift-order override flow.
4. If no order is found after the bounded reconciliation period, escalate with the request correlation and evidence digest before deciding whether a new submission identity is required.

### Wrike writeback failure

1. Confirm the Lift order and status link are valid before any comment action.
2. Confirm the exact Wrike Placard Order task and current integration identity.
3. Use the durable writeback state. Never post a second comment merely because the first response was ambiguous.

## Data durability

Production configuration and job state must be treated as irreplaceable operational data. Do not seed, overwrite, or replace production tables during deployment. Deployment verification must confirm existing customer, target, route, template, Import Method, product mapping, and job counts remain present.

Before material migrations:

- capture a named point-in-time or export appropriate to each backing store;
- record the deployed commit and stack parameters;
- test restoration into an isolated environment;
- preserve audit history and stable identifiers.

Product mapping identity is the Lift `product_id`; Lift product-name changes should refresh the display name without changing the mapping identity.

## Deployment guardrails

Any API deployment must preserve the live Wrike and Lift parameters above unless the change explicitly intends to alter production intake. Immediately after deployment:

1. verify the EventBridge rule is enabled at 15 minutes;
2. verify scheduled intake, submit, and writeback remain true;
3. verify live transport and live-customer submit remain true;
4. verify document publication and the `go.vornan.co` base remain configured;
5. verify the Wrike OAuth connection and a read-only identity check;
6. verify alarms and the most recent scheduler cycle;
7. verify no configuration or product-map data was replaced.

Proof work must not change these production capabilities unless the same checkpoint explicitly includes and verifies the Pathfinder deployment impact.

# Pathfinder live operations handoff — 2026-08-10

## Mission

This document is the current operational handoff for the live Momentara-to-Lift path. It replaces launch-era assumptions that scheduled intake only created previews or required a human to submit every discovered order.

## Verified production state

Read-only AWS inspection after the 2026-08-11 operations release confirmed:

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

The saved production Wrike Import Method contains both GPA Campaigns (`34000804`) and IBA Campaigns (`49405755`). Its `Order Form` hardware section (`order-form-hardware-13`, quantity column `Qty. Needed`) stores the scoped text-quantity rule `TBD` → `0.5`.

### 2026-08-11 operations release record

- merged repository commit: `677005c5bf8910a931eeadfa878ba6f80204b97c` (PR #178);
- API deployment workflow run: `31505325973`;
- API artifact: `api/pathfinder-api-lambda-677005c5bf8910a931eeadfa878ba6f80204b97c.zip`, S3 version `hzZsaTyRWf.Y2DZFEHUzhQtuvkCeKiq_`, ETag `1f44f3c2af80d24ac9dd0eaa73b835d7`;
- deployed Lambda code SHA-256: `el2NRy2kCqo8wfRyVRLwnYIlkWoYoQ/X6GNoaFfGqGk=`;
- Admin deployment workflow run: `31506038490`;
- Admin `index.html` S3 version: `HmG2E7dyVFYN74vFFJz.Cn5cp4V8a7Iv`, ETag `c9046fbed0bd4348a14862ab03b955f2`;
- CloudFront invalidation: `I36RPR33DG8DCG2NNCQ2ZUSZIV` (`Completed`).

The API stack returned to `UPDATE_COMPLETE`, health returned HTTP 200, and all thirteen predeployment object counts were unchanged. The first observed new-code scheduler cycle completed with six candidates replayed, zero submissions, zero writebacks, and zero failures. The first cycle after Admin deployment completed at `2026-08-11T15:28:10.203Z` with the same six replays and no submissions, writebacks, or failures. All live scheduler, Lift, publication, writeback, authentication, and persistence parameters were preserved. The disabled Proof asset-scan worker remained disabled and uninvokable.

The API errors, throttles, scheduled-candidate-failure, and scheduled-invocation alarms were all `OK` at reconciliation time. Alarm state is evidence at a moment in time, not a perpetual health guarantee.

### Persistent scheduler preparation incident — 2026-08-11

The cycles checked at `2026-08-11T15:42:53.213Z` (`a58db8a6-51fc-414d-a2f0-d33dabfcab96`) and `15:57:54.333Z` (`af8bbf31-b534-423c-8f77-a0c156cc47e3`) each reported seven contract-ready candidates, six replays, and one preparation failure. The candidate-failure alarm entered `ALARM`.

Read-only reconciliation confirmed:

- no new job, order identity, submit attempt, status record, source-evidence version, Lift submission, or Wrike writeback;
- only the six known replayed jobs had their scheduled discovery timestamps refreshed;
- the failed task is not provable from deployed aggregate logs; two older blocked task identities remain plausible, but a new pre-evidence failure cannot be excluded;
- no recovery or replay is authorized while the task identity and failure reason remain unknown.

The bounded scheduler-telemetry checkpoint adds a sanitized `candidate_failure_details` collection to the existing completion event. It records only the failure stage, stable reason code, validated Wrike task ID, and validated existing job/evidence identifiers. Identifier arrays and total details are capped; exception messages, contract/customer values, filenames, URLs, payloads, credentials, and attachment contents are never emitted. Submit and writeback failures retain the same safe job-level boundary. This capability is repository-only until the shared API is deliberately deployed with all live Pathfinder parameters preserved.

## Production flow

1. EventBridge invokes the scheduled intake every 15 minutes.
2. Pathfinder scans every configured campaign root for eligible Placard Order tasks. Production currently includes the GPA and IBA roots above.
3. Up to 25 candidates are processed independently. A failure in one candidate must not prevent the others from progressing.
4. A qualified workbook and at most one qualified reference PDF are captured, version-bound, and published as immutable direct HTTP 200 documents through `go.vornan.co`.
5. Each candidate produces or replays its own preview job. Exact evidence and idempotency identities prevent blind duplicate submission.
6. A Ready live-customer job may submit to Lift through the live transport.
7. Pathfinder reconciles the Lift order number and creates the tokenized status page.
8. The scheduled path posts the success comment to the exact Wrike Placard Order task.

Lift submission must never be retried blindly after a network timeout or ambiguous response. Reconcile by Ext_ID and authoritative Lift state first.

## Current recovery behavior

The deployed operations control plane adds an explicit operator recovery path for a Wrike `Needs Mapping` or blocked `Failed` job. It recomputes the existing job from its original source rows and current product mappings while retaining the job ID, Pathfinder Order Number, canonical order ID, Lift Ext_ID, Wrike task/evidence identity, publications, and scheduler marker. The job receives a nontechnical recovery audit entry.

This recovery refuses to run if the job or any sibling for the same Wrike source task has an associated Lift order or any submit attempt beyond the known pre-transport `Blocked` / `Gate Locked` states. A `Submission Uncertain` or other possible transport attempt always requires reconciliation and is never retried automatically.

The deployed release also adds:

- Jobs-list refresh every 15 seconds only while a Jobs view and browser tab are visible;
- a bounded **Run discovery now** control inside the saved active Wrike Import Method;
- reuse of the scheduled discovery, qualification, evidence, `go.vornan.co` publication, and preview-preparation service path for operator discovery;
- an explicit guarantee that operator discovery does not submit to Lift, post a Wrike status, or mark jobs for immediate scheduled submit;
- a pending-intake view for order-like tasks found in configured roots but blocked by task identity, ready status, Print Vendor, or Contract Number, with actionable operator messages;
- sanitized discovery and mapping-recovery audit events.

These controls are live as of 2026-08-11. The authenticated production Admin smoke confirmed the visible Jobs refresh indicator, the **Run discovery now** control, and the Lift target's effective `MM/DD/YYYY` date format without saving configuration or running discovery.

### Lift order-date output correction

The deployed release corrects the Lift order-date boundary after production evidence showed a two-digit source year such as `26` could be interpreted by Lift as year `0026`.

- Lift targets expose an **Order Date Format** setting with `MM/DD/YYYY` and `YYYY-MM-DD` choices.
- Existing Lift targets without the new setting normalize compatibly to the required `MM/DD/YYYY` production default; deploying code does not rewrite the stored target record.
- `order.requested_ship_date` and `order.due_date` are formatted after output-template mappings and before value normalization, so the stored preview shows the exact value intended for Lift.
- The HTTP request builder applies the same formatter again as a defensive boundary for previously prepared jobs.
- `M/D/YY`, `MM/DD/YYYY`, and ISO `YYYY-MM-DD` inputs are accepted; a two-digit year is expanded into the 2000s and month/day are zero-padded.
- Impossible or unrecognized dates fail closed before Lift transport with a field-specific operator message.
- A changed request still passes through the existing reviewed-payload fingerprint and submit-idempotency controls. No uncertain Lift write is automatically retried.

This correction is active in production. Existing targets without a stored `order_date_format` use the runtime default `MM/DD/YYYY`; deployment did not rewrite the production target record. The authenticated Admin smoke confirmed that effective selection. Confirm the formatted fields on the next naturally occurring prepared order; do not submit a customer order solely as a smoke test.

The discovery fingerprint still includes the route-wide mapped-product set. A mapping change can therefore invalidate more previews than the exact product dependency requires. The explicit recovery control updates one intended blocked job in place, but dependency-aware discovery invalidation remains hardening debt.

Known hardening debt:

- replace route-wide invalidation with dependency-aware invalidation based on the product keys actually used by each job;
- persist discovery-run history beyond structured runtime audit logs so earlier pending-intake snapshots can be compared in the UI;
- add dependency-aware supersession labels for any replacement jobs created outside the explicit in-place recovery control;
- extend guided recovery beyond product mappings to other known-safe pre-transport validation failures;
- add success/failure notifications that do not require daily babysitting.
- persist scheduler candidate failures in durable audit history after the sanitized log contract is proven in production.

## Newly confirmed Momentara requirements — 2026-08-10

These requirements are implemented in the deployed runtime and configured in production. Multi-root discovery contains the GPA and IBA roots, and the text-quantity rule is scoped to the hardware section described below.

### Multiple campaign roots

Momentara may place otherwise identical Placard Order campaigns beneath more than one Wrike parent folder. The confirmed roots include GPA Campaigns (`34000804`) and IBA Campaigns (`49405755`).

Implemented contract:

- replace the Import Method's single campaign-folder setting with an ordered, user-configurable set of up to ten Wrike folder IDs;
- migrate the existing GPA folder into that set without changing its identity;
- add the confirmed IBA folder through the authenticated folder picker rather than hard-coding a display name;
- run the same discovery, qualification, workbook, mapping, submit, and writeback contract for every configured root;
- deduplicate by exact Wrike task/evidence identity if roots overlap or a task is visible through more than one Wrike hierarchy;
- report candidate and failure counts by root so one inaccessible folder does not silently hide orders or stop the other roots.

The saved legacy `folder_id` remains the first configured root for backward compatibility. Production already contained IBA alongside GPA at the predeployment baseline, and both roots remained unchanged after deployment.

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

### Current text-quantity configuration

A strongly consistent production read on 2026-08-11 confirmed the rule at:

`source_config.workbook_structure["Order Form"].sections[1].quantity_value_rules[0]`

with `source_value: "TBD"` and `output_quantity: 0.5`. The section is `order-form-hardware-13`, `line_kind: "hardware"`, quantity column `Qty. Needed`. The detected-schema copies contain the same rule; all current print sections have empty `quantity_value_rules` arrays. The Import Method item timestamp `2026-08-11T14:58:03.543Z` predates both deployments, so neither deployment wrote this configuration.

Any future change must first capture a recoverable snapshot, preserve both campaign roots, remain scoped to the intended section and quantity column, verify the stored method can be read back exactly, and monitor the next scheduler cycle and external side effects.

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

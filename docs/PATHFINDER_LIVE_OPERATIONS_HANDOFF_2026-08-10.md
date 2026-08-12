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

### 2026-08-11 multi-reference-proof release and 2026-08-12 continuity record

- merged repository commit: `b6794380e44d3ca1ab22add3151525589ba6770c` (PR #184);
- API deployment workflow run: `31527788915`, job `93900238228`;
- API artifact: `api/pathfinder-api-lambda-b6794380e44d3ca1ab22add3151525589ba6770c.zip`, S3 version `Y8Y8NBj6x7qBumiV64guoBCWt3QAJjgc`, ETag `d5f3ca84965ae06f15deae8efe548bde`;
- deployed Lambda code SHA-256: `rifTSMHHDrWBHXPIZWJCCgt7oXU/xlRVYZxGZ+qwjpE=`;
- Admin deployment workflow run: `31528125205`, job `93901347296`;
- Admin `index.html` S3 version: `TkcP9i3Lpo0G9E4dDJxjXK3MhFitAagi`, ETag `728d4cb30e524289d40fcff890e08ea8`;
- CloudFront invalidation: `IASV9IHL8TN6MDZCFWDSBWBWQ9` (`Completed`);
- pre-activation Import Method backup: `Pathfinder-ImportMethods-prod-pre-multi-proof-20260811T1932Z`, ARN `arn:aws:dynamodb:us-east-1:744016783602:table/Pathfinder-ImportMethods-prod/backup/01786476741396-957c1c6b` (`AVAILABLE`, 33,601 bytes).

The API stack returned to `UPDATE_COMPLETE`, API and Admin health returned HTTP 200, and all live scheduler, Lift, publication, writeback, authentication, and persistence gates were preserved. The disabled Proof asset-scan worker remained disabled. The production Momentara Import Method was then updated through authenticated Admin from `single_current_attachment` to `all_matching_current_attachments`, with archive convention `<contract_number>_referenceProofs.zip`. Both campaign roots, Wrike connection, `Sent to Print - LTL` status, `xlsx` workbook rule, `proof` PDF match, output route, mappings, and scoped `TBD` → `0.5` rule were read back unchanged.

Code normalization after API deployment created five Ready replacement previews at `19:28Z`; the explicit configuration change created five more at `19:43Z`. Jobs therefore changed from 45 to 55 and Order IDs from 48 to 58. Customer, workspace, target, Import Method, route, product-mapping, submit-attempt, product-cache, status-token, status-snapshot, and canonical-registry counts remained unchanged. Each replacement retained its source task/evidence identity, and cross-job submit idempotency replayed all five rather than creating a Lift order.

From the first post-activation completion at `2026-08-11T19:43:11Z` through the read-only continuity cutoff `2026-08-12T15:35:43Z`, EventBridge produced 80 invocations and 80 matching completions at an average 899.99-second cadence. All cycles found exactly five qualified candidates. Aggregate results were five prepared previews, 395 discovery replays, 400 Lift-submit replays, zero Lift submissions, zero Wrike writebacks, zero failed invocations, and zero candidate failures. The latest checked cycle was correlation `7e25c973-6d51-413b-948f-be17e065edaf` at `2026-08-12T15:27:54.319Z`. All Pathfinder alarms were `OK` at the cutoff.

Authenticated bounded discovery `wrike_discovery_20260812153516359_aa7ed6` at `2026-08-12T15:35:16.360Z` reused all five qualified previews, created zero new previews, and returned the capped 100 pending candidates. It submitted no Lift order and changed no Wrike status. The five qualified tasks reconcile by campaign name to existing confirmed Lift orders:

| Wrike task | Campaign | Lift order |
|---|---|---|
| `MAAAAAEN2RMG` | Visit Montana 2026 | `A0228214` |
| `MAAAAAEN2Ujj` | MDHHS – Eat Safe Fish FY 26 | `A0228322` |
| `MAAAAAEN89Aq` | Fair Housing Commission – Indoor | `A0228278` |
| `MAAAAAENo9lH` | Comcast – Big South Region – Network Expansion | `A0228190` |
| `MAAAAAENStDv` | ALDI – HIN Store x3763 – Recruitment | `A0228162` |

There is no production evidence of a missed qualified order at this checkpoint. A task can still be visible in a campaign root but remain pending until its title/type, ready status, Print Vendor, and Contract Number satisfy the saved contract.

### 2026-08-12 source-order clarity release record

- merged repository commit: `fa1ed4389720bb4f2d1119794845e72af21de1ca` (PR #186);
- merged-main validation: workflow `31620622455`, job `94194268574` (`success`);
- API deployment: workflow `31621165048`, job `94196081887`;
- API artifact: `api/pathfinder-api-lambda-fa1ed4389720bb4f2d1119794845e72af21de1ca.zip`, S3 version `YktOP79tJebDf66slbHcxGJXmU_EfRRF`, ETag `f7961f07addeaad403df3ae96e69bebf`;
- deployed Lambda SHA-256: `yPi7qpFVJKOVWbiCTnp4SIbfCmdLSHcz/+DoRG6dAM0=`; revision `50b09b20-b613-482b-b45e-0045d6a42c76`;
- Admin deployment: workflow `31621719707`, job `94197937128`;
- Admin `index.html`: S3 version `gX5XENbtIDp2q6xPiiadjyLqFNraPn62`, ETag `83e2cb9f3fec88f500aa0e1604750131`;
- Admin entrypoint/app bundles: `assets/index-Cd9-qcYZ.js` / `assets/App-BFf2_1FJ.js`;
- CloudFront invalidation: `ICVLUE4O4PXS3JV36XUO7SC6I3` (`Completed`).

The API stack returned to `UPDATE_COMPLETE`; only `LambdaCodeS3Key` changed among parameters. The executed change set modified Lambda code plus dependent API/EventBridge bindings and did not replace or change a data resource. HTTP health returned 200. Scheduled intake/submit/writeback, live Lift transport and live-customer submission, workbook evidence, `go.vornan.co` publication, authentication, both campaign roots, multi-proof selection/template, and scoped `TBD` → `0.5` remained unchanged. Every shared-API Proof gate remained false, while dedicated Proof public read remained active through `2026-08-25T23:59:59Z` with its mutation gates dark.

All protected counts were identical before and after deployment: Customers 1, CustomerWorkspaces 1, Targets 2, ImportMethods 2, OutputRoutes 1, ProductMappings 278, Jobs 55, OrderIds 58, SubmitAttempts 18, LiftProductCache 337, OrderStatusTokens 19, OrderStatusSnapshots 11, CanonicalRegistry 1, ProofCore-dev 142, and ProofAudit-dev 147.

Authenticated production Admin verification confirmed:

- visible-only Jobs auto-refresh and six nontechnical state choices;
- exactly one visible MDHHS source-order row, `JOB-280569` / Ext_ID `PFMSOZTWDUAF53` / Lift `A0228322`;
- campaign `MDHHS - Eat Safe Fish FY 26 - GPA - C316969` and Lift name `C316969 - Momentara Web Order - 20260811`;
- three retained Ready siblings nested under **Source order activity**, not listed as new Jobs;
- preserved original uncertain attempt, verified Lift association, nine lines, and confirmed identity;
- safe **Run discovery now** control, both roots, multi-proof ZIP selection/template, and visible scoped `TBD` → `0.5` rule.

No discovery control or job action was invoked during deployment verification. The pending-candidate tabs, pagination, and two-of-three explanation are present in the deployed bundle but render only after a discovery result exists in that browser session.

The first two natural post-API scheduler cycles completed cleanly:

| Correlation | Checked | Discovered / replayed | New jobs | Lift submits | Wrike writes | Failures |
|---|---|---:|---:|---:|---:|---:|
| `52038d33-c022-4c18-bf99-88fd1b97a537` | `2026-08-12T17:12:53.127Z` | 5 / 5 | 0 | 0 | 0 | 0 |
| `82c86045-ca75-4b61-ad0d-7a69bf155bcc` | `2026-08-12T17:27:53.124Z` | 5 / 5 | 0 | 0 | 0 | 0 |

API errors, throttles, scheduled-candidate-failure, and scheduled-failed-invocation alarms were `OK` at release closure. The first natural two-or-more-proof order still needs the existing read-only ZIP identity/publication/Lift/writeback validation packet; do not create a customer smoke order to force it.

Rollback is application-only: restore the previous API artifact at `b6794380e44d3ca1ab22add3151525589ba6770c` (S3 version `Y8Y8NBj6x7qBumiV64guoBCWt3QAJjgc`, Lambda SHA `rifTSMHHDrWBHXPIZWJCCgt7oXU/xlRVYZxGZ+qwjpE=`) and previous Admin `index.html` version `TkcP9i3Lpo0G9E4dDJxjXK3MhFitAagi`, then invalidate CloudFront. Do not restore or replace production tables, and do not change the active multi-proof Import Method setting as part of this code rollback.

### Persistent scheduler preparation incident — 2026-08-11

The cycles checked at `2026-08-11T15:42:53.213Z` (`a58db8a6-51fc-414d-a2f0-d33dabfcab96`) and `15:57:54.333Z` (`af8bbf31-b534-423c-8f77-a0c156cc47e3`) each reported seven contract-ready candidates, six replays, and one preparation failure. The candidate-failure alarm entered `ALARM`.

Pre-telemetry read-only reconciliation confirmed:

- no new job, order identity, submit attempt, status record, source-evidence version, Lift submission, or Wrike writeback;
- only the six known replayed jobs had their scheduled discovery timestamps refreshed;
- the failed task was not provable from the then-deployed aggregate logs;
- no recovery or replay was authorized while the task identity and failure reason remained unknown.

PR #181 deployed the sanitized `candidate_failure_details` contract at merge `cb237d379210c826cfdd16431482821488c343e4`. PR #182 corrected the fallback to prefer a validated structured error code and deployed at merge `4acbc0eea1366376cee740a3ba0c9072025974b0`. The final API artifact is `api/pathfinder-api-lambda-4acbc0eea1366376cee740a3ba0c9072025974b0.zip`, S3 version `xrT0h1dVCwoK99PHYIGq4r61p5Y9UE0y`, ETag `dbf9e332dea36f5c04348b483c8ce3ce`, and Lambda code SHA-256 `6iWcDDOsLk7rCMx5TOUdxOsSXQ/QbSEYq3ahxs4LEgE=`.

The first authoritative post-fix cycle checked at `2026-08-11T17:12:53.209Z` (`a15a93c9-64f4-4d5b-8ee5-f2544d955418`) identified task `MAAAAAEN2Ujj`, stage `prepare`, reason `attachment_validation_failed`, with no job/evidence IDs. Operator inspection then established the leaf cause: two legitimate PDFs matched the saved optional-single-proof rule. Momentara temporarily deleted both and uploaded one combined proof. The next natural path qualified the task and created `JOB-280569` from workbook attachment `IEAALTG3IYWVIVQG`.

Lift accepted Ext_ID `PFMSOZTWDUAF53` as order `A0228322`, but Pathfinder timed out and retained the attempt as `Submission Uncertain`. Live Support used Lift's import log plus the supported verified-association flow to link the existing order at `2026-08-11T18:54:43.225Z` (association `loa_d71971ce58efdd98d9371434c0aa43398eb88d17698f75913ca0074049752f1d`). No create-order retry or direct DynamoDB edit occurred. Scheduler correlation `02f1a162-2534-4d91-b072-3eec0a4a5fd2` completed at `2026-08-11T18:58:23.836Z` with zero Lift submits, five replays, one eligible/posted Wrike comment, and zero candidate failures. Writeback `wsw_97e0c0e3fcd24b7b31f93d55670dcc59dd8ae515cda11a11f4ca52cbb7a7093e` posted comment `IEAALTG3IM5L66U4`; Wrike remained `Sent to Print - LTL`. The original uncertain attempt remains immutable history.

Three retained Ready siblings for C316969 have the same source-evidence identity, no association, and no submit attempts: `job_20260811184302_9b59b9`, `job_20260811192804_cc0adc`, and `job_20260811194303_68f7fa`. The scheduler duplicate guard continually replays the newest without submitting. They are not an immediate duplicate-order risk, but normalizing or removing them requires separate explicit authorization.

The deployed telemetry records only failure stage, stable reason code, validated task ID, and validated existing job/evidence identifiers. Identifier arrays and total details are capped; exception messages, contract/customer values, filenames, URLs, payloads, credentials, and attachment contents are never emitted. Submit and writeback failures retain the same safe job-level boundary.

## Production flow

1. EventBridge invokes the scheduled intake every 15 minutes.
2. Pathfinder scans every configured campaign root for eligible Placard Order tasks. Production currently includes the GPA and IBA roots above.
3. Up to 25 candidates are processed independently. A failure in one candidate must not prevent the others from progressing.
4. A qualified workbook and the configured qualified reference-document set are captured and version-bound. One matching PDF is published unchanged; when the active multi-proof policy finds two to ten PDFs, each source is retained and one deterministic ZIP is published as an immutable direct HTTP 200 document through `go.vornan.co`.
5. Each candidate produces or replays its own preview job. Exact evidence and idempotency identities prevent blind duplicate submission.
6. A Ready live-customer job may submit to Lift through the live transport.
7. Pathfinder reconciles the Lift order number and creates the tokenized status page.
8. The scheduled path posts the success comment to the exact Wrike Placard Order task.

Lift submission must never be retried blindly after a network timeout or ambiguous response. Reconcile by Ext_ID and authoritative Lift state first.

### Active multi-reference-proof ZIP capability

Momentara confirmed that a Placard Order commonly and legitimately contains two or more reference-proof PDFs. An authenticated Lift test on 2026-08-11 confirmed that the existing reference-proof URL field accepts a downloadable ZIP URL.

The Wrike Import Method exposes an explicit selection:

- `single_current_attachment` retains the fail-closed single-proof behavior and blocks when more than one PDF matches;
- `all_matching_current_attachments` accepts two to ten current matching PDFs;
- every PDF is validated and stored separately under its Wrike attachment/version evidence identity;
- one matching PDF remains an unchanged direct PDF publication;
- two or more matching PDFs are ordered deterministically, stored without lossy transformation in one ZIP, and published through the existing immutable `go.vornan.co` path;
- the configurable archive convention must contain `<contract_number>` exactly once and end in `.zip`; the default is `<contract_number>_referenceProofs.zip`;
- the ZIP publication records the complete source-evidence ID set, which is included in submit-integrity review;
- workbook/task identity remains the order identity, so proof count does not create a second order;
- the same scheduled/manual preparation service path is used, and uncertain Lift writes remain non-retryable.

This option is deployed and explicitly enabled for Momentara as recorded above. Existing saved methods without the explicit selection still normalize to the fail-closed single-proof policy. Roll back Momentara by restoring `attachment_selection: single_current_attachment` through authenticated Admin; restore the named DynamoDB backup only as a disaster-recovery operation because it contains the whole Import Methods table.

## Current recovery behavior

### Active source-order clarity and candidate visibility

This behavior is active in production at `fa1ed4389720bb4f2d1119794845e72af21de1ca` and was validated as recorded above.

Active behavior:

- one stable source-order key uses customer, Import Method, Wrike account, and exact Placard Order task ID; workbook evidence and Import Method fingerprints are version history, not new operator-facing orders;
- safe pre-transport evidence/mapping changes recompute the existing job in place while preserving job ID, Pathfinder Order Number, canonical order ID, Lift Ext_ID, publications, scheduler marker, and bounded source-order history;
- a confirmed Lift order or any possible submit transport makes that source-order record authoritative; later Wrike versions are logged for operator review and stop before new document publication or Lift transport;
- the Jobs API projects one authoritative row per source order and nests retained technical siblings in job detail rather than presenting them as new Jobs;
- Admin state labels become **Ready to Submit**, **Confirmation Needed**, and **Order Confirmed**, with state filtering and compact Wrike Contract/campaign plus Lift order number/name identity;
- exact qualified task evidence retains bounded task title and best-effort immediate campaign-folder ID/name for reconciliation display, while exact task/folder IDs remain authoritative;
- pending intake contains only exact Placard Order tasks, exposes the full bounded discovery result rather than a 100-item task-ID slice, and sorts a visibility-only **Likely candidates** subset first when at least two of ready status, Print Vendor, and Contract Number are present;
- likely-candidate scoring never qualifies, prepares, publishes, submits, or writes back an order; all existing qualification requirements remain mandatory;
- multiple proof delivery remains the same already deployed shared scheduled/manual service path; sanitized telemetry adds only task ID, `pdf`/`zip` delivery kind, proof count, publication ID, and evidence count.

Continuing production acceptance:

1. preserve scheduled discovery, scheduled submit, status writeback, live transport/customer profile, `go.vornan.co`, both campaign roots, all mappings, and the scoped `TBD` → `0.5` rule;
2. verify a read-only Jobs response projects one row for the confirmed MDHHS source order while retaining its historical records in detail;
3. on the next explicitly authorized operator discovery or natural new candidate, confirm the candidate total is not truncated and that visibility-only scoring does not weaken qualification;
4. verify no existing job, order identity, submit attempt, publication, mapping, configuration, or audit history is deleted;
5. wait for a natural two-or-more-proof order and confirm the telemetry reports `zip` and the expected proof count without filenames, URLs, customer content, or a second Lift order;
6. after any ambiguous submit response, confirm the UI says **Confirmation Needed** and offers reconciliation rather than retry.

Rollback is application-code rollback to the recorded prior artifacts. Do not restore or replace production tables to roll back these presentation/projection changes. Because the data model is additive and retained raw records remain stored, rollback must preserve the source-order history fields and all existing records.

The deployed operations control plane adds an explicit operator recovery path for a Wrike `Needs Mapping` or blocked `Failed` job. It recomputes the existing job from its original source rows and current product mappings while retaining the job ID, Pathfinder Order Number, canonical order ID, Lift Ext_ID, Wrike task/evidence identity, publications, and scheduler marker. The job receives a nontechnical recovery audit entry.

This recovery refuses to run if the job or any sibling for the same Wrike source task has an associated Lift order or any submit attempt beyond the known pre-transport `Blocked` / `Gate Locked` states. A `Submission Uncertain` or other possible transport attempt always requires reconciliation and is never retried automatically.

The deployed release also adds:

- Jobs-list refresh every 15 seconds only while a Jobs view and browser tab are visible;
- a bounded **Run discovery now** control inside the saved active Wrike Import Method;
- reuse of the scheduled discovery, qualification, evidence, `go.vornan.co` publication, and preview-preparation service path for operator discovery;
- an explicit guarantee that operator discovery does not submit to Lift, post a Wrike status, or mark jobs for immediate scheduled submit;
- a pending-intake view for exact Placard Order tasks found in configured roots but blocked by ready status, Print Vendor, or Contract Number, with actionable operator messages;
- sanitized discovery and mapping-recovery audit events.

These controls are live as of 2026-08-11. The authenticated production Admin smoke confirmed the visible Jobs refresh indicator, the **Run discovery now** control, and the Lift target's effective `MM/DD/YYYY` date format without saving configuration or running discovery.

### Repository-ready Jobs triage continuation (not deployed)

The current Pathfinder development slice prepares the next bounded operations improvement without changing production gates, configuration, or external systems:

- global and customer Jobs views retain separate browser-local filter/sort choices and expose **Reset view**;
- the default useful view is Active / All intake / Current orders / Pathfinder intake / Descending;
- `created_at` is labeled **Pathfinder Intake** and `updated_at` is labeled **Last Activity**; Lift creation time is shown only after the existing read-only Lift order snapshot is loaded;
- a five-card triage strip distinguishes confirmed orders, likely Wrike intake review, Ready jobs waiting over 30 minutes, confirmation-needed submits, and failed/blocked jobs;
- scheduled and operator discovery reuse the existing shared service path and persist only one bounded latest operations snapshot on the Import Method for cross-session candidate review;
- the snapshot write is optimistic and conditional, does not update the saved method configuration timestamp, is excluded from the Import Method fingerprint, and fails non-blockingly so discovery/submit/writeback continuity is preserved;
- an older Admin form submission cannot overwrite the latest runtime snapshot;
- confirmed job detail adds a collapsed read-only comparison of canonical input lines, the reviewed Lift payload, and the current Lift order by stable line number;
- reconciled `Submission Uncertain` history remains immutable but displays recovery-complete language and explicitly says no retry is required;
- new confirmed associations capture additive `order_confirmed_at`; no existing job, order, attempt, mapping, publication, or audit record is rewritten or deleted.

This continuation is repository-ready only. Do not treat it as live until its merged commit, API-first/Admin-second deployment identifiers, parameter-preservation evidence, protected table counts, scheduler continuity, and authenticated read-only Admin smoke are appended here.

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
- update the Import Method **Last Run** surface on healthy replay-only scheduled cycles so it does not imply that polling stopped;
- show the latest safe pending-candidate snapshot before a new in-session discovery run; addressed in the repository-ready slice above but still live debt until deployed;
- specialize historical submit guidance after a `Submission Uncertain` attempt is reconciled to **Order Confirmed**; addressed in the repository-ready slice above but still live debt until deployed;
- persist discovery-run history beyond structured runtime audit logs so earlier pending-intake snapshots can be compared in the UI;
- keep retained sibling records as immutable history; do not delete them merely to clean the Jobs display;
- extend guided recovery beyond product mappings to other known-safe pre-transport validation failures;
- add success/failure notifications that do not require daily babysitting;
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

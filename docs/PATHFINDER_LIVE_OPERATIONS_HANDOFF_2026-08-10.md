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

### 2026-08-14 customer-workspace persistence incident

At approximately `2026-08-14T14:18:20Z`, authenticated Admin selection of `LTL Demo / 1249` invoked the deployed implicit workspace-creation path. The intended records were retained: Customers and CustomerWorkspaces increased from one to two, ImportMethods from two to three, and OutputRoutes from one to two. The new workspace contains the default `view_only` / `simple` Proof policy with no verified identity or override, one Active `manual-xlsx` method, and its own route with Live Customer and Sandbox `1249` profiles. ProductMappings remained 278; Jobs 56; OrderIds 59; SubmitAttempts 19; LiftProductCache 337; status tokens/snapshots 20/12; CanonicalRegistry 1; ProofCore/ProofAudit 142/147. Customer `1249` has zero Jobs and zero Submit Attempts. No preview, publication, Lift call, Wrike write, grant, or Proof action occurred.

The request nevertheless failed after exposing a raw DynamoDB `ProvisionedThroughputExceededException`. CloudWatch recorded exactly 21 `WriteThrottleEvents` on `Pathfinder-Jobs-prod` during the incident minute and zero protected-table read/write throttles elsewhere in the surrounding window. The deployed whole-store writer had already saved the four intended setup records, then attempted unbounded `PutItem` rewrites of all 56 Jobs and a replacement pass over the Lift product cache. Existing-workspace reads are now non-writing, but the deployed Import Method and Output Route save paths still reach that writer; the `1249` Proof pilot is stopped before either configuration save.

Three later authenticated catalog-refresh attempts reached the same whole-store writer through `upsertLiftProductCatalog`. User-confirmed Lift evidence for catalog `6338` contained 18 products, while strongly consistent production reads remained LiftProductCache 337 total / 334 catalog `8102` / zero catalog `6338`, with ProductMappings 278. Jobs recorded 28, 24, and 85 write throttles in the attempt windows; LiftProductCache and ProductMappings recorded zero. The writer rewrote Jobs before replacing the cache, so each request failed before cache persistence. Customer `1249` remains at zero Jobs and zero Submit Attempts, and no preview, Lift order, Wrike write, or Proof action occurred. Do not invoke another product refresh until the focused code is deployed and one exact `1249` / route / catalog-`6338` refresh is separately approved.

The repository incident fix, pending review/deployment, replaces these three paths with focused conditional transactions:

- workspace reads are read-only; a missing workspace returns a setup-required response and Admin requires an explicit **Set up workspace** confirmation;
- setup atomically creates only the exact Customer, CustomerWorkspace, seed Manual XLSX method, and seed Output Route and is idempotent when they already exist;
- Import Method saves write only the selected workspace and exact method;
- Output Route saves write only the selected workspace, exact route, and customer-local methods linked to that route;
- none of these paths can write Jobs, product cache, submit attempts, product mappings, another customer, or an external system;
- optimistic exact-data conditions return a nontechnical reload conflict rather than overwriting a concurrent save;
- sanitized telemetry records operation, outcome, hashed customer identity, and table classes only; API/UI errors never include an AWS exception, documentation URL, payload, credential, or table name and explicitly say no preview or Lift order was submitted.
- Lift product refresh normalizes the returned rows and additively upserts only exact LiftProductCache keys for the selected target/environment/company/product identity; it never calls the whole-store writer, scans or replaces the cache, or writes Jobs, mappings, workspace configuration, attempts, or another customer;
- catalog refresh telemetry records only a hashed route scope, safe catalog ID, fetched and definitely persisted counts, outcome, duration, and cache table class; completed batches count exactly, a failed batch is reconciled by strongly consistent reads of only its exact keys, and the response distinguishes partial persistence from an unverified remainder without exposing provider/Dynamo messages.

Preserve the current `1249` records exactly. Do not delete/reseed them, restore a table, reselect setup merely to test it, or resume configuration/Proof QA until the focused API/Admin release is separately approved and reconciled. Deployment acceptance must show the expected 2/2/3/2 customer/workspace/method/route counts, baseline LiftProductCache 337 / catalog `8102` 334 / catalog `6338` zero and ProductMappings 278, all gates preserved, zero new throttles from read-only smoke, and a natural Momentara scheduler cycle with normal idempotent behavior. A later separately authorized refresh must target only customer `1249`, route `route-ltl-lift-91-standard-graphics`, and catalog `6338`; reconcile its unique cache delta, preserve all 334 Momentara catalog rows and 278 mappings, prove zero Jobs writes/throttles, and confirm no preview/Lift/Wrike effect before deploying Admin.

### 2026-08-13 combined source-review and Proof foundation release record

Final deployed application commit: `9f78d2d4b122984c53bc3b96506588996768f5d0`. The release includes PRs #197, #199, #198, #200, #201, and #202. Merged-main validation `31740363776` / job `94581986809` succeeded.

Pathfinder adds a versioned stable Lift-impact assessment for post-transport Wrike replays, preserves the duplicate-order/no-retry boundary, and allows an authenticated operator to append an event-specific **No Lift update needed** or **Mark reviewed** disposition. A disposition changes only the exact Jobs record and audit history; it never calls Lift or Wrike, publishes a file, invokes discovery, or creates another order identity. Material or unverified impact still stops before publication, Lift transport, and Wrike writeback. Legacy events without sufficient component evidence use precise **unable to verify source impact** language rather than claiming a customer edit.

The first rollout from `4a5c617a761261c4e9c0808f27e712479a83508d` revealed that five retained legacy events could receive a second event ID when classifier metadata was added. One natural cycle appended five history records but changed no protected item count and produced zero Lift/Wrike/publication effects. The API was immediately restored to the prior artifact; Proof and Admin were not deployed. The five append-only records were preserved. PR #201 deduplicates review/no-impact events using the immutable source-version tuple of workbook evidence ID, Import Method fingerprint, and sorted reference-proof evidence IDs. PR #202 makes telemetry count only an actual append and emits `ReviewEventReused` for the retained event. Never delete, rewrite, batch-disposition, or backfill the incident records as part of application rollback.

Final API identity:

- artifact `api/pathfinder-api-lambda-9f78d2d4b122984c53bc3b96506588996768f5d0.zip`;
- S3 version `LCM76VW6gcgaIUxbP2oetVAzp6X_vP4Q`, ETag `50fa0085bad6395f9b02fcf6e445c007`;
- package SHA-256 `46d6908e7e3e2737039c7d7dc0b6495310d52b4c32a9f6bb7f2a6fd79b60a863`;
- Lambda SHA-256 `RtaQjn4+JzcDnH19wLZJUxDVK0wyqfa7fypv15tgqGM=`, revision `d1456842-0ea4-4021-9f1f-caf6e56218ff`;
- stack `UPDATE_COMPLETE`, API health HTTP 200, and no scan-worker event-source mapping.

The inspected/executed change set changed only `LambdaCodeS3Key`, Lambda code, and dependent API/EventBridge bindings. It changed or replaced no data resource. Natural cycle `41b53866-86b6-4fe0-ba4c-938aa2254b47`, checked `2026-08-13T20:27:53.116Z` and completed `20:28:10.250Z`, replayed six of six candidates with zero preparations, Lift submissions, Wrike writes, failures, or candidate failures. Strongly consistent histories added no event. Each reused assessment emitted `review_event_opened=false`, `MaterialReviewOpened=0`, `ReviewEventReused=1`, `lift_actions=false`, and `wrike_writes=false`.

Admin workflow `31741587264` / job `94586034820` succeeded on exact final main. `index.html` version is `N7Y8HLWV9ujMV66EPHeWCMI_CVInnnMR`, ETag `f691cb261c8d68aecdeb5b357badb7b6`; invalidation `I58MLKSAN2XDPDN5YK4KNYDCXE` completed. Authenticated read-only smoke confirmed exact Wrike/Lift identity, the source-review banner and controls, operational timestamps, and customer Proof setup. No disposition, save, discovery, refresh, archive, or provider action was invoked.

Final protected counts are Customers 1, CustomerWorkspaces 1, Targets 2, ImportMethods 2, OutputRoutes 1, ProductMappings 278, Jobs 56, OrderIds 59, SubmitAttempts 19, LiftProductCache 337, OrderStatusTokens 20, OrderStatusSnapshots 12, CanonicalRegistry 1, ProofCore-dev 142, and ProofAudit-dev 147. The first natural scheduler cycle after API, dedicated Proof runtime/SPA, and Admin were all live, correlation `4a3da847-8918-4304-9d68-1c4d8fdf0a88`, checked `2026-08-13T20:42:53.229Z` and completed `20:43:10.076Z`; it replayed six of six candidates with zero preparations, Lift submissions, Wrike writes, failures, or count/history changes. All four Pathfinder and ten Proof alarms are `OK`; all scan/sync queues and DLQs are empty; 16 Proof grants are retained, none active, and there are no sessions.

Application rollback is one service at a time and never a table restore. The pre-release API boundary is `api/pathfinder-api-lambda-e9f2f5397841241db71a164f002f609044f43293.zip`, S3 version `lzQPU7WzSsN.2vvMFNtvdsodHmY3i5kF`, Lambda SHA-256 `I1sfMSba40nBWJmh5lMfmilLjuKS8mjQcRcRTWJ/GeM=`. The pre-release Admin boundary is `index.html` version `Wk33oxh_Xoi6oj.N67z29m_3S8vYI8jd`. Preserve every live parameter and all append-only history when restoring an artifact.

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

### 2026-08-13 operational timestamp correction release record

PR #195 merged and deployed as application commit `e9f2f5397841241db71a164f002f609044f43293`. It changed no production record, gate, schedule, configuration, route, or external service. The production diagnosis was read-only:

- Lift order `A0228506` had durable `creation_date: "2026-08-13"`, a date without a time or timezone;
- Pathfinder recorded job creation at `2026-08-13T14:28:10.258Z` and exact order confirmation at `2026-08-13T14:28:17.997Z`, matching Lift's 10:28 AM Eastern audit;
- JavaScript parsed the date-only Lift value as UTC midnight, producing the false Aug 12, 8:00 PM Eastern display;
- stable scheduler replays advanced generic job `updated_at`, so it was not a trustworthy operator activity clock.

The repository fix adds read-only projection fields for Lift-creation value, precision, provenance, and meaningful last activity. Exact Pathfinder submit confirmation is used for Pathfinder-created orders. A full Lift timestamp remains authoritative when one exists. Lift date-only values remain date-only for historical or manually associated orders; manual link time is never presented as creation time. Meaningful activity excludes discovery sightings, status-check freshness, and generic replay updates to stable jobs.

The Admin presents **Pathfinder Intake**, **Lift Created**, and **Last Activity** on both Jobs lists. Recent Jobs ranks immediate triage first, then confirmed orders by Lift creation; a compact Pending Intake notice links durable pre-job Wrike issues to Intake Review. Existing saved `updated_at` sort preferences migrate to the projected Last Activity sort. No persisted schema migration or backfill is required.

Release identifiers and reconciliation:

- merged-main validation: workflow `31716952564`, job `94503966937` (`success`);
- API deployment: workflow `31717446469`, job `94505640947` (`success`);
- API artifact: `api/pathfinder-api-lambda-e9f2f5397841241db71a164f002f609044f43293.zip`, S3 version `lzQPU7WzSsN.2vvMFNtvdsodHmY3i5kF`, ETag `2979d5f6f6e38b00b7d173ebea715e16`;
- deployed Lambda SHA-256: `I1sfMSba40nBWJmh5lMfmilLjuKS8mjQcRcRTWJ/GeM=`; revision `dd522cb0-6dcb-4e79-bb44-6b5a9f5b3a41`;
- Admin deployment: workflow `31717869044`, job `94507073423` (`success`);
- Admin `index.html`: S3 version `Wk33oxh_Xoi6oj.N67z29m_3S8vYI8jd`, ETag `44a8b53ff8636935ae8ee986071ac234`;
- Admin bundles: `assets/index-f9_Mz9eg.js`, `assets/react-sXpfDjey.js`, `assets/icons-8RSbaZ6e.js`, and `assets/index-D4NlFs7B.css`;
- CloudFront invalidation: `IAWASHNMEJFHX6O5JN1T6FBHJT` (`Completed`).

The API stack returned to `UPDATE_COMPLETE`. Stack events show that only `PathfinderApiFunction` and the code property of the already-disabled `ProofAssetScanWorkerFunction` updated; no table, bucket, queue, mapping, configuration, or other protected data resource changed. `LambdaCodeS3Key` was the only changed parameter. HTTP health returned 200, the Lambda was Active/Successful, and the Admin distribution remained available with a no-cache entrypoint.

Authenticated production smoke confirmed `A0228506` at **Aug 13, 10:28 AM** for both Pathfinder intake and exact Lift creation; historical date-only `A0228322` rendered as **Aug 11** without an invented time; Recent Jobs led with the failed/blocked and stale Ready records before the newest confirmed Lift orders; and full Jobs consistently showed **Pathfinder Intake**, **Lift Created**, and **Last Activity** with the new sort choices. No discovery, Lift refresh, submit/retry, archive, Wrike write, configuration save, Proof action, or other mutation control was invoked.

The first authoritative natural post-release scheduler cycle, correlation `9c3ac9ca-ef52-44ce-b997-6e97567fa08f`, checked at `2026-08-13T15:57:53.496Z` and completed at `15:58:07.565Z`. It replayed all six qualified candidates, prepared zero jobs, submitted zero Lift orders, wrote zero Wrike comments, and recorded zero failures. Final protected counts remained Customers 1, CustomerWorkspaces 1, Targets 2, ImportMethods 2, OutputRoutes 1, ProductMappings 278, Jobs 56, OrderIds 59, SubmitAttempts 19, LiftProductCache 337, OrderStatusTokens 20, OrderStatusSnapshots 12, CanonicalRegistry 1, ProofCore-dev 142, and ProofAudit-dev 147. All four Pathfinder alarms remained `OK`; the scheduler remained `ENABLED` at `rate(15 minutes)`; and all live submit, writeback, transport, document-publication, campaign-root, multi-proof ZIP, `TBD` → `0.5`, `MM/DD/YYYY`, and Proof boundaries were preserved.

Rollback is application-only: restore API artifact `api/pathfinder-api-lambda-a772630ad5cc499bbc846dd7d9e4f3f8d8307736.zip` (S3 version `nj9R519E1iUE_30zyfxOgHadW4PX9.Hl`, Lambda SHA `qdTZsYi5tpj/jSi+2AA1iV7kbWTKwxDiFfass8/JN8g=`) and Admin `index.html` version `pbRlKloC8Kc7jkhepJOUmYOjpRLBIxvh`, then invalidate CloudFront. Do not restore or replace a production table or alter any Pathfinder/Proof gate. Because this release stores no new production state, no data rollback is expected. If API rollback precedes Admin rollback, the Admin retains a compatibility fallback to existing fields. The unavoidable known limit is that Lift-only historical records with a date-only header cannot gain an exact creation time without trustworthy original Pathfinder submit evidence.

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

### 2026-08-12 Jobs triage release record

PR #188 merged and deployed as `0d17b24696e9fef01e06e83fdbbed0d17825b9cb` on 2026-08-12 without changing production gates, configuration, or external systems:

- global and customer Jobs views retain separate browser-local filter/sort choices and expose **Reset view**;
- the default useful view is Active / All intake / Current orders / Pathfinder intake / Descending;
- `created_at` is labeled **Pathfinder Intake** and `updated_at` is labeled **Last Activity**; Lift creation time is shown only after the existing read-only Lift order snapshot is loaded;
- a five-card triage strip distinguishes confirmed orders, likely Wrike intake review, Ready jobs waiting over 30 minutes, confirmation-needed submits, and failed/blocked jobs;
- scheduled and operator discovery reuse the existing shared service path and persist only one bounded latest operations snapshot on the Import Method for cross-session candidate review;
- the snapshot write is optimistic and conditional, does not update the saved method configuration timestamp, is excluded from the Import Method fingerprint, and fails non-blockingly so discovery/submit/writeback continuity is preserved;
- an older Admin form submission cannot overwrite the latest runtime snapshot;
- confirmed job detail adds a collapsed, full-width read-only comparison of canonical input lines, the reviewed Lift payload, and the current Lift order by stable line number;
- Jobs shows Lift header **Order Status** separately from Pathfinder processing **State**, using only the latest durable status snapshot or verified-association evidence; the list performs no live Lift fan-out, shows **Not in Lift** before submission, and shows **Not checked** when a confirmed order has no durable header status yet;
- reconciled `Submission Uncertain` history remains immutable but displays recovery-complete language and explicitly says no retry is required;
- new confirmed associations capture additive `order_confirmed_at`; no existing job, order, attempt, mapping, publication, or audit record is rewritten or deleted.

Release identifiers and reconciliation:

- merged-main validation: workflow `31632893869`, job `94235882235`;
- API deployment: workflow `31633124192`, job `94236660746`;
- API artifact: `api/pathfinder-api-lambda-0d17b24696e9fef01e06e83fdbbed0d17825b9cb.zip`, S3 version `WLwmKkKpXMhk5mnMW.9TYrzrNfZFFozw`, ETag `ea2378f9388c61e079b962cc2e25baa0`;
- deployed Lambda SHA-256: `LJWU23r+coO6OXUyffL+4Er/33mf43xG/JN1I1uYQjM=`; revision `8866233d-9635-4992-a628-58bd0be67290`;
- Admin deployment: workflow `31634117887`, job `94240021112`;
- Admin `index.html`: S3 version `fc1EXjd9uKPqjuoVw8EWGMLo26FmdEDG`, ETag `55a53e3c4abf744dd3c8b47469613d93`;
- Admin bundles: `assets/index-lToVvnlZ.js`, `assets/index-bsCUjaT5.css`, `assets/react-sXpfDjey.js`, and `assets/icons-B5i5RwHw.js`;
- CloudFront invalidation: `I6DLZ8KMUO9HBT8CN4POL2EJOT` (`Completed`).

The API stack returned to `UPDATE_COMPLETE`. The executed update touched only `PathfinderApiFunction` and the code property of the already-disabled `ProofAssetScanWorkerFunction`; no table, bucket, queue, event-source mapping, or other data resource changed. API and Admin health returned HTTP 200. Scheduled intake/submit/writeback, live Lift transport and live-customer submission, workbook/reference evidence, `go.vornan.co` publication, authentication, both campaign roots, multi-proof ZIP selection/template, and scoped `TBD` → `0.5` remained unchanged. All shared-API Proof gates remained false. The isolated Proof stack retained protected public read for customer `1249` through `2026-08-25T23:59:59Z`, zero active grants/sessions, empty queues, and ten `OK` alarms.

All protected counts were identical before and after deployment: Customers 1, CustomerWorkspaces 1, Targets 2, ImportMethods 2, OutputRoutes 1, ProductMappings 278, Jobs 55, OrderIds 58, SubmitAttempts 18, LiftProductCache 337, OrderStatusTokens 19, OrderStatusSnapshots 11, CanonicalRegistry 1, ProofCore-dev 142, and ProofAudit-dev 147.

The first natural new-code scheduler cycle, correlation `b2b0ae3c-c5b9-4098-8c4e-402084d9df1f`, completed at `2026-08-12T19:43:08.043Z`. It discovered and replayed five known candidates, prepared zero new jobs, submitted zero Lift orders, wrote zero Wrike comments, and recorded zero failures. All four Pathfinder alarms remained `OK`.

Authenticated production Admin smoke confirmed the saved Active / All intake / Current orders / Pathfinder intake / Descending view, Reset view, five-card triage strip, clarified timestamps, and separate durable Lift **Order Status** column. MDHHS `JOB-280569` remained one confirmed row with three nested historical records. Its reconciled uncertain attempt displayed **no retry required**, its nine-line comparison expanded full-width, and its prepared dates displayed `08/26/2026`. No discovery, Lift refresh, retry, archive, submit, writeback, configuration save, or other mutation control was invoked.

Rollback is application-only: restore API artifact `api/pathfinder-api-lambda-fa1ed4389720bb4f2d1119794845e72af21de1ca.zip` (S3 version `YktOP79tJebDf66slbHcxGJXmU_EfRRF`, Lambda SHA `yPi7qpFVJKOVWbiCTnp4SIbfCmdLSHcz/+DoRG6dAM0=`) and Admin `index.html` version `gX5XENbtIDp2q6xPiiadjyLqFNraPn62`, then invalidate CloudFront. Do not restore or replace production tables, and do not change the active Momentara Import Method or Proof read boundary as part of this rollback.

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

### 2026-08-12 public Status partial-refresh resilience release record

PR #191 merged as `74506be03e404973b92bddcd541e3c5578a36910` and is deployed in application release `01e82bdfcb518d8758e494f53887852d248d536b`. The release addresses the confirmed public Status partial-refresh failure mode without changing submit, discovery, Wrike writeback, Proof mutation, customer configuration, or production data.

Observed production evidence before this slice:

- public Status loads the durable snapshot, immediately requests a refresh, and polls every 30 seconds while visible;
- a cache-expired refresh can read Lift order, proof, package, and shipping-report sources in parallel with the existing 15-second per-source timeout;
- five of eleven strongly consistent production status snapshots contained the exact runtime timeout message `The operation was aborted due to timeout`; all five identified `shipping_report`, while the corresponding order, proof, and package reads succeeded;
- the existing merge contract had no independent shipping freshness, so a successful package read could erase previously confirmed shipping-report destinations or enrichment;
- public rendering combined every raw issue into one global yellow `role=status` block, allowing internal exception text to cross the customer boundary and causing assistive announcements to flap as the warning appeared and cleared;
- API-wide evidence on 2026-08-12 showed zero 5xx responses but intermittent high integration latency. The latest snapshot is retained, but historical refresh frequency cannot be reconstructed because route access logs, detailed route metrics, and durable refresh history are not enabled.

Deployed behavior:

- order, proofs, packages, and shipping each receive a typed `availability`, `reason_code`, `severity`, `impact`, `checked_at`, and `last_success_at` contract;
- timeout, rejected request, non-2xx response, and missing configuration outcomes are classified without copying exception messages, provider URLs, configuration details, credentials, or raw payloads into public data;
- older stored snapshots are sanitized at the public projection boundary, so a pre-release raw `issues` message is removed even before the first successful new refresh;
- successful sources advance independently. Shipping now has its own lookup/freshness record; a shipping-report failure retains last-confirmed destination/tracking enrichment and cannot be mistaken for package freshness;
- the neutral no-activity presentation remains **Shipment updates pending** / **Lift has not posted package or tracking activity yet**;
- proof degradation appears only under **Proof update** and package/shipping degradation only under **Shipping update**, using fixed customer copy. Transient section degradation does not create the global warning;
- only unavailable core order status uses the global **Order update** message. Public issue rendering never trusts provider/runtime message text;
- refresh-state text and section warnings are not live regions, preventing every checking/recovery transition from being repeatedly announced. Each localized notice has a source-specific accessible heading;
- the existing server coalescing and 15-second recent-snapshot cache remain. Visible-only browser polling adds bounded 10% jitter and exponential backoff for repeated core refresh failures, from the server-directed 15–60 second base up to five minutes; recovery resets the backoff;
- actual source reads emit sanitized `order_status_source_read` EMF events in `Pathfinder/OrderStatus`, including a per-refresh correlation ID, hashed identities, source, outcome/reason, impact, checked time, duration, HTTP status when available, and `SourceRead`, `SourceReadDuration`, and `SourceReadTimeout` metrics;
- every public refresh emits a sanitized `public_status_refresh_complete` event with cache/retained source, typed source outcomes, and `RefreshRequest` / `RetainedSourceCount`. This closes the structured log gap but is not a durable application-history table.

Proposed operational objectives and alarms, not activated by this repository slice:

- core order-source refresh availability: at least 99.5% over 30 days, measured from `SourceRead` outcomes for `Source=order` and `Operation=public_status_refresh`;
- alarm when core order reads produce three or more non-available outcomes in five minutes;
- alarm when any enrichment source records at least five timeouts in fifteen minutes and the timeout share exceeds 10% of that source's reads;
- alarm when `RetainedSourceCount` is nonzero for three consecutive five-minute periods, routed with the affected source/reason from the structured log rather than customer content;
- dashboard p50/p95/p99 `SourceReadDuration` by source and cache-vs-Lift public-refresh share before changing the 15-second timeout or API Gateway budget.

Release identifiers and reconciliation:

- combined merged application commit: `01e82bdfcb518d8758e494f53887852d248d536b`;
- API deployment: workflow `31642512384`, job `94268234168`;
- API artifact: `api/pathfinder-api-lambda-01e82bdfcb518d8758e494f53887852d248d536b.zip`, S3 version `aP7YChdU8RMTI6sus25zwwvaOs987ARw`, ETag `4817b305566aa95787e4bfe5e16f32d2`;
- deployed Lambda SHA-256: `lbUyv2XFUnhRbW/ykjPgv6Cq3mFcjG9IkzgZ0XVFAS0=`; revision `3dccbcd9-b5bc-4b4d-a9c6-574f39baf7f4`;
- Status deployment: workflow `31642951209`, job `94269711658`;
- Status `index.html`: S3 version `Af0H89UHQqAa.uwezNCA8VnZf7KaTaRI`, ETag `502b52c366a71cdf4607e988aa2b1901`;
- Status bundles: `assets/index-wIguaTdK.js` and `assets/index-C6dwwrRs.css`;
- Status CloudFront invalidation: `I2YGUMGYRYSLX80PPH8IVH43RK` (`Completed`).

The API stack returned to `UPDATE_COMPLETE`. The executed change updated only `PathfinderApiFunction` and the code property of the already-disabled `ProofAssetScanWorkerFunction`; no table, bucket, queue, event-source mapping, or other data resource changed. API health and the Status entrypoint returned HTTP 200; the Status distribution remained enabled and `Deployed`. All fifteen protected counts were identical before and after deployment. Scheduled intake/submit/writeback, live Lift transport and live-customer submit, workbook/reference evidence, `go.vornan.co`, both campaign roots, multi-proof ZIP selection/template, and scoped `TBD` → `0.5` remained unchanged. All shared-API Proof gates remained false, while the isolated Proof read window for customer `1249` remained active through `2026-08-25T23:59:59Z`.

The first authoritative natural post-release scheduler cycle, correlation `ebd5efec-ed23-482b-b70d-015f773d3f0c`, completed at `2026-08-12T21:43:06.057Z`. It discovered and replayed five known candidates, prepared zero jobs, submitted zero Lift orders, wrote zero Wrike comments, and recorded zero failures. Strongly consistent protected counts remained Customers 1, CustomerWorkspaces 1, Targets 2, ImportMethods 2, OutputRoutes 1, ProductMappings 278, Jobs 55, OrderIds 58, SubmitAttempts 18, LiftProductCache 337, OrderStatusTokens 19, OrderStatusSnapshots 11, CanonicalRegistry 1, ProofCore-dev 142, and ProofAudit-dev 147. All four Pathfinder alarms remained `OK`.

No customer Status link, provider GET, or token refresh was forced for smoke. No natural public refresh occurred during the release observation window, so the new `order_status_source_read` and `public_status_refresh_complete` production schema is covered by repository regression tests but did not yet produce a live baseline. Observe natural traffic before selecting thresholds or activating the proposed alarms.

Rollback is application-only: restore API artifact `api/pathfinder-api-lambda-0d17b24696e9fef01e06e83fdbbed0d17825b9cb.zip` (S3 version `WLwmKkKpXMhk5mnMW.9TYrzrNfZFFozw`, Lambda SHA `LJWU23r+coO6OXUyffL+4Er/33mf43xG/JN1I1uYQjM=`) and Status `index.html` version `MeSy6wRR03wjugTZtDOhc36p.ZfxmmYz`, then invalidate the Status distribution. Do not restore or replace a production table, change a Status token, alter the Momentara Import Method, or change any Lift/Wrike/Proof capability gate.

Known staged follow-up: cache expiry can still cause a browser-triggered parallel Lift fan-out. This slice makes that path safe, coalesced, observable, jittered, and backed off on core failure, but it does not move refreshes to a background worker or retain durable refresh history. Design the later stale-while-revalidate/background refresh around measured source latency, API Gateway's request budget, bounded per-order leases, adaptive scheduling, and the same independent last-good merge contract; do not simply raise the 15-second source timeout.

### 2026-08-12 Jobs detail hierarchy release record

PR #190 merged as application release `01e82bdfcb518d8758e494f53887852d248d536b` after a conflict-free code rebase over PR #191. It reorganizes the existing Admin Jobs detail page without changing an API contract, store, job state, submit path, recovery guard, or external-system behavior.

The deployed Admin:

- promotes Wrike Contract/campaign, Pathfinder job identity, Lift order identity, Pathfinder state, current Lift status, and post-confirmation source-change attention into the page header;
- replaces the flat diagnostic summary with an operator-facing order overview and retains Pathfinder Intake, Last Activity, Order Confirmed, and live-only Lift Created timestamps;
- keeps the line comparison full width, summarizes match coverage, and shows the resolved Lift product name/identifier rather than an internal line token where available;
- collapses source-order history, current Lift production detail, submit attempts, certification, product resolution, and raw source/canonical/Lift payload evidence by default while preserving every existing datum and action;
- distinguishes **Refresh Lift status**, **Open in Lift**, and **Job actions** so their scopes are explicit;
- does not invoke discovery, Lift reads/writes, Wrike writes, publication, configuration saves, or production mutation during validation.

Admin workflow `31643183102` / job `94270482398` deployed `index.html` S3 version `B.stcyJIbzGhY39TAsD2Z60Z_DOa6tG8`, ETag `88290108fde5e873a3c3a80e54685e3c`, with bundles `assets/index-PTKGz1S5.js`, `assets/react-sXpfDjey.js`, `assets/icons-BJATD6jt.js`, and `assets/index-CEb6P0C7.css`. CloudFront invalidation `IBEGAE0N3G3ZPJT8C0SKJTM29E` completed; the distribution remained enabled and `Deployed`, and the production entrypoint returned HTTP 200.

Authenticated production smoke confirmed the Jobs triage summary and separate Lift **Order Status** column. `JOB-280569` displayed Wrike Contract `C316969`, campaign `MDHHS - Eat Safe Fish FY 26 - GPA - C316969`, Lift order `A0228322`, current durable status **To Be Ripped**, preserved source-change review guidance, reconciled **no retry required** history, and the full-width nine-line comparison. No discovery, Lift refresh, retry, archive, submit, writeback, configuration save, or other mutation control was invoked.

Rollback is Admin-only: restore `index.html` version `fc1EXjd9uKPqjuoVw8EWGMLo26FmdEDG` and invalidate CloudFront. Do not restore or replace a production table and do not change the active Momentara Import Method.

### 2026-08-13 customer overview clarity release record

PR #193 merged as application commit `a772630ad5cc499bbc846dd7d9e4f3f8d8307736`. Merged-main validation workflow `31710079956` / job `94480463067`, API workflow `31710477663` / job `94481827425`, and Admin workflow `31711111458` / job `94484062345` all completed successfully.

The deployed behavior changes only the customer overview presentation and one additive `/api/jobs` runtime projection:

- **Tracked Orders** counts active rows from the existing source-order projection, so retained technical siblings do not inflate the metric;
- **Confirmed in Lift**, **Ready to Submit**, and **Needs Attention** replace the former line-count, validation-rate, workspace-state, and route-wide mapping cards;
- the full-width Recent Jobs table labels **Pathfinder State** separately from **Lift Status**, and shows Lift order number/name, **Lift Created**, **Last Activity**, and route;
- `target_order_created_at` comes only from `snapshot.live_order.creation_date` in the latest durable order-status snapshot. The Jobs list and customer overview do not issue a provider GET or other live Lift request;
- missing durable creation evidence renders **Not checked** for a linked Lift order and **Not in Lift** before submission;
- the non-data-backed success-rate sparkline is removed, overview provenance no longer says **Local**, and endpoint/auth/format/resolver detail moves behind **View target setup**.

The API artifact is `api/pathfinder-api-lambda-a772630ad5cc499bbc846dd7d9e4f3f8d8307736.zip`, S3 version `nj9R519E1iUE_30zyfxOgHadW4PX9.Hl`, ETag `f2e5e6fbf7e7f3bcbd768edcbd6b3f39`, and deployed Lambda SHA-256 `qdTZsYi5tpj/jSi+2AA1iV7kbWTKwxDiFfass8/JN8g=` with revision `b6691947-9e39-42cb-876d-e538d2cf0d55`. The executed change set `awscli-cloudformation-package-deploy-1786631487` modified only `PathfinderApiFunction`, `PathfinderApiIntegration`, the code property of the already-disabled `ProofAssetScanWorkerFunction`, and dependent scheduled-rule permission/target bindings. Nothing was replaced and no table, bucket, queue, mapping, configuration, or other data resource changed. `LambdaCodeS3Key` was the only changed stack parameter.

Admin deployed `index.html` S3 version `pbRlKloC8Kc7jkhepJOUmYOjpRLBIxvh`, ETag `c54964c796b78131cbbf6a0880825386`, with bundles `assets/index-BCkNKtgL.js`, `assets/react-sXpfDjey.js`, `assets/icons-8RSbaZ6e.js`, and `assets/index-jcRBp9s2.css`. CloudFront invalidation `I1SEEV7TKKYUZXZZR1YZHND7V6` completed; the distribution remained enabled and `Deployed`; and the production entrypoint returned HTTP 200.

Authenticated read-only smoke confirmed 15 unique tracked orders, 13 confirmed in Lift, one Ready to Submit, and two attention signals. Recent Jobs displayed separate Pathfinder/Lift states, the new BHA campaign/contract and Lift order, durable Lift status/creation values, and the configured route. The Jobs view confirmed both fallback contracts: linked historical orders without a durable header snapshot displayed **Not checked**, and the unsubmitted Ready record displayed **Not in Lift**. No discovery, Lift refresh, submit/retry, archive, writeback, configuration save, Proof action, or other mutation control was invoked.

During the predeployment baseline window, natural scheduler correlation `921f37d6-2455-4b3f-a0dd-dd8793e1e022` at `2026-08-13T14:27:53.319Z` found six contract-ready candidates, prepared one, replayed five, submitted one, posted one status comment, and recorded zero failures. The new source was Wrike task `MAAAAAEOLqIq`, campaign `Maryland Behavioral Health Administration (BHA) - Indoor - C316994`; Pathfinder job `job_20260813142810_ba449a` / Ext_ID `PFMSRM52HKEE2B` was confirmed as Lift order `A0228506` before the API deployment began. This expected live-business event exactly accounts for the count increases from the captured 55/58/18/19/11 baseline to Jobs 56, OrderIds 59, SubmitAttempts 19, OrderStatusTokens 20, and OrderStatusSnapshots 12. Every other protected count remained unchanged.

The first authoritative post-release cycle, correlation `10960a07-8d81-46ec-bb01-856b6c1ec57b` at `2026-08-13T14:42:53.244Z`, discovered and replayed all six current candidates with zero preparations, Lift submissions, Wrike writes, candidate failures, or failed invocations. Final protected counts were Customers 1, CustomerWorkspaces 1, Targets 2, ImportMethods 2, OutputRoutes 1, ProductMappings 278, Jobs 56, OrderIds 59, SubmitAttempts 19, LiftProductCache 337, OrderStatusTokens 20, OrderStatusSnapshots 12, CanonicalRegistry 1, ProofCore-dev 142, and ProofAudit-dev 147. All four Pathfinder alarms were `OK`.

The scheduler remained `ENABLED` at `rate(15 minutes)`. Scheduled intake/submit/writeback, live Lift transport and live-customer submit, workbook/reference evidence, `go.vornan.co`, GPA `34000804`, IBA `49405755`, multi-proof `all_matching_current_attachments` with `<contract_number>_referenceProofs.zip`, scoped `TBD` → `0.5`, and Lift date formatting default `MM/DD/YYYY` were read back unchanged. Shared-API Proof gates remained false, and the isolated Proof tables remained at 142 core / 147 audit records.

Rollback is application-only: restore API artifact `api/pathfinder-api-lambda-01e82bdfcb518d8758e494f53887852d248d536b.zip` (S3 version `aP7YChdU8RMTI6sus25zwwvaOs987ARw`, Lambda SHA `lbUyv2XFUnhRbW/ykjPgv6Cq3mFcjG9IkzgZ0XVFAS0=`) and Admin `index.html` version `B.stcyJIbzGhY39TAsD2Z60Z_DOa6tG8`, then invalidate CloudFront. Do not restore or replace a production table, delete the legitimate BHA order history, change the active Momentara Import Method, or alter a Pathfinder/Proof capability gate.

The discovery fingerprint still includes the route-wide mapped-product set. A mapping change can therefore invalidate more previews than the exact product dependency requires. The explicit recovery control updates one intended blocked job in place, but dependency-aware discovery invalidation remains hardening debt.

Known hardening debt:

- replace route-wide invalidation with dependency-aware invalidation based on the product keys actually used by each job;
- update the Import Method **Last Run** surface on healthy replay-only scheduled cycles so it does not imply that polling stopped;
- persist discovery-run history beyond structured runtime audit logs so earlier pending-intake snapshots can be compared in the UI;
- keep retained sibling records as immutable history; do not delete them merely to clean the Jobs display;
- extend guided recovery beyond product mappings to other known-safe pre-transport validation failures;
- add success/failure notifications that do not require daily babysitting;
- persist scheduler candidate failures in durable audit history after the sanitized log contract is proven in production.

### Repository-ready post-transport source review (not yet deployed)

The approved next release replaces broad-fingerprint warnings with a fail-closed, Lift-impacting comparison while preserving every duplicate-order and uncertain-submit guard:

- the existing broad Import Method/route/mapping fingerprint remains preparation and idempotency evidence, but fingerprint inequality alone no longer claims that a customer changed an order;
- a versioned impact digest compares only stable Lift-bound header fields, lines/resolved product identity, workbook content, and the stable reference-proof evidence set; Ext_ID/job metadata, signed URLs, task chatter, unrelated mappings, and code/schema noise are excluded;
- the post-transport check is an in-memory dry run. It does not persist product mappings, publish documents, create a job/order identity, call Lift, write Wrike, or reserve a submit attempt;
- an identical effective order records a collapsed **No order impact** history item and does not advance Last Activity;
- a material difference records sanitized changed-component reason codes and keeps **Review needed** open; an unavailable comparison uses **Unable to verify source impact** language and remains fail closed;
- an authenticated operator may disposition one exact event as **No Lift update needed** or **Mark reviewed**. The narrow conditional Jobs-item write is idempotent, preserves the immutable original event, records actor/time/optional bounded note, advances Last Activity, and causes zero external effect;
- a later distinct material event receives a new event identity and reopens attention. Prior disposition never suppresses a later event.
- sanitized `Pathfinder/WrikeSourceOrders` EMF records assessment/material/unknown outcomes and successful dispositions using hashed identities and component booleans/digests; customer cells, filenames, URLs, payloads, and review notes are excluded. Observe natural volume before activating age/unknown-rate alarms.

The six existing production events are not automatically migrated, reclassified, or cleared by deployment. Because their historical records lack component-level impact digests, the Admin must describe them as unverifiable until a separately authorized read-only assessment is completed. Any production disposition remains a separately approved exact-event data mutation. Rollback is application-only; retained assessment/disposition fields and history must not be deleted.

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

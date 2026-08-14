# Pathfinder current state

This is the entry point for all new Pathfinder, Vornan Proof, and live-support tasks. Read this file before using older design notes, launch checklists, or thread handoffs.

Last reconciled: **2026-08-14**

Deployed application baseline: `origin/main` application commit `9f78d2d4b122984c53bc3b96506588996768f5d0`

Live evidence: read-only AWS inspection, authenticated Admin smoke, and natural scheduled-intake continuity through 2026-08-13 in account `744016783602`, region `us-east-1`

## Authority order

When sources disagree, use this order:

1. Fresh read-only evidence from the live service being discussed.
2. The current merged `origin/main` implementation and deployment templates.
3. The current handoff documents linked below.
4. Historical architecture notes, launch runbooks, and prior thread handoffs.

Never infer a production capability from merged code alone. Record repository-ready and deployed-live states separately.

## Current handoffs

- [Pathfinder live operations handoff](./PATHFINDER_LIVE_OPERATIONS_HANDOFF_2026-08-10.md) — production Wrike discovery, Lift submission, document delivery, status writeback, job recovery, and known operating debt.
- [Vornan Proof go-live handoff](./VORNAN_PROOF_GO_LIVE_HANDOFF_2026-08-10.md) — current public-read boundary, source-ready work, deployed Proof stack, asset infrastructure, and the next QA sequence.
- [Pathfinder live support runbook](./PATHFINDER_LIVE_SUPPORT_RUNBOOK.md) — incident triage, mutation boundaries, recovery procedure, and the contract for a dedicated support task.

## Current production posture

### Customer-workspace persistence incident — repository fix in review

On 2026-08-14, selecting `LTL Demo / 1249` in production Admin created the intended isolated Customer, CustomerWorkspace, Manual XLSX Import Method, and Output Route records, then returned a raw DynamoDB throughput error. No preview, Pathfinder job, submit attempt, Lift order, or Wrike action occurred. Read-only evidence found 21 `WriteThrottleEvents` on `Pathfinder-Jobs-prod` in the incident minute and zero throttles on every other protected table. The retained `1249` setup records are valid production data and must not be deleted, reseeded, or recreated.

The cause is the legacy whole-store Dynamo writer: after the four setup records were durable, it attempted an unbounded `PutItem` rewrite of every existing Job and a replacement pass over the Lift product cache. The same writer remained reachable from Import Method and Output Route saves, so the Proof pilot is stopped before any `1249` configuration save.

Subsequent authenticated attempts to refresh Lift catalog `6338` exposed the same writer through `upsertLiftProductCatalog`: user-confirmed Lift evidence contained 18 products, but the cache remained at 337 total rows, including 334 catalog-`8102` rows and zero catalog-`6338` rows. Jobs recorded 28, 24, and 85 write throttles in the three attempt windows while LiftProductCache and ProductMappings recorded none. The deployed writer rewrote Jobs before replacing the cache, so throttling stopped the operation before any catalog row persisted. ProductMappings remained 278; customer `1249` still has zero Jobs and zero Submit Attempts. Do not repeat product refresh before the focused fix is deployed and a single exact refresh is approved.

The repository-ready fix gives workspace creation, Import Method saves, and Output Route saves focused, customer-scoped conditional transactions. It also makes Lift catalog refresh an additive upsert of only the normalized cache rows keyed by target/environment/company and product identity; it cannot scan, delete, or replace existing cache rows or write Jobs, mappings, workspaces, routes, attempts, or another customer. Completed cache batches are counted exactly. If a later batch fails, Pathfinder consistently rereads only that batch's exact keys, merges definitely persisted rows into the request view, and reports a sanitized partial or uncertain outcome rather than claiming zero writes. New customer setup becomes an explicit idempotent Admin confirmation; workspace reads no longer create records. API/UI failures use fixed nontechnical copy, state that no preview or Lift order was submitted, and emit sanitized operation/outcome/table-class telemetry without AWS/provider exception text, payloads, credentials, or URLs. This code is not deployed until its draft PR is reviewed and a separate one-at-a-time API-first/Admin-second release is approved.

### Deployed combined source-review and default-dark Proof release

PRs #197, #199, #198, #200, #201, and #202 are merged and deployed together from final application commit `9f78d2d4b122984c53bc3b96506588996768f5d0`. Merged-main validation `31740363776` / job `94581986809` passed the full repository, browser, deployment-contract, readiness, and packaging matrix. The Pathfinder slice adds stable Lift-impact classification for post-transport Wrike replays and exact, append-only operator dispositions. It does not add a Lift order-update/retry path, and it does not auto-clear retained review history. The Admin now presents precise review language, immutable source/Lift identities, and explicit **No Lift update needed** / **Mark reviewed** controls; invoking either control remains a separately authorized production mutation.

The first API rollout exposed a legacy-event idempotency defect: one natural scheduler cycle appended five duplicate review records because the new event ID included classifier metadata that was absent from the retained legacy records. No job/order/attempt/token/snapshot count, publication, Lift call, or Wrike write changed. The API was immediately rolled back; Proof and Admin were not deployed. PR #201 then made the immutable source-version tuple (`source_evidence_id`, Import Method fingerprint, and sorted reference-proof evidence IDs) the dedupe boundary, and PR #202 corrected telemetry so a reused event no longer increments `MaterialReviewOpened`. The five append-only incident records are intentionally retained; no deletion, backfill, acknowledgement, or table rollback occurred.

The final API artifact is `api/pathfinder-api-lambda-9f78d2d4b122984c53bc3b96506588996768f5d0.zip`, S3 version `LCM76VW6gcgaIUxbP2oetVAzp6X_vP4Q`, ETag `50fa0085bad6395f9b02fcf6e445c007`, Lambda SHA-256 `RtaQjn4+JzcDnH19wLZJUxDVK0wyqfa7fypv15tgqGM=`, and revision `d1456842-0ea4-4021-9f1f-caf6e56218ff`. Natural cycle `41b53866-86b6-4fe0-ba4c-938aa2254b47` replayed all six qualified candidates with zero preparations, Lift submissions, Wrike writes, or failures. Strongly consistent histories were unchanged; all six reused assessments emitted `review_event_opened=false`, `MaterialReviewOpened=0`, and `ReviewEventReused=1`.

The dedicated Proof runtime and SPA are deployed default-dark from the same commit. The Lambda artifact is `proof/dev/vornan-proof-lambdas-9f78d2d4b122984c53bc3b96506588996768f5d0.zip`, S3 version `3mP27wYjTHhnzgYnJm6.tOp0v.UTEn.o`, ETag `5c8c474a0a2f73f2a805bc79a39219af`, with public/operator/sync Lambda SHA-256 `B8klnTEe7HoNYEW1o7jF1w8iYkh5vSnlutVSYcXT0G0=`. The isolated public runtime now has exact-table `GetItem` access to `Pathfinder-CustomerWorkspaces-prod` and revalidates bound policy/identity on every sensitive request. Proof SPA `index.html` is version `03EBjq4DDFwqGnJvTNGMt1gZ7aarlath`, ETag `e7e1aa16c99cd940a543d2253dbc1548`, invalidation `IEDO6513H0SVOONZ84QB7H38VV`. Protected public read remains limited to customer `1249` through `2026-08-25T23:59:59Z`; approval, revision, grant creation, LTL Demo, upload, scan, publication, operator action, and Lift gates remain false.

Admin deployment workflow `31741587264` / job `94586034820` succeeded on exact final main. Admin `index.html` is version `N7Y8HLWV9ujMV66EPHeWCMI_CVInnnMR`, ETag `f691cb261c8d68aecdeb5b357badb7b6`, invalidation `I58MLKSAN2XDPDN5YK4KNYDCXE`. Authenticated read-only smoke verified the Jobs review presentation and customer Proof identity/settings UI without invoking discovery, provider refresh, disposition, identity verification, save, grant, or any other mutation.

Protected counts remain Customers 1, CustomerWorkspaces 1, Targets 2, ImportMethods 2, OutputRoutes 1, ProductMappings 278, Jobs 56, OrderIds 59, SubmitAttempts 19, LiftProductCache 337, OrderStatusTokens 20, OrderStatusSnapshots 12, CanonicalRegistry 1, ProofCore-dev 142, and ProofAudit-dev 147. The first natural cycle after every release surface was live, correlation `4a3da847-8918-4304-9d68-1c4d8fdf0a88`, checked `2026-08-13T20:42:53.229Z` and completed `20:43:10.076Z`; it replayed all six candidates with zero preparation, Lift submission, Wrike write, or failure, and the counts and all six source-review history sets remained unchanged. Proof access remains 16 retained grants, 0 active grants, and 0 sessions; all queues are empty; all four Pathfinder and ten Proof alarms are `OK`. Scheduled discovery/submit/writeback, live Lift transport/customer submit, `go.vornan.co`, GPA and IBA roots, multi-proof ZIP, scoped `TBD` → `0.5`, and `MM/DD/YYYY` remain unchanged.

### Deployed customer overview clarity release

PR #193 merged and deployed as `a772630ad5cc499bbc846dd7d9e4f3f8d8307736` on 2026-08-13. Merged-main validation `31710079956`, API workflow `31710477663`, and Admin workflow `31711111458` completed successfully. The release replaces line-count and replay-distorted customer metrics with **Tracked Orders**, **Confirmed in Lift**, **Ready to Submit**, and **Needs Attention**, all computed from the existing source-order Jobs projection. Historical Wrike siblings remain nested audit records and do not become additional tracked orders.

The overview's Recent Jobs table is full width, explicitly separates Pathfinder state from Lift order status, and shows Lift order number/name, durable Lift creation time, last Pathfinder activity, and route. Lift creation time is projected only from the existing durable order-status snapshot; the overview performs no live Lift fan-out and displays **Not checked** or **Not in Lift** when the evidence is absent. The static success-rate chart and the misleading **Local** workspace KPI are removed, customer provenance is labeled **Lift directory** or **Saved Pathfinder record**, and transport/configuration detail moves behind **View target setup**.

The API stack changed only the Lambda artifact and dependent API/EventBridge bindings; no data resource was changed or replaced. The only parameter change was `LambdaCodeS3Key`. During the predeployment baseline window, natural scheduler correlation `921f37d6-2455-4b3f-a0dd-dd8793e1e022` legitimately created and confirmed BHA contract `C316994` as Lift order `A0228506`, posted one Wrike comment, and recorded zero failures. That completed before the API update began and accounts exactly for the one-item increases in Jobs, Order IDs, Submit Attempts, status tokens, and snapshots. The first post-release cycle, correlation `10960a07-8d81-46ec-bb01-856b6c1ec57b`, replayed all six current orders with zero preparations, Lift submissions, Wrike writes, or failures.

Final protected counts were Customers 1, CustomerWorkspaces 1, Targets 2, ImportMethods 2, OutputRoutes 1, ProductMappings 278, Jobs 56, OrderIds 59, SubmitAttempts 19, LiftProductCache 337, OrderStatusTokens 20, OrderStatusSnapshots 12, CanonicalRegistry 1, ProofCore-dev 142, and ProofAudit-dev 147. All four Pathfinder alarms were `OK`; the scheduler remained enabled at 15 minutes; live submit/writeback/transport, `go.vornan.co`, both campaign roots, multi-proof ZIP, `TBD` → `0.5`, `MM/DD/YYYY`, and all Proof boundaries were preserved.

### Pathfinder / Momentara

The production API stack is live. Scheduled Momentara intake is enabled every 15 minutes for customer `284619` and Import Method `method-1784901795973`, with up to 25 independent candidates per cycle. Scheduled Lift submission, status-comment writeback, workbook/reference-document publication through `go.vornan.co`, live Lift transport, and live-customer submission are enabled.

The production path is active; it is not a rehearsal or sandbox path. Manual rehearsal and legacy bounded discovery/writeback gates are disabled.

The operations control-plane release at `677005c5bf8910a931eeadfa878ba6f80204b97c` is deployed to the API and Admin. It adds visible-only Jobs refresh, shared-path operator discovery, pending-intake reasons, safe pre-transport mapping recovery, and a Lift target date-format boundary whose production default is `MM/DD/YYYY`. API workflow run `31505325973` and Admin workflow run `31506038490` completed successfully with production counts and live gates preserved.

The saved production Import Method contains both GPA Campaigns (`34000804`) and IBA Campaigns (`49405755`). Its `Order Form` hardware section stores the scoped quantity rule `TBD` → `0.5`; the 2026-08-11 deployment preserved that configuration unchanged.

The scheduler cycles beginning at `2026-08-11T15:42:53.213Z` repeatedly discovered seven contract-ready candidates, replayed six, and failed one during preparation. PRs #181 and #182 deployed bounded candidate telemetry at commits `cb237d379210c826cfdd16431482821488c343e4` and `4acbc0eea1366376cee740a3ba0c9072025974b0`. The first authoritative post-fix cycle (`a15a93c9-64f4-4d5b-8ee5-f2544d955418`) identified task `MAAAAAEN2Ujj`, stage `prepare`, reason `attachment_validation_failed`, with no job/evidence IDs. Operator inspection confirmed that two legitimate reference-proof PDFs had matched the production single-proof rule. Momentara temporarily replaced them with one combined proof, after which the natural scheduler created and submitted the order.

That Lift request timed out after Lift accepted it. Live Support reconciled stored Ext_ID `PFMSOZTWDUAF53` through Lift's import log and linked existing order `A0228322` to `JOB-280569` using the supported verified-association flow at `2026-08-11T18:54:43.225Z`; no create-order retry or direct data edit occurred. Scheduler correlation `02f1a162-2534-4d91-b072-3eec0a4a5fd2` then posted exactly one Wrike comment at `2026-08-11T18:58:23.826Z`, with zero Lift submits and zero candidate failures. The original `Submission Uncertain` attempt remains immutable history. Three later Ready siblings with the same source evidence are safely replayed and not submitted; normalizing them remains a separately authorized support action.

PR #184 merged the multi-reference-proof ZIP capability at `b6794380e44d3ca1ab22add3151525589ba6770c`. API workflow `31527788915` and Admin workflow `31528125205` deployed it on 2026-08-11 with every unrelated live parameter preserved. After a recoverable Import Method backup, Momentara was explicitly changed to `all_matching_current_attachments` with archive convention `<contract_number>_referenceProofs.zip`. Two to ten matching PDFs are retained as separate immutable evidence and packaged deterministically as one ZIP; one matching PDF continues through the unchanged direct-PDF path. The ZIP uses the existing `reference_proof_url` Lift field and `go.vornan.co` publication boundary.

The first natural cycle after activation prepared five replacement previews because the normalized Import Method fingerprint changed. Cross-job idempotency replayed every submit and produced no Lift order or Wrike write. Through `2026-08-12T15:35:43Z`, all 80 post-activation natural cycles completed at the 15-minute cadence with zero candidate failures, zero Lift submissions, and zero Wrike writebacks. A bounded operator discovery then returned five ready/reused orders, zero new previews, and 100 pending candidates, again with no Lift or Wrike action. The five currently qualified Wrike tasks already reconcile to confirmed Lift orders for Visit Montana (`A0228214`), MDHHS (`A0228322`), Fair Housing Commission (`A0228278`), Comcast Big South (`A0228190`), and ALDI HIN Store (`A0228162`). There is no evidence of a missed qualified order.

Current visibility debt: the Import Method's displayed **Last Run** does not reflect later replay-only scheduled cycles. The latest bounded pending-candidate snapshot now survives browser sessions, but Pathfinder does not retain discovery-run history for comparing older snapshots. Use exact Wrike task/evidence IDs as authoritative identity even when campaign names are displayed.

### Deployed public Status resilience and Jobs detail hierarchy release

PRs #191 and #190 merged in that order and are deployed together as `01e82bdfcb518d8758e494f53887852d248d536b` on 2026-08-12. The API-first / Status-second / Admin-third release used API workflow `31642512384` / job `94268234168`, Status workflow `31642951209` / job `94269711658`, and Admin workflow `31643183102` / job `94270482398`. All checks, tests, and builds in each workflow completed successfully.

Public Status now keeps independent last-confirmed order, proof, package, and shipping data; publishes only typed and sanitized availability reasons; localizes transient proof/shipping degradation instead of exposing raw provider/runtime text in a global warning; preserves neutral no-shipment activity; and uses bounded jitter/backoff around the existing coalesced refresh path. The API emits sanitized `order_status_source_read` and `public_status_refresh_complete` telemetry when natural Status traffic performs a refresh. No customer Status link or provider GET was forced for deployment smoke, and no natural public refresh occurred during the release observation window, so production latency/timeout thresholds remain a measured follow-up rather than an activated alarm change.

The Admin Job Detail page now promotes source/Lift identity and actionable state, provides a compact order overview, keeps the full-width line comparison, and collapses technical evidence while preserving every existing datum and action. Authenticated production smoke confirmed the Jobs triage strip, separate Lift **Order Status**, and `JOB-280569` campaign/contract identities, reconciled no-retry guidance, and nine-line comparison without invoking discovery, Lift refresh, retry, archive, submit, writeback, or configuration controls.

The executed API stack update touched only `PathfinderApiFunction` and the code property of the already-disabled `ProofAssetScanWorkerFunction`; no data resource changed. Natural scheduler correlation `ebd5efec-ed23-482b-b70d-015f773d3f0c` replayed five known candidates with zero preparations, new Lift submissions, Wrike writes, or failures. All fifteen protected counts, live Wrike/Lift/publication gates, both campaign roots, the multi-proof ZIP policy, `TBD` → `0.5`, and Proof boundaries remained unchanged. Exact artifact, CloudFront, rollback, and operational details are in the live-operations handoff.

### Deployed Pathfinder Jobs triage release

PR #188 merged and deployed as `0d17b24696e9fef01e06e83fdbbed0d17825b9cb` on 2026-08-12. API workflow `31633124192` / job `94236660746` and Admin workflow `31634117887` / job `94240021112` succeeded after merged-main validation `31632893869` / job `94235882235`. The release persists each Jobs scope's last filter/sort selection in that browser, labels `created_at` as **Pathfinder Intake** rather than implying a Lift creation time, and adds a compact triage strip for confirmed orders, likely intake candidates, Ready jobs waiting more than 30 minutes, confirmation-needed submits, and failed/blocked jobs.

The same scheduled/operator discovery result now stores one bounded latest Wrike operations snapshot on the existing Import Method item. That runtime evidence has an optimistic conditional-write boundary, does not change the Import Method configuration timestamp or fingerprint, and cannot be overwritten by an older Admin form save. Jobs reads this snapshot without invoking discovery, so candidate review can survive browser sessions. This is a latest-state snapshot, not discovery-run history.

Confirmed job detail adds a full-width, read-only line comparison across canonical input, the reviewed Lift payload, and a freshly loaded current Lift order. Lift creation time appears only from the live Lift snapshot. The Jobs table separately shows the latest durable Lift header **Order Status** from an existing order-status snapshot or verified association; unsubmitted jobs show **Not in Lift**, and confirmed jobs without durable header evidence show **Not checked**. Jobs status projection performs no live Lift lookup. A historical `Submission Uncertain` attempt associated with a confirmed Lift order remains immutable but displays **no retry required** guidance. New confirmations record an additive `order_confirmed_at`; existing confirmed jobs use their last known confirmed activity for KPI continuity.

The API change updated only the primary Lambda and the code property of the already-disabled Proof scan worker; no data resource changed. All live Pathfinder gates, both campaign roots, the multi-proof ZIP policy, `go.vornan.co`, the scoped `TBD` → `0.5` rule, and every Proof boundary were preserved. All fifteen protected counts were identical before and after deployment. Natural scheduler correlation `b2b0ae3c-c5b9-4098-8c4e-402084d9df1f` replayed five known candidates with zero new jobs, Lift submissions, Wrike writes, or failures. Authenticated Admin smoke confirmed the triage strip, saved default view, Order Status column, full-width nine-line comparison, reconciled no-retry guidance, and prepared `MM/DD/YYYY` dates without invoking discovery, Lift refresh, or any mutation control.

### Deployed operational timestamp correction

PR #195 merged and deployed as application commit `e9f2f5397841241db71a164f002f609044f43293` on 2026-08-13. Merged-main validation `31716952564`, API workflow `31717446469`, and Admin workflow `31717869044` completed successfully. The release corrects the Admin interpretation of operational dates without changing stored production data or any Wrike/Lift transport path. Sanitized production evidence for Lift order `A0228506` showed that Lift's durable order header supplied only `creation_date: "2026-08-13"`, while Pathfinder retained the exact successful submit confirmation at `2026-08-13T14:28:17.997Z`. The former Admin parsed the date-only Lift value as UTC midnight, which rendered as Aug 12, 8:00 PM Eastern. Scheduler replays also advanced generic job `updated_at`, causing unrelated rows to share a timestamp and reorder.

The repository contract now distinguishes date-only from exact Lift creation. Pathfinder-created orders use their exact, immutable submit-confirmation time; historical or manually associated orders continue to show Lift's calendar date without inventing a time. Manual association time is never labeled as Lift creation. A projected **Last Activity** includes meaningful source changes, recovery, submit outcomes, confirmation, archival, publication, association, and Wrike writeback events, while excluding no-op discovery sightings and routine status checks.

Both full Jobs and Recent Jobs use **Pathfinder Intake**, **Lift Created**, and **Last Activity** consistently. Recent Jobs leads with failed, blocked, uncertain-confirmation, or stale Ready items, then fills the view with confirmed orders sorted by trustworthy Lift creation. Durable likely-candidate/failure evidence remains a pre-job **Pending Intake** issue and links to Intake Review rather than receiving a fake job identity. This slice adds only runtime projections and UI behavior; it requires no data migration and does not mutate existing jobs.

The API-first/Admin-second release updated only the primary API Lambda and the code property of the already-disabled Proof scan worker; no data resource changed. Authenticated production smoke confirmed `A0228506` at **Aug 13, 10:28 AM**, historical date-only `A0228322` as **Aug 11** without a fabricated time, issue-first Recent Jobs ranking, and consistent **Pathfinder Intake**, **Lift Created**, and **Last Activity** columns on full Jobs. All fifteen protected counts and every live gate remained unchanged. Natural scheduler correlation `9c3ac9ca-ef52-44ce-b997-6e97567fa08f` replayed six known candidates with zero preparations, Lift submissions, Wrike writes, or failures. Rollback is the prior API/Admin artifacts; no data rollback is required. Known limit: Lift historical headers that expose only a calendar date cannot supply a trustworthy time unless Pathfinder recorded the original submit confirmation.

### Deployed Pathfinder source-order clarity release

PR #186 merged and deployed as `fa1ed4389720bb4f2d1119794845e72af21de1ca` on 2026-08-12. API workflow `31621165048` / job `94196081887` and Admin workflow `31621719707` / job `94197937128` completed successfully. The API stack changed only the Lambda artifact and dependent API/EventBridge bindings; every existing parameter, protected data count, Import Method value, and Proof gate was preserved.

The release makes one Wrike Placard Order task the stable Pathfinder source-order identity across workbook versions and Import Method fingerprints. Safe pre-transport changes update the existing job and append source-order history. Once any sibling has a confirmed Lift order or a possibly transported submit attempt, later source changes are recorded for review without creating, publishing, or submitting a replacement order. `Submission Uncertain` remains a mandatory reconciliation state and is never automatically retried.

The Admin Jobs surface displays one current row per source order, nests prior technical records in the detail history, adds nontechnical state filters, and shows the Wrike Contract Number/campaign beside the Lift order number/name. Exact task/folder IDs remain authoritative. Discovery now returns the full Placard Order candidate set for the bounded Wrike result, identifies a visibility-only **Likely candidates** subset using at least two of ready status, Print Vendor, and Contract Number, and paginates it in the Admin. This heuristic does not weaken qualification or submit gates.

Qualified Wrike evidence now captures the task title and best-effort immediate campaign-folder display name. Display-name lookup failure cannot block intake. Multiple matching PDFs continue through the already deployed single-PDF/direct or multi-PDF/deterministic-ZIP service path; the slice adds sanitized delivery telemetry containing only task ID, delivery kind/count, publication ID, and evidence count.

Authenticated Admin verification confirmed that MDHHS order `JOB-280569` / `A0228322` is one visible **Order Confirmed** row with three retained Ready records nested under **Source order activity**, rather than four Jobs rows. Campaign `MDHHS - Eat Safe Fish FY 26 - GPA - C316969`, Contract Number, Lift order number/name, visible-only refresh, and all six state choices rendered correctly. The raw historical records and original uncertain submit attempt remain immutable data.

The first two natural scheduler cycles on the deployed API, correlations `52038d33-c022-4c18-bf99-88fd1b97a537` and `82c86045-ca75-4b61-ad0d-7a69bf155bcc`, each discovered and replayed five known orders with zero preparations, new jobs, Lift submissions, Wrike writes, candidate failures, or protected-count changes. All Pathfinder alarms were `OK` at release closure. No operator discovery or synthetic customer order was used for deployment validation.

### Vornan Proof

The isolated Proof stack has protected public read active for customer `1249` through `2026-08-25T23:59:59Z`. The canonical portal returns HTTP 200; the repository smoke confirms public read, rejects direct API bypass, and confirms decisions remain disabled. Customer approval, revised-art upload, operator grant creation, LTL Demo QA, Proof asset upload/scan/publication, and Lift action gates are disabled in the deployed stacks.

The isolated Proof Lambdas are deployed from `proof/dev/vornan-proof-lambdas-4acbc0eea1366376cee740a3ba0c9072025974b0.zip`. The existing versioned SPA was deliberately not republished during the bounded read renewal. Treat deployed default-dark code, protected read, SPA publication, and later capability activation as distinct steps.

The private Proof asset stack exists, `go.vornan.co` is configured, and GuardDuty Malware Protection is active for the asset boundary. Proof upload, asset delivery, and Lift publication capability outputs remain false.

### Merged Proof QA profile

PR #179 merged the Proof go-live/default-dark profile at `cd7e00e48d37abcc6ed41423f8731ff2c2e806de`; the shared API and isolated Proof Lambda artifacts now include it with every profile/mutation capability false. The owner-approved protected-read deadline `2026-08-25T23:59:59Z` is live. Any LTL Demo QA, customer-write, upload, scan, publication, operator-action, or Lift activation remains a separate future gate.

## Historical documents

The following files preserve useful decisions and implementation history but are not current operational truth:

- `docs/THREAD_HANDOFF_2026-07-18.md`
- `docs/WRIKE_AUTOMATED_INTAKE_LAUNCH_RUNBOOK.md`
- `docs/WRIKE_LIFT_PRODUCTION_LAUNCH_CHECKLIST.md`
- `docs/WRIKE_INGESTION_STRATEGY.md`
- `docs/VORNAN_PROOF_PHASE_0_CONTRACT.md`
- the opening dark-foundation assumptions in `docs/VORNAN_PROOF_ASSET_INFRASTRUCTURE.md`

Use those documents only after checking the current handoffs and live state.

## Task structure

Maintain three pinned tasks with distinct purposes:

1. **Pathfinder development** — Wrike/Lift operations, job monitoring and recovery, status surfaces, mappings, and production hardening.
2. **Vornan Proof development** — customer Proof experience, LTL Demo QA, revised-art lifecycle, and Proof deployment.
3. **Pathfinder live support** — production diagnosis and narrowly approved recovery only; it does not become a general development task.

Every development task that changes behavior must update its current handoff in the same repository checkpoint. Every production incident that changes known operational truth must update the live-support runbook or the relevant handoff after recovery.

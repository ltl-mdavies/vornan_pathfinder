# Pathfinder current state

This is the entry point for all new Pathfinder, Vornan Proof, and live-support tasks. Read this file before using older design notes, launch checklists, or thread handoffs.

Last reconciled: **2026-08-12**

Deployed application baseline: `origin/main` at `fa1ed4389720bb4f2d1119794845e72af21de1ca`

Live evidence: read-only AWS inspection, authenticated Admin smoke, and a bounded shared-path discovery run through 2026-08-12 in account `744016783602`, region `us-east-1`

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

### Pathfinder / Momentara

The production API stack is live. Scheduled Momentara intake is enabled every 15 minutes for customer `284619` and Import Method `method-1784901795973`, with up to 25 independent candidates per cycle. Scheduled Lift submission, status-comment writeback, workbook/reference-document publication through `go.vornan.co`, live Lift transport, and live-customer submission are enabled.

The production path is active; it is not a rehearsal or sandbox path. Manual rehearsal and legacy bounded discovery/writeback gates are disabled.

The operations control-plane release at `677005c5bf8910a931eeadfa878ba6f80204b97c` is deployed to the API and Admin. It adds visible-only Jobs refresh, shared-path operator discovery, pending-intake reasons, safe pre-transport mapping recovery, and a Lift target date-format boundary whose production default is `MM/DD/YYYY`. API workflow run `31505325973` and Admin workflow run `31506038490` completed successfully with production counts and live gates preserved.

The saved production Import Method contains both GPA Campaigns (`34000804`) and IBA Campaigns (`49405755`). Its `Order Form` hardware section stores the scoped quantity rule `TBD` → `0.5`; the 2026-08-11 deployment preserved that configuration unchanged.

The scheduler cycles beginning at `2026-08-11T15:42:53.213Z` repeatedly discovered seven contract-ready candidates, replayed six, and failed one during preparation. PRs #181 and #182 deployed bounded candidate telemetry at commits `cb237d379210c826cfdd16431482821488c343e4` and `4acbc0eea1366376cee740a3ba0c9072025974b0`. The first authoritative post-fix cycle (`a15a93c9-64f4-4d5b-8ee5-f2544d955418`) identified task `MAAAAAEN2Ujj`, stage `prepare`, reason `attachment_validation_failed`, with no job/evidence IDs. Operator inspection confirmed that two legitimate reference-proof PDFs had matched the production single-proof rule. Momentara temporarily replaced them with one combined proof, after which the natural scheduler created and submitted the order.

That Lift request timed out after Lift accepted it. Live Support reconciled stored Ext_ID `PFMSOZTWDUAF53` through Lift's import log and linked existing order `A0228322` to `JOB-280569` using the supported verified-association flow at `2026-08-11T18:54:43.225Z`; no create-order retry or direct data edit occurred. Scheduler correlation `02f1a162-2534-4d91-b072-3eec0a4a5fd2` then posted exactly one Wrike comment at `2026-08-11T18:58:23.826Z`, with zero Lift submits and zero candidate failures. The original `Submission Uncertain` attempt remains immutable history. Three later Ready siblings with the same source evidence are safely replayed and not submitted; normalizing them remains a separately authorized support action.

PR #184 merged the multi-reference-proof ZIP capability at `b6794380e44d3ca1ab22add3151525589ba6770c`. API workflow `31527788915` and Admin workflow `31528125205` deployed it on 2026-08-11 with every unrelated live parameter preserved. After a recoverable Import Method backup, Momentara was explicitly changed to `all_matching_current_attachments` with archive convention `<contract_number>_referenceProofs.zip`. Two to ten matching PDFs are retained as separate immutable evidence and packaged deterministically as one ZIP; one matching PDF continues through the unchanged direct-PDF path. The ZIP uses the existing `reference_proof_url` Lift field and `go.vornan.co` publication boundary.

The first natural cycle after activation prepared five replacement previews because the normalized Import Method fingerprint changed. Cross-job idempotency replayed every submit and produced no Lift order or Wrike write. Through `2026-08-12T15:35:43Z`, all 80 post-activation natural cycles completed at the 15-minute cadence with zero candidate failures, zero Lift submissions, and zero Wrike writebacks. A bounded operator discovery then returned five ready/reused orders, zero new previews, and 100 pending candidates, again with no Lift or Wrike action. The five currently qualified Wrike tasks already reconcile to confirmed Lift orders for Visit Montana (`A0228214`), MDHHS (`A0228322`), Fair Housing Commission (`A0228278`), Comcast Big South (`A0228190`), and ALDI HIN Store (`A0228162`). There is no evidence of a missed qualified order.

Current visibility debt: the Import Method's displayed **Last Run** does not reflect later replay-only scheduled cycles. Pending-candidate controls appear only after a discovery result exists in the current browser session, and the preserved historical `Submission Uncertain` attempt still contains generic retry-oriented guidance even after its order has been reconciled. Use exact Wrike task/evidence IDs as authoritative identity even when campaign names are displayed.

### Repository-ready Pathfinder Jobs triage slice (not deployed)

The `codex/pathfinder-jobs-triage` repository slice is additive and remains pre-merge/pre-deployment at this checkpoint. It persists each Jobs scope's last filter/sort selection in that browser, labels `created_at` as **Pathfinder Intake** rather than implying a Lift creation time, and adds a compact triage strip for confirmed orders, likely intake candidates, Ready jobs waiting more than 30 minutes, confirmation-needed submits, and failed/blocked jobs.

The same scheduled/operator discovery result now stores one bounded latest Wrike operations snapshot on the existing Import Method item. That runtime evidence has an optimistic conditional-write boundary, does not change the Import Method configuration timestamp or fingerprint, and cannot be overwritten by an older Admin form save. Jobs reads this snapshot without invoking discovery, so candidate review can survive browser sessions. This is a latest-state snapshot, not discovery-run history.

Confirmed job detail adds a full-width, read-only line comparison across canonical input, the reviewed Lift payload, and a freshly loaded current Lift order. Lift creation time appears only from the live Lift snapshot. The Jobs table separately shows the latest durable Lift header **Order Status** from an existing order-status snapshot or verified association; unsubmitted jobs show **Not in Lift**, and confirmed jobs without durable header evidence show **Not checked**. Jobs status projection performs no live Lift lookup. A historical `Submission Uncertain` attempt associated with a confirmed Lift order remains immutable but displays **no retry required** guidance. New confirmations record an additive `order_confirmed_at`; existing confirmed jobs use their last known confirmed activity for KPI continuity.

This section describes repository-ready behavior only. Until a later approved merge/deployment and read-only production validation are recorded, the deployed behavior remains the source-order clarity release above.

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

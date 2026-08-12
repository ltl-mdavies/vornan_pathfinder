# Pathfinder current state

This is the entry point for all new Pathfinder, Vornan Proof, and live-support tasks. Read this file before using older design notes, launch checklists, or thread handoffs.

Last reconciled: **2026-08-12**

Deployed application baseline: `origin/main` at `b6794380e44d3ca1ab22add3151525589ba6770c`

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

Current visibility debt: the Import Method's displayed **Last Run** does not reflect later replay-only scheduled cycles; pending intake is capped at 100 items sorted by task ID rather than recency; and Pathfinder job records do not yet retain/display the Wrike campaign name as a first-class identity. Use exact Wrike task/evidence IDs for authoritative reconciliation until those surfaces are hardened.

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

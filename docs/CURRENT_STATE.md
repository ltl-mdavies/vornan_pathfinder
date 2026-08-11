# Pathfinder current state

This is the entry point for all new Pathfinder, Vornan Proof, and live-support tasks. Read this file before using older design notes, launch checklists, or thread handoffs.

Last reconciled: **2026-08-11**

Deployed application baseline before this release-record checkpoint: `origin/main` at `4acbc0eea1366376cee740a3ba0c9072025974b0`

Live evidence: read-only AWS inspection and authenticated Admin smoke on 2026-08-11 in account `744016783602`, region `us-east-1`

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

The scheduler cycles beginning at `2026-08-11T15:42:53.213Z` repeatedly discovered seven contract-ready candidates, replayed six, and failed one during preparation. PRs #181 and #182 deployed bounded candidate telemetry at commits `cb237d379210c826cfdd16431482821488c343e4` and `4acbc0eea1366376cee740a3ba0c9072025974b0`. The first authoritative post-fix cycle (`a15a93c9-64f4-4d5b-8ee5-f2544d955418`) identified task `MAAAAAEN2Ujj`, stage `prepare`, reason `attachment_validation_failed`, with no job/evidence IDs. No job, order identity, submit attempt, source-evidence object, Lift write, status token, document publication, or Wrike writeback was created. The candidate-failure alarm remains `ALARM`; recovery is not authorized until the task's attachment-set/bytes failure is diagnosed and an exact action is approved.

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

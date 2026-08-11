# Pathfinder current state

This is the entry point for all new Pathfinder, Vornan Proof, and live-support tasks. Read this file before using older design notes, launch checklists, or thread handoffs.

Last reconciled: **2026-08-11**

Repository baseline before the scheduler-telemetry checkpoint: `origin/main` at `cd7e00e48d37abcc6ed41423f8731ff2c2e806de`

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

The scheduler cycles beginning at `2026-08-11T15:42:53.213Z` repeatedly discovered seven contract-ready candidates, replayed six, and failed one during preparation. No job, order identity, submit attempt, Lift write, status token, or Wrike writeback was created. The deployed aggregate telemetry cannot identify the failed task or retain its stable reason code, so the candidate-failure alarm remains a shared-API deployment blocker. The bounded telemetry checkpoint records sanitized task, stage/reason code, and existing job/evidence identifiers without logging exception messages, customer values, or payloads.

### Vornan Proof

The isolated Proof stack has public read configured for customer `1249`, but its deadline expired at `2026-08-10T00:00:00Z`; the static portal returns HTTP 200 while the public API currently returns HTTP 403. Customer approval, revised-art upload, operator grant creation, and Proof asset upload are disabled in the deployed stacks.

The repository contains merged Proof revised-art completion and default-dark QA infrastructure at merge commit `cd7e00e48d37abcc6ed41423f8731ff2c2e806de`; the separate Proof public Lambda remains deployed from `13a072fab68a1ed6890c19b4e27fb55631b1f420`. Treat deployment and activation as distinct steps.

The private Proof asset stack exists, `go.vornan.co` is configured, and GuardDuty Malware Protection is active for the asset boundary. Proof upload, asset delivery, and Lift publication capability outputs remain false.

### Merged Proof QA profile

PR #179 merged the proposed Proof go-live/default-dark profile at `cd7e00e48d37abcc6ed41423f8731ff2c2e806de`. Focused and full check/test/build, 118 deployment-contract tests, 13 Playwright tests, and GitHub validation run `31508437012` passed. It is **not deployed**. The owner approved renewing protected read through `2026-08-25T23:59:59Z`; that deadline is not live until a separately inspected deployment succeeds. Every customer-write, upload, scan, publication, operator-action, and Lift gate must remain false.

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

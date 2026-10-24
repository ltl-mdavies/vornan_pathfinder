# Pathfinder UX — isolated integration acceptance

Date: 2026-10-24. Base: `e7f75a8`. Worktree: `/private/tmp/pathfinder-ux-shell`, branch `codex/pathfinder-ux-shell`.

## Scope and decision

This checkpoint extends the approved administration review with realistic local save outcomes and richer editor data. It does **not** authorize a push, deployment, live credential change, provider request, order submission, or customer notification. Pathfinder Development remains the release coordinator; Pathfinder UX independently reviews the frozen candidate.

The test entry point imports the actual Admin App. The new simulator is imported only by `tests/ux/src.tsx`; production builds do not use it. See `tests/ux/README.md` for reproducible scenarios and reset behavior.

## Contract boundaries

| Surface | Exercised locally | Not established by this review |
| --- | --- | --- |
| Canonical registry | Create/metadata validation, duplicate rejection, save failure/retry, history, snapshots, reload persistence | Real durable storage, concurrent writers, path migration, deletion, export authentication |
| Customer routes | Name-only save/reload, exact customer identity, other edits blocked | Changes to templates, mapping strategy, endpoint, target, environment or credentials |
| Import methods | Real Wrike/REST source types; name-only persistence contract | Provider discovery, ingestion, schedule activation, mapping edits or source-policy saves |
| Source connections | Configured metadata and read-denied states, disabled provider capabilities | OAuth grants, credential storage, provider tests or Wrike writes |
| Proofing API setup | Masked presence metadata and denied reads | Credential writes/clear, Lift actions, public Proof permissions or approval actions |
| Access | Existing error presentation for synthetic denied requests | Authentication success or a new role/permission model |

Current Admin API authority is authenticated users with allowed email domains when authentication is required. Feature-specific routes add their own gates/customer/operator constraints. Do not describe the synthetic denied-write flag as a new viewer/editor/admin role system.

## Evidence so far

- Browser: failed canonical create retained entered path/label and focused a scoped error; retry created the draft; reload retained the field; Governance opened its snapshot.
- Browser: a name-only Momentara route save succeeded and remained after reload.
- Browser: configured Proofing API fields showed presence indicators with blank credential inputs. No credentials were entered or sent.
- Browser finding: a failed Governance snapshot read left the page unchanged with no visible error. Captured before any correction in `/private/tmp/pathfinder-integration-evidence/governance-read-failure.png`.
- Contract tests: 11 additional tests cover persistence, duplicate/invalid input, metadata snapshots, retry, denied writes, customer isolation, unsupported writes, source types, masked credentials, unavailable storage and opt-in/origin guards.

## Narrow corrections from the independent review

1. **IR1 — silent snapshot failure:** Governance now shows a scoped, focused error with **Retry snapshot** targeting the failed snapshot ID. The failure no longer goes into the unrelated customer workspace message. Browser-tested retry opens the snapshot and removes the alert.
2. **IR2 — false absence after Proofing read failure:** a failed or loading configuration read no longer asserts “Not configured” or “Not saved.” It shows unavailable/loading and unknown credential presence. Edit/save/clear require a successful read for the exact target/environment. **Retry configuration** repeats the read; credential payloads and replacement/clear confirmation remain unchanged. Browser-tested QA1 retry recovered only QA1; PROD remained unknown with Save disabled.
3. **IR3 — previous method feedback on another record:** returning to the method list or opening a method clears the previous workspace message. No method persistence or intake logic changed.

Five further tests cover read recovery, unknown-state presentation, read-before-write guards, scoped snapshot feedback and method-feedback clearing. The approved layouts and CSS are unchanged. Production edits are limited to `apps/web/src/App.tsx` and the internal administration component `apps/web/src/ProofingApiSetup.tsx`; no public Proof viewer, Status, API or domain implementation was edited.

Independent Pathfinder UX retest accepted IR1–IR3 on 2026-10-24. It also verified registry create/edit and route/manual-method save recovery, reload persistence, denied method save retaining the unsaved name, configured connection reads, and the actual Wrike/REST editor compositions. Report: http://127.0.0.1:5206/integration-review/. Evidence 12–17 records corrected states. Earlier-snapshot/nonzero comparison is covered by the simulator contract test, **not** demonstrated by the current UI review.

Frozen implementation SHA-256:

- `apps/web/src/App.tsx`: `13f9bb633d77be0cdea9acff287be48704acd164e2003b829f97b0ef0d48804a`
- `apps/web/src/ProofingApiSetup.tsx`: `223b974f77fdb400026d47ea32c031677c14d1fb3b32cdd5a596b7a3627dec54`
- `tests/ux/integration-fixtures.ts`: `bffb34d479472232da47b9eeaa3132a29985fac4a2e87d9967a74fcd61d2ebb7`
- `tests/ux/src.tsx`: `d1ca45fb32483a360c41c8363b081abb1d05b809dff0471bf2b3fe7c36dd2970`

Current-run screenshots live in `/private/tmp/pathfinder-integration-evidence/`. They contain synthetic data. Browser evidence and contract tests are complementary; neither establishes live provider behavior.

## Validation

- Full workspace typecheck: passed.
- Admin production build: passed; existing large-bundle warning remains.
- Strict standalone fixture typecheck: passed.
- Final regression suite after corrections: **1,357 passed** — API 800, public Proof 76, Order Status 17, Admin 224, domain/adapter packages 240.
- Initial sandbox run could not bind temporary API test-server sockets (`EPERM`); the same suite passed after local socket access was permitted. No application workaround was introduced.

## Remaining release gates

1. Exercise certified, duplicate and uncertain submit/reconcile states through bounded fixtures. No provider write permission is implied.
2. Reconcile the candidate against the then-current release baseline and parallel work. Do not overwrite subsequent fixes in intake, public Proof, Status or API.
3. Before any deployment, follow the repository deployment requirements, identify exact artifacts/resources and rollback, rerun relevant tests against the integrated candidate, and obtain the required release authorization.

This document is an acceptance ledger, not a declaration that every integration or release gate has passed.

# Vornan Proof Phase 2 activation-readiness gate — 2026-07-21

## Outcome

The isolated read-only evidence set and explicit internal LTL Demo read-only approval are complete. The deployed Proof stack remains dark pending a separate manual change review.

The machine-readable state in `docs/VORNAN_PROOF_PHASE_2_READINESS_STATE_2026-07-21.json` records only bounded booleans. `npm run check:proof-phase2` evaluates that state without contacting AWS, changing infrastructure, sending a message, reading another Lift order, or enabling a feature flag.

Current result:

- Status: `ready_for_explicit_activation_review`.
- Isolated read-only evidence: 11 of 11 gates passed.
- Dark guardrails: 8 of 8 gates passed.
- Activation-review prerequisites: 3 of 3 passed.
- Next action: `perform_human_activation_review`.
- Public-read change authorized: `false`.
- Mutation authorized: `false`.

## Evidence represented

The bounded state is derived from the reviewed repository evidence for:

- the deployed zero-data dark boundary;
- the purgeable non-customer synthetic lifecycle;
- the explicitly approved direct-Lift read-only synchronization;
- the explicitly approved Pathfinder-originated read-only synchronization;
- cache-refresh stability and `ORDER_LINE_ID` correlation;
- audit, queue/DLQ, telemetry, alarm, log, and responsive fail-closed checks.

The evaluator accepts only literal boolean values for its named gates. Missing values and strings such as `"true"` fail closed. Extra fields are ignored and cannot enter its output, preventing order numbers, customer details, email addresses, URLs, tokens, or free-form notes from becoming readiness telemetry.

## Activation-review status

The temporary, purgeable dev-only QA window completed the first two prerequisites:

1. The deployed grant/session lifecycle passed through CloudFront.
2. The deployed one-order customer boundary passed on desktop and mobile using the reserved synthetic fixture.

Marcus subsequently approved a one-week internal read-only window for the LTL Demo cohort, with `mdavies@ltlco.com` owning monitoring, rollback, support, and escalation. This satisfies the bounded approval prerequisite but does not authorize a deployment. Full boundary evidence is recorded in `docs/VORNAN_PROOF_CUSTOMER_BOUNDARY_QA_EVIDENCE_2026-07-21.md`.

The activation-review packet records the dev/cohort/time scope and operating ownership. `npm run check:proof-activation-review` reports `ready_for_manual_read_only_activation_review` while always keeping public-read, grant-creation, deployment, DNS, email, decision, Lift-write, and Phase 3 authorization false. See `docs/VORNAN_PROOF_READ_ONLY_ACTIVATION_REVIEW_PACKET_2026-07-21.md`.

With all three recorded as passed, the evaluator returns `ready_for_explicit_activation_review`; it never authorizes a deployment or mutation. A human must still review the exact feature-flag change and rollback plan.

## Guardrails retained

Public reads, authenticated grant creation, link email, DNS, `ReadOnlyQaConfirmed`, production public-read approval, Proof decisions, and every Lift write remain disabled. This slice does not modify Pathfinder production surfaces and does not advance Phase 3.

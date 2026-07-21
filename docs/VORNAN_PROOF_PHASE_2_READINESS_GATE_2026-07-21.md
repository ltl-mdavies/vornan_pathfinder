# Vornan Proof Phase 2 activation-readiness gate — 2026-07-21

## Outcome

The isolated read-only evidence set is complete, and the deployed Proof stack remains dark. Customer activation is still blocked.

The machine-readable state in `docs/VORNAN_PROOF_PHASE_2_READINESS_STATE_2026-07-21.json` records only bounded booleans. `npm run check:proof-phase2` evaluates that state without contacting AWS, changing infrastructure, sending a message, reading another Lift order, or enabling a feature flag.

Current result:

- Status: `isolated_read_qa_complete_activation_blocked`.
- Isolated read-only evidence: 11 of 11 gates passed.
- Dark guardrails: 8 of 8 gates passed.
- Activation-review prerequisites: 0 of 3 passed.
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

## Deliberately unmet activation gates

These actions remain separate and require explicit approval before execution:

1. Exercise the deployed grant/session lifecycle under a reviewed activation window.
2. Validate the deployed one-order customer boundary on desktop and mobile.
3. Record explicit approval for read-only customer activation.

Even when all three are eventually recorded as passed, the evaluator returns `ready_for_explicit_activation_review`; it never authorizes a deployment or mutation. A human must still review the evidence and separately approve any feature-flag change.

## Guardrails retained

Public reads, authenticated grant creation, link email, DNS, `ReadOnlyQaConfirmed`, production public-read approval, Proof decisions, and every Lift write remain disabled. This slice does not modify Pathfinder production surfaces and does not advance Phase 3.

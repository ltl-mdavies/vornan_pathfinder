# Proof upload QA gate correction — October 29, 2026

## Scope and ownership

Proof owns the product correction; Pathfinder Development owns integration,
public-only release wiring and live deployment. Source is the isolated
`pathfinder-proof-revision-ui.T2TVpJ` checkout. Do not deploy this entire older
branch over main; cherry-pick only the reviewed correction.

The authorized test remains customer 1249 / A0232139 / line 3, one synthetic
QA-only revised-art submission. Other orders, operator actions and customer
launch defaults are not authorized for activation.

## Failure evidence

The first live attempt failed at prepare-upload because the persistent Demo
profile supplied a null upload expiry. The upload service requires a finite
future expiry, while the public order response previously advertised upload
access from the profile flag alone. No file PUT or Submit artwork occurred.
Development's exact-order checks found no matching synthetic asset, receipt,
action claim or upload/decision audit. Submission was switched off and canonical
configuration reconciled; exact recovery scope remains `1249:A0232139`.

## Contract

`PATHFINDER_PROOF_ASSET_UPLOAD_QA_WINDOW` defaults empty. A nonempty value is
`YYYY-MM-DDTHH:mm:ss[.sss]Z|A0232139`: exactly one order, UTC expiry in the next
24 hours. Invalid, expired, multi-order and all-order values deny without
falling back to broader profile scope. The existing upload enable flag/profile,
bucket, authenticated review authority, participant and customer-1249 boundary
remain required. This is not a submission, scan or publication enable flag.

Shared gate/order predicates align public capability, prepare, finalize and
upload-status checks. Separate submission-receipt recovery remains available
after writes are disabled. No UI copy/layout or authentication changes.

## Validation

- 230 Proof API tests pass, sequential full suite. One earlier parallel run had
  a local socket reset in an unrelated admin discovery test; sequential rerun
  passes all tests.
- API TypeScript check passes; diff whitespace check passes.
- New regressions cover persistent null expiry, valid single-order window,
  expiry, malformed override, no broader fallback, disabled/missing bucket,
  cross-customer denial and all upload routes denying before side effects.
- Pathfinder UX carried forward approval for this backend eligibility alignment
  on October 29. No new visual design review required.

## Release and test hold

This record is a handoff, not evidence of deployment. Development must add
public-Lambda-only configuration wiring (empty default), inspect exact resource
diffs, retain the deployed rollback artifact and use live revision preconditions.
Submission stays off. No frontend build is needed for this correction.

Readiness inspection also found the deployed scanner disabled without event
mapping, and publication disabled. The scanner's default observer processes
malware evidence only; publication is a separate guarded service. Existing
infrastructure intentionally separates these gates from persistent Demo QA.
Do not retry uploads, broadly extend the Demo profile, fabricate scan results,
or bypass publication/delivery verification. A compatible exact-object scan
and exact-order publication plan is required before the live test can continue.
Any manual QA pathway must not be described as an automated customer pipeline.

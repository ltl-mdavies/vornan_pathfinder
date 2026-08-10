# Vornan Proof go-live handoff — 2026-08-10

## Mission

This document distinguishes the Proof experience visible today from source-ready work and future activation. Do not use merged code or historical phase documents as proof that a live capability is enabled.

## Live customer boundary

Read-only inspection of `vornan-proof-dev` on 2026-08-10 confirmed:

- protected public read is enabled and production-public-read approval is true;
- the current customer cohort is LTL Demo customer `1249`;
- customer approval is disabled;
- customer revised-art upload is disabled;
- operator grant creation is disabled;
- Proof asset upload is disabled.

The public Proof portal can display synchronized reviewed/reference proofs through valid grants and sessions. Customer decisions and uploads must not be represented as live while the deployed flags remain false.

The separate public Proof Lambda is deployed from artifact `proof/dev/vornan-proof-lambdas-13a072f.zip`. Current `origin/main` contains newer merged customer revision runtime and UX. A controlled Proof-stack deployment is therefore required before that merged runtime can be tested or activated in the public application.

## Pathfinder API Proof boundary

The production Pathfinder API is bound to the dedicated Proof core and audit tables and the private Proof asset bucket. Its current Proof action, grant, customer approval, customer revision upload, upload, scan-worker, advanced-review, and email flags are false.

This means the authenticated admin can inspect and synchronize within its allowed read boundary, but no current API flag should be assumed to authorize a customer Proof write.

## Private asset boundary

Read-only inspection of `vornan-proof-assets-dev` confirmed:

- private Proof asset bucket: `vornan-pathfinder-proof-assets-dev-744016783602`;
- `go.vornan.co` alias configured;
- GuardDuty Malware Protection enabled with plan status `ACTIVE`;
- retained source eligibility: 90 days;
- Proof upload capability output: false;
- Proof delivery capability output: false;
- Lift publication capability output: false;
- Wrike document delivery is enabled through its separate bucket.

An active malware plan and configured alias do not make revised-art upload or Lift publication live.

## Repository-ready work

Current main includes:

- customer-facing revised-art modal and private upload flow;
- exact order/line/attachment/version binding;
- checksum-bound direct upload initiation/finalization;
- durable sanitized asset/audit records;
- upload sync-race correction;
- Proof portal CORS support on the private asset bucket;
- one-PUT, zero-automatic-retry decision architecture;
- shared-attachment awareness and high-resolution viewer improvements.

These capabilities remain subject to deployment, configuration, and controlled evidence. Revised artwork must not reach Lift until scan clearance, publication/readiness, exact current-proof reconciliation, and the revised-art action runtime are all demonstrated together.

## Pending unified LTL Demo QA profile

Branch `codex/proof-demo-qa-profile`, commit `02357b3`, proposes one coherent default-off QA profile for customer `1249`. It combines a shared bounded expiry, longer review sessions, customer approval, and private revised-file intake while keeping email, operator actions, scan-worker activation, publication, and revised-art Lift submission off.

That branch is one commit ahead and four commits behind current main as of 2026-08-10. It is not merged or deployed. The next Proof development task should:

1. rebase/reconcile the profile against current main;
2. verify it does not alter any live Wrike/Lift production parameter;
3. rerun the complete Proof and deployment-safety suites;
4. merge it as a default-off capability only;
5. deploy both API and Proof stacks with the profile still false;
6. verify production Wrike before and after the shared API deployment;
7. separately activate the profile for an explicit LTL Demo window.

## Recommended QA sequence

1. Deploy current merged Proof artifacts with all customer-write flags false.
2. Verify current public read and all production Pathfinder/Wrike health.
3. Merge and default-dark deploy the reconciled unified LTL Demo QA profile.
4. Open one coherent LTL Demo window rather than coordinating independent short expiries.
5. Create only the intended review grant; do not send email.
6. Confirm public read and current-proof refresh on a real LTL Demo order.
7. Test one customer approval with exact attachment binding, durable audit, one PUT, and authoritative readback.
8. Test one private revised-art upload through finalization and malware scan evidence.
9. Add publication and transient direct-delivery resolution only after clean scan evidence.
10. Test the revised-art Lift action last, with no automatic retry and immediate authoritative reconciliation.

## Go-live definition

Proof is not live for customer actions until all of the following are true:

- current public artifacts are deployed;
- customer cohort and access-grant policy are explicit;
- current proof links refresh without exposing signed URLs in durable storage;
- simple approval and multi-proof quantity workflows pass current-order tests;
- request-changes semantics match observed Lift behavior;
- revised-file upload, scan, publication, Lift ingestion, and resynchronization pass end to end;
- shared `ATTACHMENT_ID` actions clearly affect every associated Lift line;
- failures stay reconciling and never cause blind replay;
- customer-facing session expiry and recovery are understandable on desktop and mobile;
- production Pathfinder/Wrike behavior is unchanged after every shared deployment.

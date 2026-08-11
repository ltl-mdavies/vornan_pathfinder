# Vornan Proof go-live handoff — 2026-08-10

## Mission

This document distinguishes the Proof experience visible today from source-ready work and future activation. Do not use merged code or historical phase documents as proof that a live capability is enabled.

## Live customer boundary

Read-only inspection of `vornan-proof-dev` on 2026-08-11 confirmed:

- protected public read and production-public-read approval are true through `2026-08-25T23:59:59Z`;
- the current customer cohort is LTL Demo customer `1249`;
- customer approval is disabled;
- customer revised-art upload is disabled;
- operator grant creation is disabled;
- Proof asset upload is disabled.

The static Proof portal returns HTTP 200. The repository smoke confirms public read is active, decisions are disabled, and direct API bypass is rejected. Customer decisions and uploads must not be represented as live while the deployed flags remain false.

The owner-approved protected-read deadline `2026-08-25T23:59:59Z` is deployed. Renewal preserved every customer-write, upload, scan, publication, operator-action, and Lift gate as false.

The public, operator, and sync Lambdas are deployed from `proof/dev/vornan-proof-lambdas-4acbc0eea1366376cee740a3ba0c9072025974b0.zip`, S3 version `kZUebVL24nt9maVGwoRI7raxiLzzxfuY`, ETag `b3cd2b6b069024e9589178ed93dc30d7`, and Lambda code SHA-256 `FbJzzJysNr1s7IVnjxY9YOhAmy6461S/VZM/6q11fLo=`. The bounded renewal did not republish the existing versioned SPA; its predeployment `index.html` version `RnDarblxRCIiGrbmzqxTZgYgdN.w7xd.` remains the rollback/publication boundary.

The renewal and smoke wrote no Proof records: core remains 142 and audit remains 147. There are 16 retained grants, 0 active grants, 0 sessions, and empty sync/DLQ queues. All ten Proof alarms are `OK`. No executable change set remains.

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

## Merged unified LTL Demo QA profile

PR #179 merged the reconciled profile at `cd7e00e48d37abcc6ed41423f8731ff2c2e806de`. Its default-dark runtime is deployed and inactive.

The reconciled profile is fixed to customer `1249`, requires explicitly allowlisted demo orders, caps activation at 24 hours and sessions at 12 hours, and preserves the existing grant/session/CSRF/participant/current-proof checks and durable audit. It deliberately splits responsibility: the shared API may create review grants without exposing public reads, while the isolated Proof stack may serve valid review sessions and private upload without creating grants. Email, scan processing, publication, direct asset delivery, operator action QA, and Lift submission remain independent and false.

The exact configuration, activation, shutdown, and diagnostic contract is in `docs/VORNAN_PROOF_LTL_DEMO_QA_PROFILE.md`.

## Revised-art completion in merged main

The same branch adds repository-side, default-dark completion beyond private finalization:

- exact GuardDuty clean-result classification remains fail-closed for threat, unsupported, access-denied, and failed outcomes;
- supervised publication copies the exact versioned source to a checksum-verified versioned outbound object;
- an opaque `a/plocator_*` copy is verified through a direct, non-redirecting HTTP `200` response at `go.vornan.co`;
- the durable asset record retains order, task, attachment, replaced Proof version, revision, source version, publication, outbound version, checksums, delivery hash, audit, retention, and packet membership;
- the direct URL is reassembled transiently and accepted only when its hash matches the durable locator record;
- `lift_not_before_epoch` is server-authored at verified delivery plus two seconds;
- `REVISED_ART_WILL_BE_SENT` remains one supervised prepared action, crosses `submission_uncertain` before one PUT, performs immediate authoritative reconciliation, and never retries automatically;
- the retained source record remains the order-support source for later individual or ZIP delivery views.

No upload, scan, publication, `/a/*` delivery, credential read, Lift call, deployment, grant, or production mutation was performed while preparing this repository checkpoint.

## Remaining checkpoints after protected-read renewal

1. Diagnose Pathfinder task `MAAAAAEN2Ujj`'s `attachment_validation_failed` leaf cause under a separately approved read boundary; do not recover or resubmit it from this Proof task.
2. Decide whether and when to republish the current Proof SPA as a separate versioned release; the protected-read renewal deliberately retained the previous SPA.
3. Activate the LTL Demo profile separately for one exact allowlist/expiry and test valid review sessions/current proofs.
4. Activate upload separately and finalize one bounded file.
5. Activate the exact-object scan worker and require `NO_THREATS_FOUND`; stop on every other result.
6. Activate `/a/*` delivery and publication separately, publish one cleared version, and record direct HTTP `200`, content type, length, checksum, version, and settle barrier evidence.
7. Activate operator action QA last, prepare and confirm exactly one `REVISED_ART_WILL_BE_SENT`, then reconcile authoritatively with zero retry and close all temporary gates.

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

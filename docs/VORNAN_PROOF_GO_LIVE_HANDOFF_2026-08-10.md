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

The public, operator, and sync Lambdas are deployed from final application commit `9f78d2d4b122984c53bc3b96506588996768f5d0` using `proof/dev/vornan-proof-lambdas-9f78d2d4b122984c53bc3b96506588996768f5d0.zip`, S3 version `3mP27wYjTHhnzgYnJm6.tOp0v.UTEn.o`, ETag `5c8c474a0a2f73f2a805bc79a39219af`, package SHA-256 `07c9259d311eec7a0d6045b5a3b8c5d70f22624879bd29e5bad55261c5d3d06d`, and Lambda code SHA-256 `B8klnTEe7HoNYEW1o7jF1w8iYkh5vSnlutVSYcXT0G0=`. The versioned SPA was republished from the same commit: `index.html` version `03EBjq4DDFwqGnJvTNGMt1gZ7aarlath`, ETag `e7e1aa16c99cd940a543d2253dbc1548`, invalidation `IEDO6513H0SVOONZ84QB7H38VV` (`Completed`). The prior Lambda artifact/version and SPA version `RnDarblxRCIiGrbmzqxTZgYgdN.w7xd.` remain the application rollback boundary.

The deployment and smoke wrote no Proof records: core remains 142 and audit remains 147. There are 16 retained grants, 0 active grants, 0 sessions, and empty sync/DLQ queues. All ten Proof alarms are `OK`. The repository smoke confirms protected public read, decisions disabled, and direct API bypass rejected. No executable change set remains.

The isolated public runtime now has `dynamodb:GetItem` only on the exact existing `Pathfinder-CustomerWorkspaces-prod` table ARN. It has no workspace `Query`, `Scan`, write, index, or wildcard access, and the operator/sync roles have no CustomerWorkspace access. New bound grants/sessions can therefore re-read and fail closed on missing, malformed, changed, disabled, or cross-customer customer policy/identity. This permission is read-only; it does not activate grants, approvals, uploads, publication, or Lift action. Normal customer enablement now depends on a setup-time verified Proof/Lift identity stored in the exact customer workspace and audited with optimistic versioning. No identity was verified and no customer setting was saved during this deployment.

The Pathfinder Admin now displays the setup-driven Proof control plane. Authenticated production smoke showed the existing customer policy, **Verification required**, the one-order identity verification field, default access/profile choices, and exact-order exception UI. No verification, save, exception, grant, session, or customer action was invoked. First customer launch remains **Simple only**; Advanced public customer transport is still unavailable.

Rollback is application-only: restore `proof/dev/vornan-proof-lambdas-4acbc0eea1366376cee740a3ba0c9072025974b0.zip` (S3 version `kZUebVL24nt9maVGwoRI7raxiLzzxfuY`, Lambda SHA-256 `FbJzzJysNr1s7IVnjxY9YOhAmy6461S/VZM/6q11fLo=`), preserving the exact current public-read expiry and every dark mutation gate; restore SPA `index.html` version `RnDarblxRCIiGrbmzqxTZgYgdN.w7xd.` and invalidate CloudFront. Never restore/replace ProofCore, ProofAudit, CustomerWorkspaces, asset, or Pathfinder tables. If any later customer setting has been enabled, disable/revoke it through the supported control path before runtime rollback; do not bypass policy revalidation.

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

## Setup-based customer enablement requirement

Customer onboarding must not require a new application artifact, CloudFormation
deployment, or per-customer environment variable. Pathfinder already persists an
authenticated, audited customer Proof policy with these operator-facing choices:

- `Proof off`, `View only`, or `Review enabled`;
- `Simple` or `Advanced` review when review is enabled; and
- an exact Lift-order override when one order needs different behavior.

That policy is the required long-term customer control plane. The stacked
`codex/proof-setup-enablement-runtime` repository slice makes it authoritative
for new grants and sessions, customer-safe review-profile projection, customer
approval, and revised-art upload authorization. New grants retain an immutable
binding to the exact customer/order policy version; missing or ambiguous order
association and unbound review access fail closed. Changing a customer default
or exact-order exception revokes affected active grants before the new
conditional setting write, so an existing session cannot retain a stale review
profile. Simple review remains quantity-free; Advanced is the only profile that
exposes the multi-proof allocation workspace.

The same slice replaces broad customer-setting persistence with a strongly read,
exact-workspace conditional write. A stale Admin page receives `409` instead of
overwriting another operator's change. The selected customer workspace and its
bounded Proof-setting audit are the only Pathfinder records written. Import
Methods, mappings, Jobs, submit attempts, order IDs, Lift/Wrike state, and all
other customer workspaces are not part of this write path.

This is repository state only until the stacked slice is reviewed, merged,
deployed default-dark, and exercised in the bounded QA sequence. Platform-wide
deployment flags still decide whether a capability exists and remain emergency
kill switches. Do not describe the Admin setting as live customer enablement
until the integration has passed end-to-end QA.

The intended operating model is:

1. deploy each Proof platform capability once behind an emergency global kill
   switch;
2. onboard or disable a customer through their saved Pathfinder Proof settings;
3. resolve the exact customer and optional order override from durable order
   association on every sensitive request;
4. fail closed for missing, ambiguous, stale, disabled, or unsupported policy;
5. record actor, previous/next policy, profile version, order scope, and time in
   durable audit without changing Import Methods, mappings, Jobs, submit attempts,
   order IDs, or Wrike/Lift scheduler state; and
6. persist a setting change through a narrow conditional write to the exact
   customer policy/workspace version, never through a broad whole-store rewrite;
   and
7. make every saved capability/profile change revoke affected active grants so
   new grants and decisions use only the newly saved policy.

Infrastructure gates remain platform emergency controls. They must not become
the normal per-customer onboarding mechanism.

### Closing repository slice: durable customer authority

The stacked `codex/proof-customer-authority-revalidation` slice closes the two
remaining repository gaps without activating production:

- Admin verifies one exact associated current Lift order and derives the Proof/
  Lift customer ID from the authoritative Proof read. The server never accepts a
  client-supplied customer ID.
- The mapping is stored inside the exact CustomerWorkspace Proof policy with the
  verification order, actor, timestamp, conditional policy version, and a
  durable identity audit entry. Reverification also records audit.
- Enabling customer or order Proof access requires that verified identity. New
  grants bind the Pathfinder customer, verified Proof customer, identity time,
  order, resolved default/override source, access mode, profile, and policy time.
- Normal bound grants and approval/upload synchronization compare the Lift order
  customer to that durable identity. `PATHFINDER_PROOF_GRANT_ALLOWED_CUSTOMER_IDS`
  is no longer normal customer authorization; it remains only for the legacy
  isolated view-grant operator window. LTL Demo QA remains independently fixed
  to customer `1249` plus its exact order allowlist and expiry.
- The isolated public Lambda receives read-only `GetItem` permission for the
  exact existing CustomerWorkspaces table. Before a bound token exchange and on
  every bound session request, it consistently reads only that customer record
  and re-resolves the exact order mode/profile/version. Missing, malformed,
  disabled, cross-customer, changed, or stale authority returns the generic
  access denial even if grant revocation failed.
- Legacy unbound view-only grants retain read compatibility; unbound review
  authority remains denied. No new customer review grant can use that legacy
  path.

This adds no table, index, backfill, broad scan, or destructive migration. The
isolated stack gains two parameter bindings (CustomerWorkspaces name and ARN),
one exact-table `dynamodb:GetItem` statement, and one non-secret environment
entry. Default-dark deployment must preserve the live customer workspace table
and must not create or replace it.

The first customer launch remains **Simple only**. Advanced may remain saved for
future operator/UX qualification, but its public multi-proof submission transport
is still unavailable and must not be represented as customer-live.

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

1. Merge the corrected bounded-window monitor and confirm it reports the current protected public-read posture without granting mutation authority.
2. Review, merge, and default-dark deploy the stacked setup-enablement and customer-authority runtime slices, then prove conditional writes, verified identity, exact-table public revalidation, grant binding, session denial after policy drift, public profile, decision, and grant revocation without changing production customer settings.
3. Activate one exact order override for the approved Momentara/LTL Demo pilot and verify that unrelated customer settings, orders, and Pathfinder runtime records are unchanged.
4. Activate the LTL Demo profile separately for one exact allowlist/expiry and test valid review sessions/current proofs.
5. Activate upload separately and finalize one bounded file.
6. Activate the exact-object scan worker and require `NO_THREATS_FOUND`; stop on every other result.
7. Activate `/a/*` delivery and publication separately, publish one cleared version, and record direct HTTP `200`, content type, length, checksum, version, and settle barrier evidence.
8. Activate operator action QA last, prepare and confirm exactly one `REVISED_ART_WILL_BE_SENT`, then reconcile authoritatively with zero retry and close all temporary gates.

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

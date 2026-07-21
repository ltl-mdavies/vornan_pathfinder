# Vornan Proof read-only activation review packet — 2026-07-21

## Decision

The Phase 2 evidence is sufficient to prepare a narrowly scoped read-only activation review, but no customer activation is authorized. The `vornan-proof-dev` stack remains dark.

The architecture permits a read-only pilot before Phase 3 writes. That pilot still requires exact order/time scope, named monitoring and rollback ownership, support escalation, explicit approval, and a separate human review of the proposed flag changes. This packet records those requirements without enabling public read, grant creation, email, DNS, decisions, or any Lift write.

## Current bounded result

Run:

```text
npm run check:proof-activation-review
```

Current status: `activation_review_packet_incomplete`.

- Phase 2 evidence: complete.
- Dark guardrails: intact.
- Deployed grant/session and responsive one-order boundary: complete.
- Activation scope: 3 of 4 controls recorded.
- Operating controls: 2 of 6 recorded.
- Safety constraints: 7 of 7 intact.
- Public-read change authorized: `false`.
- Grant-creation change authorized: `false`.
- Deployment, DNS, email, decision, Lift-write, and Phase 3 authorization: `false`.

## Approved order scope

The user explicitly approved Lift order `A0226753` for this future read-only window. It is the controlled Pathfinder-originated Momentara demo order previously validated in `docs/VORNAN_PROOF_PATHFINDER_ORIGIN_READ_ONLY_QA_A0226753_2026-07-21.md`.

- Pathfinder job: `job_20260721171005_2cf369`.
- Pathfinder / Lift `Ext_ID`: `PFMRUWSQ4N1735`.
- Destination: LTL Demo sandbox profile, customer `1249`, company `91`.
- Cached shape: three mapped lines, total quantity 31, with exact `ORDER_LINE_ID` correlation already confirmed.
- The supplied Lift application URL was not retained. Only the approved order identity is recorded.
- This approval satisfies the single-order scope only. It does not authorize a time window, public-read change, grant creation, deployment, or customer activation.

## Remaining scope and operating inputs

Before requesting activation approval, record all of the following outside the bounded state file:

1. The start and stop time for the window, including timezone.
2. The operator who will watch CloudWatch/WAF/queue/DLQ and the operator who can immediately restore the dark flags.
3. The support response target and customer escalation path for the window.
4. Confirmation that the raw fragment link will use the approved private handoff only; link email remains disabled.

The machine-readable file stores only booleans. Do not add the order number, customer details, people/email addresses, access URL, token, cookie, signed asset URL, or free-form notes to it.

## Proposed read-only window

Only after the missing controls and explicit approval are recorded may a human review a change limited to:

- stack: `vornan-proof-dev` only;
- one explicitly approved order only;
- a fixed, time-bounded window;
- `ReadOnlyQaConfirmed=true` and `PublicReadEnabled=true` only for that window;
- authenticated operator grant creation only as needed for one view-only grant;
- private raw-link handoff with link email disabled;
- immediate grant revocation and dark restoration at the exit time or on any rollback trigger.

Even a fully passing checker does not authorize those changes. It returns `ready_for_manual_read_only_activation_review`, after which the exact CloudFormation/admin change and rollback plan still require human review.

## Immutable exclusions

- `ProductionPublicReadApproved=false`.
- No Proof domain, certificate, CNAME, or DNS change.
- No link email or external message delivery.
- No approval, revision, upload, undo, or public decision route.
- No Lift `PUT`, submit, Proof write, or other mutation.
- No Pathfinder production API, web, status, store, infrastructure, or deployment change.
- No synthetic fixture during the real-order window.
- No Phase 3 implementation or test.

## Rollback triggers

Restore public read and authenticated grant creation to off, revoke the grant, and stop the window immediately on any of the following:

- unexpected order/task visibility or any cross-order response;
- direct API bypass acceptance;
- server-error, denial-spike, latency, sync-failure, lag, WAF, or DLQ alarm;
- any Lift method other than an approved `GET`, or any unreviewed Lift endpoint activity;
- sensitive field/token/URL appearance in logs;
- session, CSRF, expiry, logout, or revocation mismatch;
- decision control becoming enabled or a decision route appearing;
- inability of the named rollback operator to confirm the dark state.

Rollback preserves the isolated tables, audit, logs, queue/DLQ, and cached real-order aggregate for reviewed evidence unless a separate exact-data cleanup is explicitly approved.

## Approval language

The approval should be explicit and should fill in every bracketed value:

```text
I explicitly approve a time-bounded read-only Vornan Proof activation window on
vornan-proof-dev for Lift order A0226753 from [START WITH TIMEZONE] through
[STOP WITH TIMEZONE]. Public read, ReadOnlyQaConfirmed, and authenticated operator
grant creation may be enabled only for this one order and window. The raw view link
must use the approved private handoff. Keep production approval, DNS/domain, link
email, proof decisions, and every Lift write disabled. [MONITORING OWNER] owns the
alarm/log watch; [ROLLBACK OWNER] owns immediate grant revocation and dark restore.
The support response target is [TARGET], with escalation to [PATH].
```

A general request to “continue,” a prior synthetic QA authorization, or approval to merge a PR does not satisfy this activation approval.

## Validation

- `npm run check:proof-activation-review`: passed with the expected incomplete/safe status and every authorization false.
- `npm run test:proof-deploy`: all 46 deployment-safety tests passed.
- `npm run check`: passed across all workspaces.
- `npm run test`: all 138 workspace tests passed.
- `npm run build`: API, Proof SPA, Status SPA, and admin web production builds passed.
- `git diff --check`: passed.

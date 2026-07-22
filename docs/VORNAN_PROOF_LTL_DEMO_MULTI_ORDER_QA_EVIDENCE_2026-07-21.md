# Vornan Proof LTL Demo multi-order read-only QA evidence — 2026-07-21

## Outcome

The approved LTL Demo multi-order coverage batch passed against the isolated `vornan-proof-dev` stack. Six real demo-account orders synchronized through Lift GET-only reads, and three representative orders completed the view-grant, session, responsive UI, session-end, and revocation lifecycle. No active grant or session remains.

The bounded available cohort covered waiting/no-file plus one-, two-, and three-line pending-image states. No revised, completed, or non-image preview order appeared in the rate-limited candidate range, so those real-data variants remain deferred rather than being manufactured or tested against another customer.

## Scope and selection

- Environment: isolated `vornan-proof-dev` only.
- Cohort: Lift LTL Demo customer `1249` only.
- Window expiry: `2026-07-28T21:49:50.000Z`.
- Candidate discovery: Lift `Orders/Orders` GET only, using a bounded adjacent range and a maximum concurrency of five. Non-demo results were discarded immediately.
- Proof synchronization: IAM-only operator `sync_order`; Lift traffic remained GET only.
- Customer boundary: IAM-only `create_view_grant`, one-time exchange, authenticated cached reads, explicit session end, and IAM-only revocation.
- No synthetic fixture, email, decision, upload, approval, revision, undo, DNS, production public-read approval, Pathfinder production change, or Lift write was used.

## Cached aggregate coverage

| Order | Header state | Lines/tasks | Public task state | Proof rows | File coverage |
|---|---|---:|---|---:|---|
| `A0226692` | Pending Art | 2 | Waiting 2 | 0 | explicit no-file/waiting state |
| `A0226697` | Pending Art Approval | 1 | Pending 1 | 1 | JPEG contained preview with HTTPS PDF full-resolution action |
| `A0226700` | Pending Art Approval | 2 | Pending 2 | 2 | two JPEG preview tasks |
| `A0226701` | Pending Art Approval | 3 | Pending 3 | 3 | three JPEG preview tasks and queue thumbnails |
| `A0226704` | To Be Proofed | 1 | Waiting 1 | 0 | explicit no-file/waiting state |
| `A0226753` | Pending Art Approval | 3 | Pending 3 | 3 | three JPEG preview tasks |

All 12 authoritative line reads succeeded. Nine proof rows normalized without fallback reads or normalization warnings. Every cached order remained `active`, used the verified demo-account cohort, and preserved its real Lift header and line state.

One initial attempt to synchronize three orders concurrently reached the operator Lambda's reserved-concurrency throttle. The first two invocations completed successfully, the third performed no completed synchronization in that attempt, and the same GET-only operation passed immediately when retried sequentially. No queue message or DLQ message was created.

## Responsive customer-boundary results

Three deliberately different orders received temporary view-only grants:

- `A0226692`: two waiting tasks with no review file;
- `A0226697`: one pending proof with separate JPEG preview and PDF full-resolution action;
- `A0226701`: three pending proofs with three queue thumbnails.

At `1366×768`:

- document horizontal and vertical overflow were zero;
- the queue and selected detail remained inside the viewport;
- the three-proof list was independently scrollable;
- all three queue cards showed thumbnails;
- selected artwork used `object-fit: contain` and remained inside the viewer;
- the decision transport remained visible and every approval/revision control was disabled.

At `390×844`:

- document horizontal overflow was zero;
- the UI used the stacked proof feed;
- the waiting case rendered two cards, the single-proof case one card, and the multi-proof case three cards;
- every available preview remained contained;
- every decision control remained disabled.

Each one-time link exchanged successfully, removed the proof after explicit session end, and reached the generic `Your secure session has ended` state. Customer asset URLs, token fragments, cookies, grant/session identifiers, and creative payloads were not copied into this evidence.

## Audit, cleanup, and final health

Each of the three UI orders recorded the expected bounded successful lifecycle:

- `proof.sync_completed`;
- `proof.grant_created`;
- `proof.session_exchanged`;
- `proof.session_ended`;
- `proof.grant_revoked`.

The two review-ready orders also recorded one `proof.review_ready` transition each. Every queried audit record parsed successfully.

All three grants were revoked after their sessions ended. The final aggregate status at `2026-07-22T00:33:18.033Z` was `healthy_no_active_access`:

- all ten expected alarms `OK`;
- sync queue and DLQ empty;
- five retained grants total, zero active;
- three retained sessions total, zero active;
- zero malformed access records;
- activation deadline still active;
- every deployment, DNS, email, decision, Lift-write, and Phase 3 authorization false.

The batch exposed and fixed one monitor-only accounting defect: a real session also contains its parent `grant_id`, so the initial aggregate classifier counted ended sessions as grants. The classifier now recognizes `session_hash` first, and the regression fixture includes the production-shaped parent grant field. The corrected live result reconciles exactly to five grants and three ended sessions.

Exactly 24 temporary request/response files were removed from `/tmp`, including all three token-bearing grant responses. A post-cleanup filename scan returned zero matches. Cached read aggregates and append-only audit evidence remain intentionally retained in the isolated dev tables for the approved window.

## Validation

- every workspace typecheck passed;
- all 169 workspace tests passed on the rebased main baseline;
- all 55 Proof deployment-safety tests passed, including the production-shaped session/grant accounting regression;
- every production build passed;
- both bounded Phase 2/activation evaluators passed while continuing to authorize no deployment or mutation;
- the corrected live window check returned `healthy_no_active_access`;
- the staged change scan contained no signed URL, access token, grant identifier, or AWS access-key-shaped value;
- `git diff --check` passed.

## Deferred real-data coverage

The bounded LTL Demo search did not locate a revised/regenerating, completed/reference, or non-image preview order. Those variants remain covered by deterministic contract/UI fixtures but are not marked as real-data passes by this batch. Future real-order QA should select those states only when they naturally exist under LTL Demo; it must not broaden the customer cohort or mutate an order to manufacture state.

No deployment was required for the QA lifecycle. The monitor accounting fix is repository-only and requires merge, not a Proof stack deployment.

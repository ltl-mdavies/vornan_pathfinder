# Vornan Proof mixed-state read-only QA — A0224897 — 2026-07-22

## Outcome

The explicitly approved LTL Demo order `A0224897` passed the bounded mixed-state read-only Proof lifecycle against the isolated `vornan-proof-dev` stack. The real Lift aggregate contained five mapped lines and five image proofs: four lines at step `7.02` normalized as pending, while one line at step `7.05` normalized as approved and non-actionable.

This run closes the deferred real-order approved-line presentation case. It does not claim the deferred revised/regenerating case: although the operator described some artwork as previously revised, the current Lift GET payload exposed those lines as pending, with no revision approval status, prior attachment row, archived task, or regenerating state. Filename version text was not treated as authoritative lifecycle state.

## Scope and guardrails

- Environment: isolated `vornan-proof-dev` only.
- Order: explicitly approved `A0224897`.
- Cohort: synchronized header passed the configured LTL Demo customer boundary.
- Lift activity: reviewed operator synchronization used GET-only reads; all five line reads succeeded.
- Access: one short-lived `view` grant, one exchanged session, explicit session end, and explicit grant revocation.
- No synthetic fixture, email, DNS, decision, approval, revision request, upload, Lift write, production public-read approval, Pathfinder production change, or Phase 3 capability was used.

## Pre-session health

At `2026-07-22T13:25:55.556Z`, `npm run check:proof-window` returned `healthy_no_active_access`:

- all ten expected alarms present and `OK`;
- sync queue and dead-letter queue empty;
- zero active grants and sessions;
- zero malformed retained access records;
- bounded activation deadline and approved cohort intact;
- every deployment, DNS, email, decision, Lift-write, and Phase 3 authorization false.

## Cached aggregate and line correlation

The first IAM-only `sync_order` completed at `2026-07-22T13:26:39.720Z`. The cached aggregate was active at version 1 with five lines, five current tasks, zero archived tasks, and no normalization warning.

| Lift line | Lift step | Normalized Proof state | Actionable | Current versions | Asset class |
|---|---:|---|---|---:|---|
| 1 | `7.02` | pending | yes in domain data; UI controls locked by read-only phase | 1 | image |
| 2 | `7.05` | approved | no | 1 | image |
| 3 | `7.02` | pending | yes in domain data; UI controls locked by read-only phase | 1 | image |
| 4 | `7.02` | pending | yes in domain data; UI controls locked by read-only phase | 1 | image |
| 5 | `7.02` | pending | yes in domain data; UI controls locked by read-only phase | 1 | image |

Every real `ORDER_LINE_ID` mapped exactly one proof task to one authoritative line. Diagnostics reported five attempted and five successful line reads, five proof rows, no failed line read, no fallback read, and zero normalization warnings.

The public counts were Pending 4, Regenerating 0, Waiting 0, and Reviewed 1/5. The approved `7.05` task remained visible only under All/Reviewed context and did not enter the open queue.

## Revised-state limitation

Lines described operationally as having received revised artwork currently returned `7.02` plus a `PENDING` proof approval status. Each exposed one current proof version; the cached aggregate contained no historical version or archived task. Vornan Proof therefore correctly represented the authoritative current state as pending and did not infer `revised` from a version-like filename.

The real revised/regenerating subcase remains deferred until Lift naturally returns a current approval status such as `REVISION`, `REVISED`, `REJECTED`, `REGENERATING`, or `CHANGES REQUESTED`, or otherwise exposes authoritative prior-version history. No order was modified to manufacture that condition.

## Responsive fail-closed customer UI

The one-time fragment exchanged successfully and was removed from the browser URL. The customer DTO showed one order, five proof tasks, four open queue items, one approved item, and no decision authority.

At `1366×768`:

- the desktop queue and selected detail both remained visible;
- document horizontal and vertical overflow were zero;
- the queue used independent vertical overflow;
- selected artwork used `object-fit: contain`;
- the approved line displayed `Approved` and its note plus both decision controls were disabled.

At `390×844`:

- the desktop split view was hidden and five mobile feed cards rendered;
- four cards displayed Pending and one displayed Approved;
- all five previews remained contained;
- all ten visible decision buttons were disabled;
- document horizontal overflow was zero.

At `844×390`, the mobile feed remained active instead of squeezing the desktop workspace. All five cards rendered, all previews remained contained, and document horizontal overflow was zero.

Explicit logout reached the generic `#/session-ended` state and removed all order detail.

## Audit, telemetry, and cleanup

The exact audit partition contained seven bounded events:

- two `proof.sync_completed`;
- one `proof.review_ready`;
- one `proof.grant_created`;
- one `proof.session_exchanged`;
- one `proof.session_ended`;
- one `proof.grant_revoked`.

The second synchronization occurred as the required cohort-bound precondition to grant creation and did not duplicate `proof.review_ready`. Audit metadata remained restricted to fixed source, health, version, count, scope, and status keys.

The bounded CloudWatch window recorded successful operator metrics for `sync_order`, `create_view_grant`, and `revoke_grant`, plus public metrics for `token_exchange`, `cached_order_read`, and `session_logout`. A sanitized scan of 26 operator/public log events found zero order-number, grant-prefix, signed-URL, token, cookie, session-cookie, or CSRF-cookie markers. The sync worker was not used.

The session ended at `2026-07-22T13:32:47.713Z`; its grant was revoked at `2026-07-22T13:33:09.763Z`. All seven exact temporary request, response, and inspection files were removed from `/tmp`, including the secret-bearing access response. A filename check returned zero remaining matches.

At `2026-07-22T13:33:47.214Z`, the final window status was `healthy_no_active_access`: zero active grants, zero active sessions, zero malformed records, empty queues, and all ten alarms `OK`. The cached aggregate and append-only audit events remain intentionally retained in the isolated dev tables for the bounded window.

## Validation

- the pre-session and post-session aggregate window checks both returned `healthy_no_active_access`;
- the synchronized aggregate matched all five real lines without fallback or warning;
- responsive desktop, portrait-mobile, and short-landscape checks passed;
- every workspace typecheck passed;
- all workspace tests passed on the `6815464` baseline;
- all 61 Proof deployment-safety tests passed;
- every production build passed;
- both bounded Phase 2 and activation-review evaluators passed while authorizing no deployment or mutation;
- the complete evidence diff contained no access token, signed URL, cookie, session secret, grant identifier, or AWS access-key-shaped value;
- `git diff --check` passed;
- no deployment or stack parameter change occurred.

## Remaining deferred coverage

Real revised/regenerating and non-image proof-asset states remain deferred. They should be tested only when an explicitly approved LTL Demo order naturally exposes those authoritative conditions. No new capability or Lift mutation is justified to manufacture them.

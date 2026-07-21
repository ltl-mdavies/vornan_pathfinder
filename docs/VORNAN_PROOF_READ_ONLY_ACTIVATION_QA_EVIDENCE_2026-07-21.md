# Vornan Proof internal read-only activation QA evidence — 2026-07-21

## Result

The approved one-week internal read-only QA window is active and passed its opening lifecycle checks in the isolated `vornan-proof-dev` stack. The direct CloudFront boundary exposed exactly one approved LTL Demo order through two temporary view-only grants. Both sessions ended and both grants were revoked; there are now zero active grants.

The stack remains available only for the approved internal Lift LTL Demo customer `1249` cohort through `2026-07-28T21:49:50Z`. No custom domain or DNS, application email, Proof decision, production public-read approval, synthetic fixture, Lift write, or Pathfinder production surface was enabled or changed.

## Reviewed deployment

- Source baseline: merged `main` commit `0ae7e8e3dafea2d6ab364fe454e8469d504fb8d9` from Proof PR #19.
- Lambda artifact: `proof/dev/vornan-proof-lambdas-0ae7e8e3dafe.zip` in the existing Proof artifact bucket.
- Artifact SHA-256: `ab1478772040cc434f26b4c6a2bc0f92fb2b7e6e857b0f3dfef49ba5a270844b`.
- Reviewed change set: `proof-readonly-activation-0ae7e8e`.
- Stack completion: `UPDATE_COMPLETE` at `2026-07-21T23:04:51.143Z`.

The change set added only the IAM-invoked operator Lambda, its least-privilege role, retained log group, and server-error alarm. It modified the isolated Proof public/sync functions, public integration, and operational dashboard in place. It removed and replaced no resource, created no DNS resource, and touched no Pathfinder stack.

The deployed activation parameters are:

- `PublicReadEnabled=true`;
- `ReadOnlyQaConfirmed=true`;
- `OperatorGrantCreationEnabled=true`;
- `GrantAllowedCustomerIds=1249`;
- `ReadOnlyActivationExpiresAt=2026-07-28T21:49:50Z`;
- direct generated CloudFront HTTPS base URL;
- `SyntheticQaEnabled=false`;
- `ProductionPublicReadApproved=false`;
- empty domain and certificate parameters;
- link email, decisions, and every Lift-write flag false.

The operator function has no Lambda resource policy. API Gateway exposes only `ANY /api/public/proof/{proxy+}`; there is no operator HTTP route, Lambda URL, schedule, or event source. The operator's own public-read and link-email environment flags remain false.

## Approved real-order lifecycle

The test used the explicitly approved Pathfinder-originated LTL Demo order `A0226753`, customer `1249`, company `91`. The operator performed only the reviewed Lift GET synchronization.

- The cohort check passed before line-scoped proof reads and persistence.
- The cached order remained active at version 1 with three pending proofs, three total proofs, and total quantity 31.
- The first `sync_order` completed at `2026-07-21T23:07:03.443Z`.
- Each `create_view_grant` repeated the cohort-bound GET synchronization before creating a `view` grant.
- The public DTO omitted internal customer, grant, participant, attachment, and decision scope.
- Direct API bypass remained denied.

The first lifecycle used the API boundary to verify one-time exchange, secure session and CSRF cookies, one-order isolation, three cached proofs, scoped history, reviewer identification, missing-CSRF denial, disabled decisions, and terminal logout. Its grant was revoked at `2026-07-21T23:09:22.542Z`.

The second lifecycle used the deployed browser UI for responsive verification. Its fragment token disappeared from the browser URL after exchange, the session ended at `2026-07-21T23:16:16.137Z`, and the grant was revoked at `2026-07-21T23:16:39.211Z`.

The isolated core table now reports two grants for this run: zero active and two revoked.

## Responsive fail-closed UI

The authenticated deployed SPA was inspected through the generated CloudFront hostname at these explicit viewports:

- `1366×768`: the document exactly matched the viewport with no document overflow; the queue scrolled independently, all three queue cards contained thumbnails, the selected image used `object-fit: contain`, and the locked decision transport remained visible with both decision buttons disabled.
- `390×844`: the mobile proof feed rendered three full-width articles, each preview remained contained, all 20 visible feed controls met the 44-pixel minimum height, the document had no horizontal overflow, and every decision button remained disabled.
- `320×568`: the three 300-pixel-wide feed articles fit without horizontal overflow, all visible controls retained the 44-pixel minimum, and all decisions remained disabled.
- `844×390`: the mobile feed rendered instead of a squeezed desktop split, showed all three articles, had no horizontal overflow, and retained disabled decisions.

The mobile Feedback dialog had an accessible name and description and placed initial focus on its unique Close control. Closing it returned to the proof route. Ending the secure session transitioned to `/#/session-ended`, removed all proof information, and displayed the generic terminal message.

## Audit, telemetry, alarms, and queues

The sanitized audit partition contains the expected successful sequence after activation:

- three `proof.sync_completed` events from the operator;
- two `proof.grant_created` events from the operator;
- two `proof.session_exchanged` events from the public API;
- one `proof.participant_identified` event from the public API;
- two `proof.session_ended` events from the public API;
- two `proof.grant_revoked` events from the operator.

Operator telemetry recorded successful `sync_order`, `create_view_grant`, and `revoke_grant` operations with zero server errors or denials. Public telemetry recorded token exchange, cached order reads, scoped history, participant identity, expected CSRF denial, and logout under bounded operation names. Metric dimensions remained limited to service, environment, and operation; no order, customer, grant, participant, email, filename, token, or payload became a dimension.

A final Logs Insights scan across the public, operator, and sync Lambda groups scanned 92 records and found zero occurrences of the approved order number, owner email, grant prefix, access URL, cookie marker, or signed-URL marker.

All ten Proof dev alarms were `OK`, including operator/public server errors, public denials, token exchange and cached-read latency, sync failures/latency/lag/DLQ, and WAF block spike. The sync queue and DLQ each reported zero visible, in-flight, and delayed messages.

## Cleanup and retained state

- Both temporary sessions ended.
- Both temporary view grants were revoked; zero active grants remain.
- Every exact token-, grant-, cookie-, and request-bearing temporary file used by this run was deleted and verified absent.
- No customer fixture was created, so no fixture purge was required.
- The approved cached order and sanitized audit evidence remain in the isolated Proof dev tables for the internal QA window.
- The production Pathfinder job and Lift order were not modified or resubmitted.

The public-read, read-only QA, and IAM operator flags intentionally remain on for the approved internal window. Access still requires a fresh IAM-created, cohort-verified, view-only grant; no active grant currently exists. At the deadline or on any rollback trigger, revoke any then-active grants and restore `OperatorGrantCreationEnabled=false`, `PublicReadEnabled=false`, and `ReadOnlyQaConfirmed=false`, then clear the cohort and expiry.

## Validation

Before activation, the merged operator implementation passed:

- `npm run check` across every workspace;
- all 155 workspace tests;
- all 50 Proof deployment-safety tests;
- every production build;
- Proof Lambda packaging;
- SAM template lint;
- both bounded Phase 2 evaluators;
- `git diff --check`.

After deployment:

- `npm run smoke:proof-read-only` passed against CloudFront and the direct API endpoint;
- public read was true, decisions were false, and direct API bypass was rejected;
- the cohort-bound GET sync, two grant/session/revocation lifecycles, responsive browser checks, sanitized audit query, alarm inventory, queue inventory, and sensitive-log scan all passed.
- the evidence branch reran every workspace typecheck, all 161 workspace tests, all 50 Proof deployment-safety tests, every production build, both bounded evaluators, and `git diff --check`; all passed.

This evidence completes the opening checkpoint for the approved internal read-only window. It does not authorize DNS, external customer access, link email, decisions, Lift writes, production public read, or Phase 3.

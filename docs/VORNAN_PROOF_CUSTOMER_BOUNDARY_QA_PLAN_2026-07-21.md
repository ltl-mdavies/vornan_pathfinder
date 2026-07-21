# Vornan Proof controlled customer-boundary QA plan — 2026-07-21

## Status

Prepared but not authorized or executed.

The isolated read-only evidence is complete, but the Proof dev stack remains dark. This plan defines the next Phase 2 validation window without changing the current stack, creating a grant, exposing a customer route, sending email, configuring a domain, or performing a Lift write.

## Purpose

The prepared `npm run qa:proof-boundary` harness validates the deployed CloudFront-to-public-API boundary with the existing purgeable non-customer fixture. It confirms:

- public health reports read-only access with decisions disabled;
- direct API Gateway bypass remains HTTP 403;
- a view-only grant exchanges once and only once;
- the resulting hardened session can read exactly the reserved synthetic order;
- task history cannot cross the session order/task boundary;
- reviewer identity and feedback acknowledgement require the matching CSRF cookie/header;
- logout is terminal and the temporary grant is revoked;
- the expected grant/session/participant/feedback/logout/revocation audit events exist;
- no email, custom domain, decision route, or Lift write is used.

The harness never prints the raw fragment token, session cookie, CSRF value, access URL, or customer payload. Its output is limited to the synthetic fixture ID, bounded pass/fail booleans, the dev stack name, and guardrail state.

## Hard preconditions

Execution requires a new explicit approval naming this exact temporary window. The approval must authorize only:

- stack `vornan-proof-dev`;
- the retained reserved `A00000000` / `SYNTHETIC QA — NOT A CUSTOMER` fixture and its exact `vpqa-*` ID;
- a temporary dev-only change to `ReadOnlyQaConfirmed=true` and `PublicReadEnabled=true`;
- creation and automatic revocation of one view-only synthetic grant;
- participant identity and feedback-acknowledgement records for the synthetic fixture.

The window must keep `ProductionPublicReadApproved=false`, `SyntheticQaEnabled=false`, managed WAF enabled, domain/certificate empty, link email disabled, all decision flags false, and every Lift-write flag false. The harness fails closed unless CloudFormation reports that exact posture and all required isolated table/endpoint outputs.

## Controlled sequence after approval

1. Create a fresh bounded `vpqa-*` fixture identity.
2. While the stack is fully dark, enable only `SyntheticQaEnabled`, run the existing purgeable synthetic lifecycle, and retain the fixture instead of purging it.
3. Redeploy the dev stack with `SyntheticQaEnabled=false`, `ReadOnlyQaConfirmed=true`, and `PublicReadEnabled=true`; keep every other guardrail above unchanged.
4. Run the standard dark/public smoke and confirm invalid access remains generic and the direct API bypass remains denied.
5. Run the customer-boundary harness with the exact confirmation string and retained fixture ID.
6. Perform the responsive authenticated UI review through a separately approved private token handoff; do not retain the raw token in evidence.
7. Immediately redeploy `PublicReadEnabled=false` and `ReadOnlyQaConfirmed=false`.
8. Run the existing exact-fixture purge, confirm zero synthetic records/messages, and confirm all alarms return to their expected state.
9. Record only sanitized correlation IDs, bounded counts, viewport results, and guardrail status.

## Rollback and failure behavior

The harness revokes its temporary grant in a `finally` path. Any failed precondition stops before grant creation. Any HTTP, scope, CSRF, audit, or logout mismatch fails the run. Regardless of outcome, the operator must return the stack to the dark parameters before purging the exact fixture. No broad DynamoDB scan-delete or SQS purge is permitted.

## Deferred authority

This plan is not approval to execute the window. It is not permission for customer email, DNS, production public reads, approval/revision features, or any Lift write. Phase 3 remains blocked.

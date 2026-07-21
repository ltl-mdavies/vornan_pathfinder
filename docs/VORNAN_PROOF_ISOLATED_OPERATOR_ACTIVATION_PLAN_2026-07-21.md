# Vornan Proof isolated operator activation plan — 2026-07-21

## Purpose

Prepare the smallest deployable control plane for the approved internal LTL Demo read-only window without changing Pathfinder production. This plan adds one IAM-invoked Lambda to the retained `vornan-proof-dev` stack. It creates no HTTP route, Lambda URL, DNS record, email, customer decision, or Lift write capability.

## Verified starting state

Read-only AWS inventory on 2026-07-21 found:

- `vornan-proof-dev` in `UPDATE_COMPLETE` with public read, read-only QA confirmation, synthetic QA, and production public-read approval all false;
- no Proof alias or certificate, and the managed WAF enabled;
- retained core and audit tables, sync queue/DLQ, CloudFront distribution, and public API already isolated in the Proof dev stack;
- the direct distribution origin available at `https://dpib8f02ljvrd.cloudfront.net`;
- `vornan-pathfinder-api-prod` in `UPDATE_COMPLETE` with Proof table outputs empty, grant creation false, and link email false.

No stack parameter, function configuration, DNS record, API route, data record, Lift order, or Pathfinder production surface was changed while collecting this inventory.

## Operator contract

Function: `vornan-proof-operator-dev`

Invocation: AWS IAM `lambda:InvokeFunction` only. CloudFormation attaches no API Gateway integration, public Lambda permission, function URL, schedule, queue, or event source.

Operations:

- `sync_order`: normalize the order number, fetch the Lift order header with GET, verify the approved customer cohort, then read and persist the normalized proof aggregate;
- `create_view_grant`: repeat the cohort-bound synchronization and create only a one-time `view` grant;
- `list_grants`: list bounded, token-free grant records for a cached order in the cohort;
- `revoke_grant`: revoke an existing cohort grant. This remains available after creation is disabled so rollback does not depend on reopening the window.

The handler calls the global Lift-write assertion on every invocation. The deployment role has DynamoDB read/write access only to the isolated Proof core table, append access to the isolated audit table, and basic Lambda logging. It has no SQS permission and no Lift write credential or mutation transport.

## Fail-closed activation parameters

The reviewed dev change set must use all of these values together:

```text
EnvironmentName=dev
PublicReadEnabled=true
ReadOnlyQaConfirmed=true
OperatorGrantCreationEnabled=true
GrantAllowedCustomerIds=1249
ReadOnlyActivationExpiresAt=2026-07-28T21:49:50Z
PublicBaseUrl=https://dpib8f02ljvrd.cloudfront.net
SyntheticQaEnabled=false
ProductionPublicReadApproved=false
ProofDomainName=
CertificateArn=
```

Link email remains hard false in the operator function. Managed or supplied WAF remains required. Deployment preflight and CloudFormation rules reject an operator window outside `dev`, without public-read QA confirmation, without a future deadline or cohort, with synthetic QA/production approval/email/DNS enabled, or with a non-deployable public base URL.

The approved cohort is the Lift LTL Demo account, customer `1249`. An order header with a missing or different customer ID is rejected before proof-report reads, aggregate persistence, or grant creation. The customer ID remains internal and is not included in the operator summary, public DTO, or metric dimensions.

## Controlled run and cleanup

1. Merge the focused PR after CI and review.
2. Review the `vornan-proof-dev` CloudFormation change set. Reject it if it modifies a Pathfinder stack, creates an operator HTTP/public invocation, adds an unexpected IAM permission, or changes any decision/write flag.
3. Deploy the isolated Proof dev stack only, then repeat the public dark/boundary smoke checks using the direct CloudFront and API endpoints.
4. Invoke `sync_order` for an approved LTL Demo order and record sanitized aggregate counts, audit actions, telemetry dimensions, and Lift GET-only evidence.
5. Invoke `create_view_grant`, store the secret-bearing response in an owner-only temporary file, hand the fragment link privately, and delete the file after use.
6. Validate exchange, session, cached reads, responsive fail-closed UI, logout, expiry, and revocation. Record no token, cookie, signed asset URL, raw payload, customer creative, or comment.
7. Revoke every active QA grant using `revoke_grant`.
8. Redeploy `vornan-proof-dev` with `OperatorGrantCreationEnabled=false`, `PublicReadEnabled=false`, and `ReadOnlyQaConfirmed=false`; clear the cohort and expiry after revocation is verified. Confirm synthetic QA, production approval, DNS, email, decisions, and Lift writes remain false.
9. Confirm the public boundary is unavailable, the operator rejects sync/create/list, queues and DLQ are in the expected state, alarms recover, and retained audit evidence contains only approved identifiers and bounded metadata.

The application deadline independently fails closed even if the rollback deployment is delayed, but it is not a substitute for restoring the dark stack.

## Evidence status

This branch prepares code, infrastructure assertions, automated tests, and the operator runbook. It does not deploy the stack or invoke Lift. Live activation and customer-session evidence remain pending a merged commit, reviewed dev change set, deployment, and controlled private link handoff.

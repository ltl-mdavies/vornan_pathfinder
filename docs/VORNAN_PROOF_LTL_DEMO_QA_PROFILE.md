# Vornan Proof LTL Demo QA profile

## Purpose

This profile reduces repeated QA setup without broadening access beyond the LTL Demo customer. It is repository-side configuration only. Merged code, a default-dark deployment, profile activation, asset publication, and direct operator Lift-action testing remain separate approvals.

## Fixed boundary

- Lift customer is always `1249`.
- Every usable order must belong to Lift customer `1249`. Bounded windows use an explicit `A########` allowlist; the persistent QA lane uses the `LTL_DEMO_ALL` sentinel and still rejects every other customer.
- The profile is dev-only. Bounded windows expire no later than 24 hours after activation; the persistent `LTL_DEMO_ALL` lane has no profile expiry but retains the same customer boundary and per-session controls.
- Review sessions are capped at 12 hours and also capped by the grant and profile expiry.
- Existing grant/session, CSRF, participant identity, current-proof, feedback acknowledgement, task version, attachment, and Proof version checks remain authoritative.
- The selected Pathfinder customer must first have a verified durable Proof
  customer identity of `1249`; the isolated runtime re-reads its exact saved
  customer/order policy on token exchange and every bound session request.
- Core records and audit events remain in the dedicated Proof tables.
- Automatic retry is always false.

The profile does not activate Proof email, scan processing, asset publication, asset delivery, operator action QA, or any Lift request.

## Split-stack scope

The shared Pathfinder API and isolated Proof stack receive different packed capabilities:

| Stack | Grant creation | Public read | Customer approval contract | Private upload |
| --- | ---: | ---: | ---: | ---: |
| Pathfinder API | yes | no | no | no |
| Isolated Proof | no | yes | yes | yes |

The API-side grant route still requires an authenticated operator. The public Proof side still requires a one-time valid review grant, reviewer identity, session cookie, and CSRF token. Both sides use the same customer-1249 boundary and either the same exact order allowlist/expiry or the persistent `LTL_DEMO_ALL` profile.

## Configuration

Deployment inputs and variables are:

- `PATHFINDER_PROOF_LTL_DEMO_QA_ENABLED`
- `PATHFINDER_PROOF_LTL_DEMO_QA_ALLOWED_ORDERS`
- `PATHFINDER_PROOF_LTL_DEMO_QA_EXPIRES_AT`
- `PATHFINDER_PROOF_LTL_DEMO_QA_PERSISTENT_ENABLED`
- `PATHFINDER_PROOF_LTL_DEMO_QA_GRANT_CREATION_ENABLED`
- `PATHFINDER_PROOF_LTL_DEMO_QA_SESSION_READ_ENABLED`
- `PATHFINDER_PROOF_LTL_DEMO_QA_CUSTOMER_APPROVAL_ENABLED`
- `PATHFINDER_PROOF_LTL_DEMO_QA_REVISION_UPLOAD_ENABLED`

CloudFormation packs these into `PATHFINDER_PROOF_LTL_DEMO_QA_SCOPE` as:

`enabled|expiry|orders|grant_creation|session_read|customer_approval|revision_upload|persistent`

Operators must not set the packed runtime value manually. CloudFormation rules reject overlap with the legacy Proof gates. The shared API rule also rejects publication, scan-worker, operator-action, and email activation. The isolated Proof rule requires dev, the reviewed read-only boundary, WAF, edge secret, target/secret bindings, private asset bucket, exact orders, and the common expiry.

## Default-dark deployment

Before activation, deploy both stacks with `LtlDemoQaEnabled=false` and verify:

- all existing production Wrike scheduler, submit, writeback, and document-publication parameters are unchanged;
- customer approval and upload remain unavailable;
- publication, `/a/*` asset delivery, scan processing, operator actions, email, and Lift writes remain off;
- the configured Proof core/audit tables and private asset bucket are unchanged and continuous.

## Bounded activation

Activate the shared API side first only after the required production Pathfinder/Wrike before-check. Activate the isolated Proof side second with the identical order list and expiry. Create one review grant for one allowlisted customer-1249 order, keep the access link private, and do not send email.

Profile QA may cover current-proof reads, responsive customer review, one supervised approval, and private upload/finalization. Malware scan activation, publication, direct delivery, and the revised-art Lift action require their own later checkpoints.

## Stop and recovery contract

Set the profile false on both stacks or allow the common expiry to pass. Revoke the grant and end the session. Confirm zero active grants/sessions for the tested order, customer actions return the expected fail-closed response, and read-only Proof behavior is restored. Do not delete asset records or objects during recovery; retained records are the diagnostic and future order-support source.

Escalate with sanitized evidence only: stack names, deployed commits/artifacts, exact non-secret parameters, order number, Proof task/attachment/version IDs, asset/publication IDs, record states/versions, audit event IDs, timestamps, HTTP classifications, alarms, and rollback step. Never include tokens, cookies, CSRF values, signed URLs, credentials, creative bytes, raw customer comments, or full delivery URLs.

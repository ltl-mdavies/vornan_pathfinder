# Pathfinder Wrike Ingestion Strategy

## Outcome

Wrike is a source adapter for one saved Pathfinder Import Method. It retrieves an approved workbook from a scoped Wrike task, runs the same parser, field mappings, product resolution, order-name resolution, Ext_ID strategy, output route, and submit profile already configured on that Import Method, then creates an operator-reviewed Pathfinder preview job.

The Wrike adapter must never submit directly to Lift. Lift submission remains a separate authenticated operator action after normal Pathfinder certification.

## Recommended production pattern

1. Register a Vornan Wrike OAuth application and authorize it with a dedicated technical user that can see only the required Momentara folder/project.
2. Request read-only workspace access and store OAuth client credentials and refresh tokens in the Pathfinder secret boundary, never in an Import Method or browser payload.
3. Scope discovery to the configured Wrike folder/project API ID.
4. Trigger when a task enters the configured custom workflow status, initially `Ordered`.
5. Prefer a folder/project webhook for fast notification, with low-frequency scheduled reconciliation so missed or suspended webhook deliveries are recovered.
6. Retrieve task attachments and select the newest workbook matching the configured filename and extension rule.
7. Build a durable source identity from Wrike account ID, task ID, attachment ID, and attachment version ID.
8. If that identity already produced a preview, acknowledge the duplicate without creating another job. A newer attachment version creates a new candidate for operator review.
9. Apply the bound Import Method and create a Pathfinder preview job with Wrike provenance and audit events.
10. Stop. An authenticated Pathfinder operator reviews, certifies, and explicitly submits to Lift.

Wrike recommends OAuth 2.0 for production integrations. Permanent access tokens are suitable only for a constrained connectivity test because they inherit the issuing user's access and do not expire. The OAuth response supplies the correct regional API host, which Pathfinder must retain with the connection. See [Wrike OAuth 2.0 authorization](https://developers.wrike.com/docs/oauth-20-authorization) and the [Wrike API overview](https://developers.wrike.com/docs/overview).

Wrike webhooks can be scoped to an account, space, or folder/project and can report task status or custom-field changes. Wrike documents possible duplicate webhook delivery and exposes an `Idempotency-Key`; Pathfinder should deduplicate that delivery key separately from its task/attachment/version ingestion identity. See [Wrike webhooks](https://developers.wrike.com/docs/webhooks).

Wrike attachment URLs are temporary, so Pathfinder must download the selected workbook immediately into the processing boundary rather than persisting the signed URL as the source artifact. See [Wrike attachments](https://developers.wrike.com/reference/getattachmentsempty).

## Import Method contract

The first dark configuration slice stores only:

- Wrike folder/project API ID;
- trigger strategy;
- ordered workflow status ID and operator-friendly label;
- accepted workbook extensions;
- optional filename match;
- reconciliation interval;
- fixed newest-matching-workbook selection;
- fixed task/attachment/version idempotency;
- fixed preview-job-only destination.

It intentionally does not store:

- access tokens, refresh tokens, client secrets, or webhook secrets;
- customer workbook contents;
- temporary attachment URLs;
- a Lift auto-submit option;
- mutable product or field mapping overrides.

## Fail-closed decisions

- Missing folder/project ID: no discovery.
- Missing trigger status ID: no discovery.
- No matching workbook: record a reviewable source failure; no job.
- Two newest workbooks with the same effective timestamp: ambiguous; no job.
- Duplicate webhook event: acknowledge without reprocessing.
- Duplicate task/attachment/version identity: link to the existing preview; no new job.
- Replacement attachment version: create a new preview candidate and retain the older job/audit history.
- Parser, mapping, product, or canonical validation failure: persist a non-submittable preview for operator correction.
- Wrike API, OAuth refresh, or download failure: retry with bounded backoff and surface connector health; never fall through to Lift.

## Momentara discovery checklist

- Confirm Wrike account and regional host.
- Identify the least-privilege technical user and approve OAuth access.
- Confirm the folder/project API ID that contains production order tasks.
- Confirm whether `Ordered` is a workflow status or custom field, and capture its API ID.
- Confirm whether one task always represents one Lift order.
- Confirm whether one current order workbook exists per task and how its filename is formed.
- Confirm how corrected/replacement workbooks are versioned.
- Confirm whether historical tasks need a one-time backfill and the earliest safe date.
- Confirm who owns failed-ingestion review and how Pathfinder should notify them.
- Decide whether Pathfinder should write a link/status back to Wrike in a later, separately approved write-enabled slice.

## Delivery sequence

1. Configuration contract and operator UI — complete, dark only.
2. OAuth/secret storage and read-only connection health — complete, dark by default.
3. Controlled read-only discovery against one approved non-customer or Momentara test task.
4. Attachment selection/download and durable source audit.
5. Preview-job creation through the existing Import Method boundary.
6. Webhook endpoint plus scheduled reconciliation and telemetry.
7. Optional Wrike write-back, only after explicit authorization.

## Read-only connection-health boundary

Pathfinder now has one platform-level Wrike OAuth connection in the authenticated Settings area. The regional host, OAuth client ID, client secret, refresh token, rotated access token, and rotated refresh token are stored only through the existing Pathfinder secret driver. API responses expose configured/not-configured booleans, the validated regional hostname, and safe health metadata; they never return tokens or client secrets.

The explicit connection test is separately gated by `PATHFINDER_ENABLE_WRIKE_CONNECTION_TEST`, which defaults to `false` locally, in CloudFormation, and in the production deployment workflow. Saving credentials does not contact Wrike. When the gate is deliberately enabled and an authenticated operator clicks the test action, Pathfinder performs exactly:

1. `POST https://<regional-host>/oauth2/token` with the saved refresh token and `wsReadOnly` scope;
2. `GET https://<regional-host>/api/v4/contacts?me=true` with the rotated bearer token.

Only HTTPS hosts under `wrike.com` are accepted, and the OAuth response's `host` remains authoritative for the API request. Wrike documents that OAuth tokens are regional-host aware, access tokens expire, refresh tokens rotate, and the current-user Contacts query supports `wsReadOnly`. See [Wrike OAuth 2.0 authorization](https://developers.wrike.com/docs/oauth-20-authorization) and [Query Contacts](https://developers.wrike.com/reference/getcontactsempty).

This health boundary does not implement or authorize task/folder discovery, attachment reads, webhook creation, polling, background work, Wrike writes, preview creation, or any Lift action. The next slice requires one explicitly approved Wrike test task plus confirmed folder/project and workflow-status IDs before any discovery request is added.

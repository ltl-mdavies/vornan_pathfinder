# Pathfinder Wrike Ingestion Strategy

## Outcome

Wrike is a customer-owned Source Connection that can be bound to one or more saved Pathfinder Import Methods for that same customer. It retrieves an approved workbook from a scoped Wrike task, runs the same parser, field mappings, product resolution, order-name resolution, Ext_ID strategy, output route, and submit profile already configured on the bound Import Method, then creates an operator-reviewed Pathfinder preview job.

The Wrike adapter must never submit directly to Lift. Lift submission remains a separate authenticated operator action after normal Pathfinder certification.

## Recommended production pattern

1. Register a Vornan Wrike OAuth application and authorize it with a dedicated technical user that can see only the required Momentara folder/project.
2. Create the Wrike Source Connection under that customer's Settings, request read-only workspace access, and store OAuth client credentials and refresh tokens in the customer/connection-scoped Pathfinder secret boundary, never in an Import Method or browser payload.
3. Scope discovery to the configured Wrike folder/project API ID.
4. Treat `Ordered` as Momentara's internal creative-preparation state. Qualify an order for Pathfinder only when the task reaches the exact configured `Sent to Print - LTL` custom-status ID.
5. Prefer a folder/project webhook for fast notification, with low-frequency scheduled reconciliation so missed or suspended webhook deliveries are recovered.
6. Require the task title and each workbook stem to match `C<6 digit contract number> - <order name> - OOH Order`, then keep every current workbook with the same contract number as a separate order candidate.
7. Build a durable source identity from Wrike account ID, task ID, attachment ID, and attachment version ID.
8. If that identity already produced a preview, acknowledge the duplicate without creating another job. A newer attachment version creates a new candidate for operator review.
9. Apply the bound Import Method and create a Pathfinder preview job with Wrike provenance and audit events.
10. Stop. An authenticated Pathfinder operator reviews, certifies, and explicitly submits to Lift.

Wrike recommends OAuth 2.0 for production integrations. Permanent access tokens are suitable only for a constrained connectivity test because they inherit the issuing user's access and do not expire. The OAuth response supplies the correct regional API host, which Pathfinder must retain with the connection. See [Wrike OAuth 2.0 authorization](https://developers.wrike.com/docs/oauth-20-authorization) and the [Wrike API overview](https://developers.wrike.com/docs/overview).

Wrike webhooks can be scoped to an account, space, or folder/project and can report task status or custom-field changes. Wrike documents possible duplicate webhook delivery and exposes an `Idempotency-Key`; Pathfinder should deduplicate that delivery key separately from its task/attachment/version ingestion identity. See [Wrike webhooks](https://developers.wrike.com/docs/webhooks).

Wrike attachment URLs are temporary, so Pathfinder must download the selected workbook immediately into the processing boundary rather than persisting the signed URL as the source artifact. See [Wrike attachments](https://developers.wrike.com/reference/getattachmentsempty).

## Import Method contract

The first dark configuration slice stores only:

- the customer Source Connection ID used by this Import Method;
- Wrike folder/project API ID;
- trigger strategy;
- intake-ready workflow status ID and operator-friendly `Sent to Print - LTL` label;
- fixed task-title and workbook-name rules using `C###### - Order Name - OOH Order`;
- accepted workbook extensions;
- optional filename match;
- reconciliation interval;
- fixed all-matching-current-workbooks selection, with each workbook treated as a separate order;
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
- Task not in the exact `Sent to Print - LTL` status: no attachment metadata read.
- Task title outside `C###### - Order Name - OOH Order`: no attachment metadata read.
- No matching workbook: record a reviewable source failure; no job.
- Workbook contract number differs from the task contract number: ignore that workbook.
- PDFs and other reference attachments: ignore them; they are creative references, not order grids or print-ready artwork.
- Multiple current matching workbooks: keep each as a separate order candidate.
- Multiple equally current versions of the same attachment: ambiguous; no job for that attachment set.
- Duplicate webhook event: acknowledge without reprocessing.
- Duplicate task/attachment/version identity: link to the existing preview; no new job.
- Replacement attachment version: create a new preview candidate and retain the older job/audit history.
- Parser, mapping, product, or canonical validation failure: persist a non-submittable preview for operator correction.
- Wrike API, OAuth refresh, or download failure: retry with bounded backoff and surface connector health; never fall through to Lift.

## Momentara discovery checklist

- Confirm Wrike account and regional host.
- Identify the least-privilege technical user and approve OAuth access.
- Confirm the folder/project API ID that contains production order tasks.
- Use the exact `Sent to Print - LTL` custom-status ID as the Larger Than Life intake signal. Folder membership alone is insufficient because GPA Campaigns also contains non-LTL work.
- Treat `Ordered` as the earlier Momentara internal-creative notification state; it is not an ingestion trigger.
- Treat each workbook attached to one Placard Order task as a separate order.
- Obtain two representative examples: one Placard Order task with one workbook and another with multiple workbooks.
- Enforce the confirmed task/workbook convention `C<6 digit contract number> - <order name> - OOH Order`.
- Ignore reference-proof attachments. Momentara's creative team may later post a SharePoint folder link for print-ready artwork in the task thread or a dedicated custom field; artwork-location capture and any future Lift order update remain separate work.
- Treat `Have Address - LTL` as a later shipping-readiness signal, not an order-ingestion trigger.
- Treat edits or replacement workbooks after a Lift submission as manual exceptions initially. Lift order mutation is not yet supported by this workflow.
- Confirm whether historical tasks need a one-time backfill and the earliest safe date.
- Confirm who owns failed-ingestion review and how Pathfinder should notify them.
- Decide whether Pathfinder should write a link/status back to Wrike in a later, separately approved write-enabled slice.

## Delivery sequence

1. Configuration contract and operator UI — complete, dark only.
2. Server-owned OAuth authorization, secret storage, and read-only connection health — complete, downstream reads dark by default.
3. Controlled read-only discovery against one approved non-customer or Momentara test task — implemented dark, default off.
4. Read-only order qualification and multi-workbook candidate discovery — implemented locally, without downloading files or creating jobs.
5. Attachment download and durable source audit.
6. Preview-job creation through the existing Import Method boundary.
7. Webhook endpoint plus scheduled reconciliation and telemetry.
8. Optional artwork-locator capture and Wrike write-back, only after explicit authorization and a supported Lift update path.

## Read-only connection-health boundary

Pathfinder now stores Wrike OAuth connections under each customer's authenticated **Settings → Source Connections** area. An operator creates a customer Wrike connection, saves that connection's Wrike app client ID and client secret, then uses **Connect Wrike**. Pathfinder creates a ten-minute authorization request bound to the exact connection, stores only a SHA-256 hash of the one-time state, and exchanges the returned authorization code through the public server callback. The one-time state is consumed before token exchange and cannot be replayed.

Wrike supplies the regional host, refresh token, access token, and expiry directly to the server. Those values and the app credentials are stored only through the existing Pathfinder secret driver at a customer-and-connection-specific secret path. API responses expose configured/not-configured booleans, the validated regional hostname, and safe health metadata; they never return tokens, authorization codes, raw state, or client secrets. The production callback is `https://api.pathfinder.vornan.co/oauth/wrike/callback`; CORS is not required because the exchange is server-to-server. The callback returns to that customer's Settings and selects the exact connection that initiated authorization.

Import Methods store only `source_config.wrike.connection_id` plus their folder, trigger, and workbook contract. A method cannot use a connection owned by another customer. The prior global Wrike endpoints are retired with HTTP 410 and existing global secret material is not automatically assigned to any customer.

## Source connector template catalog

The reusable Source Connections registry currently publishes:

- **Wrike** — available and operational for the current read-only onboarding work;
- **Odoo** — planned ERP connector template;
- **Asana** — planned work-management connector template;
- **Microsoft SharePoint** — planned content-platform connector template;
- **Salesforce** — planned CRM connector template;
- **Generic REST API** — planned constrained API connector template.

Planned templates communicate the intended provider-neutral architecture but cannot be created, authorized, or used by an Import Method. Promoting any template to available requires its own adapter, secret contract, capability gates, tests, and rollout review.

The explicit connection test is separately gated by `PATHFINDER_ENABLE_WRIKE_CONNECTION_TEST`, which defaults to `false` locally, in CloudFormation, and in the production deployment workflow. Saving credentials does not contact Wrike. When the gate is deliberately enabled and an authenticated operator clicks the test action, Pathfinder performs exactly:

1. `POST https://<regional-host>/oauth2/token` with the saved refresh token and `wsReadOnly` scope;
2. `GET https://<regional-host>/api/v4/contacts?me=true` with the rotated bearer token.

Only HTTPS hosts under `wrike.com` are accepted, and the OAuth response's `host` remains authoritative for the API request. Wrike documents that OAuth tokens are regional-host aware, access tokens expire, refresh tokens rotate, and the current-user Contacts query supports `wsReadOnly`. See [Wrike OAuth 2.0 authorization](https://developers.wrike.com/docs/oauth-20-authorization) and [Query Contacts](https://developers.wrike.com/reference/getcontactsempty).

This health boundary does not itself authorize task/folder discovery, attachment reads, webhook creation, polling, background work, Wrike writes, preview creation, or any Lift action.

## Approved-scope discovery preview boundary

Pathfinder now has a second, independently gated read-only operation for one operator-approved task ID saved on a Wrike Import Method. `PATHFINDER_ENABLE_WRIKE_DISCOVERY_PREVIEW` defaults to `false` locally, in CloudFormation, and in the production deployment workflow. When the gate is deliberately enabled, the OAuth connection is configured, and the Import Method is saved and complete, an authenticated operator may run exactly:

1. OAuth refresh with `wsReadOnly`;
2. `GET /api/v4/tasks/{approvedTaskId}?fields=["attachmentCount"]`;
3. only after the returned task belongs to the saved folder/project (directly or through a super-parent), `GET /api/v4/tasks/{approvedTaskId}/attachments?versions=false&withUrls=false`.

The response contains provider identifiers, counts, and pass/warning/blocked checks only. Task titles, descriptions, attachment names, temporary URLs, file contents, OAuth material, and other provider payload fields are neither returned to the browser nor persisted. A folder mismatch stops before the attachment-metadata request. Wrike documents the task-by-ID and task-attachment endpoints as read operations available to `wsReadOnly`: [Query Tasks](https://developers.wrike.com/reference/gettasksmulti) and [Query task attachments](https://developers.wrike.com/reference/gettaskssingleattachments).

This slice does not download or select an attachment, persist discovery results, create a Pathfinder job, enable polling or webhooks, write to Wrike, or perform any Lift action. Enabling the gate or using real OAuth credentials requires a separate, explicitly approved QA window. The next implementation slice should own attachment selection/download and durable source-audit evidence as a separate checkpoint, still stopping before preview-job creation.

## Bounded QA readiness

The Wrike Import Method now evaluates a fixed, fail-closed QA readiness sequence before the discovery action can be considered ready:

1. the Import Method is saved;
2. folder/project, `Sent to Print - LTL` status, and task/workbook naming rules are complete;
3. one explicitly approved task ID is recorded;
4. the secret-backed read-only OAuth connection is configured;
5. the connection-test and discovery-preview gates are open only for an explicitly approved window;
6. the authorized-user identity check has passed.

The panel distinguishes incomplete setup, readiness to request an explicit QA window, the identity-check step, and readiness for the exact-task preview. Its capability contract always keeps attachment download, preview-job creation, polling, webhooks, Wrike writes, and Lift actions false.

The operator procedure, evidence boundary, stop conditions, and closeout steps are documented in `docs/WRIKE_READ_ONLY_QA_RUNBOOK.md`. Adding this readiness layer does not open a gate, contact Wrike, store a provider response, or authorize a deployment.

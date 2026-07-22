# Wrike Read-Only QA Runbook

## Purpose

Use this runbook to validate Pathfinder's Wrike OAuth connection and one exact, operator-approved task without downloading a workbook or creating a Pathfinder job.

This window is read-only and deliberately bounded. It does not authorize attachment download, polling, webhooks, Wrike writes, preview-job creation, Lift actions, or deployment beyond the two existing Wrike GET-only gates.

## Required approval record

Record these values outside application logs before opening the window:

- target Pathfinder environment;
- QA start and end time;
- dedicated technical-user owner and confirmation that its Wrike access is least privilege;
- confirmation that the production Wrike app uses the exact Pathfinder callback shown in Settings;
- customer and saved Import Method;
- approved folder/project API ID;
- exact approved task API ID;
- expected Ordered workflow-status API ID;
- expected workbook extension and optional filename rule;
- operator responsible for opening and closing the window.

Do not place OAuth client secrets, refresh tokens, access tokens, attachment URLs, task copy, filenames, or workbook content in the approval record.

## Preflight

1. Confirm the Import Method is saved and uses the `Wrike` source.
2. Confirm the bounded QA readiness panel has no blocked setup items.
3. Confirm the server gates are still dark before the approved start time:
   - `PATHFINDER_ENABLE_WRIKE_CONNECTION_TEST=false`
   - `PATHFINDER_ENABLE_WRIKE_DISCOVERY_PREVIEW=false`
4. Confirm attachment download, preview-job creation, webhook, polling, Wrike-write, and Lift-action capabilities are false.
5. Confirm there is no concurrent Pathfinder deployment or Proof change that modifies the shared API stack.

## Open the bounded connection-health window

Only after explicit approval, deploy the existing API with this parameter true for the approved environment:

- `WrikeConnectionTestEnabled=true`

Keep `WrikeDiscoveryPreviewEnabled=false`. Do not change Lift submit, public intake, Proof, email, DNS, or customer-submit parameters as part of this window.

## Run the checks

1. In authenticated Pathfinder Settings, confirm the Wrike app credentials are configured. Do not re-enter them unless an approved rotation is required.
2. Confirm the displayed authorized redirect URL exactly matches the redirect registered in Wrike.
3. If the connection is not already authorized, click **Connect Wrike**, authorize the dedicated technical user, and confirm Pathfinder reports a connected read-only OAuth grant. Wrike supplies the regional host and rotating tokens directly to the server callback; do not copy tokens into the browser or this runbook.
4. Run **Test read-only connection** once.
5. Confirm the connection reports **Passed**, then immediately close the connection-health window.

## Open the exact-task discovery window

Open this second window only after the connection-health window is closed, the approved folder/project, Ordered rule, exact task, and workbook rule are recorded, and the operator gives separate explicit approval.

1. Deploy the existing API with `WrikeDiscoveryPreviewEnabled=true` for the approved environment.
2. Keep `WrikeConnectionTestEnabled=false` unless a separately documented reason requires another identity check.
3. Confirm the readiness panel advances to **Preview ready**.
4. In the approved Wrike Import Method, run **Run approved task preview** once.
5. Confirm:
   - the returned task ID is the exact approved task;
   - folder/project scope passed;
   - Ordered status passed or has an explained, reviewable warning;
   - attachment metadata counts are internally consistent;
   - exactly one workbook matches the saved rule;
   - no filename, URL, task copy, workbook content, or OAuth material is shown or persisted.

Stop on any folder mismatch, unexpected task, ambiguous workbook count, provider error, or response that contains content outside the safe identifier/count contract.

## Sanitized evidence

The QA note may retain:

- environment and bounded timestamps;
- pass/warning/blocked gate names;
- safe provider IDs already present in the approved scope;
- task, attachment-metadata, and workbook-candidate counts;
- HTTP outcome class without raw provider bodies;
- confirmation that no download, job, webhook, polling, write, or Lift action occurred.

Never retain credentials, access URLs, task copy, attachment filenames, workbook content, or raw Wrike responses.

## Close each window

1. Restore the gate opened for that window to false in the same environment.
2. After connection health, confirm Settings shows the connection-test action unavailable while retaining the sanitized result.
3. After exact-task discovery, confirm the Import Method shows the discovery-preview gate off and the action disabled.
4. Confirm both Wrike gates are false before ending the QA session.
5. Confirm no Pathfinder job or submit attempt was created by the QA.
6. Record the close time and sanitized result.

Attachment selection/download remains a separate sprint and must not begin until this window closes successfully.

# Wrike Read-Only QA Runbook

## Purpose

Use this runbook to validate Pathfinder's Wrike OAuth connection and one exact, operator-approved task without downloading a workbook or creating a Pathfinder job.

This window is read-only and deliberately bounded. It does not authorize attachment download, polling, webhooks, Wrike writes, preview-job creation, Lift actions, or deployment beyond the two existing Wrike GET-only gates.

## Required approval record

Record these values outside application logs before opening the window:

- target Pathfinder environment;
- QA start and end time;
- dedicated technical-user owner and confirmation that its Wrike access is least privilege;
- Wrike regional host returned by OAuth;
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

## Open the bounded window

Only after explicit approval, deploy the existing API with these two parameters true for the approved environment:

- `WrikeConnectionTestEnabled=true`
- `WrikeDiscoveryPreviewEnabled=true`

Do not change Lift submit, public intake, Proof, email, DNS, or customer-submit parameters as part of this window.

## Run the checks

1. In authenticated Pathfinder Settings, save the approved regional host and secret-backed OAuth values.
2. Run **Test read-only connection** once.
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

## Close the window

1. Restore both Wrike gates to false in the same environment.
2. Confirm Settings shows the connection-test gate unavailable.
3. Confirm the Import Method shows the discovery-preview gate off and the action disabled.
4. Confirm no Pathfinder job or submit attempt was created by the QA.
5. Record the close time and sanitized result.

Attachment selection/download remains a separate sprint and must not begin until this window closes successfully.

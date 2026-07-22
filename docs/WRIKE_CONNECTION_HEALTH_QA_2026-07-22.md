# Wrike Connection Health QA — 2026-07-22

## Outcome

The production Momentara customer connection passed one explicitly approved, GET-only Wrike OAuth health check. Pathfinder refreshed the saved OAuth grant and performed the existing authorized-user identity request once. The connection-test gate was then restored to false and redeployed.

This evidence intentionally excludes credentials, OAuth values, provider response bodies, user identity details, task data, attachment data, filenames, URLs, and workbook content.

## Approved boundary

- Environment: Pathfinder production
- Customer connection: Empirical – Momentara / Wrike
- Authorized request: one `GET /contacts?me=true` connection-health check
- Connection-test gate: temporarily enabled
- Discovery-preview gate: remained disabled
- Attachment download, preview-job creation, polling, webhooks, Wrike writes, and Lift actions: disabled and out of scope

## Preflight

Before the window opened:

- `PATHFINDER_ENABLE_WRIKE_CONNECTION_TEST=false`
- `PATHFINDER_ENABLE_WRIKE_DISCOVERY_PREVIEW=false`
- the existing Lift submit posture was preserved without alteration;
- live-customer submit remained disabled;
- no Proof, DNS, email, public-intake, or customer-submit setting was changed.

## Bounded execution

1. Set only `PATHFINDER_ENABLE_WRIKE_CONNECTION_TEST=true`.
2. Deployed the production API through GitHub Actions run [29963146758](https://github.com/ltl-mdavies/vornan_pathfinder/actions/runs/29963146758).
3. Verified the deployed Lambda reported connection testing enabled and discovery preview disabled.
4. In the authenticated production Pathfinder UI, selected **Test connection** exactly once.
5. Pathfinder reported:
   - result: `Passed`;
   - connection: `Wrike connected`;
   - authorized-user check: succeeded;
   - regional host: `www.wrike.com`;
   - capability: read-only;
   - recorded UI time: July 22, 2026 at 6:35 PM EDT.
6. No raw provider response or identity record was retained in this evidence.

## Closeout

1. Restored `PATHFINDER_ENABLE_WRIKE_CONNECTION_TEST=false`.
2. Redeployed the production API through GitHub Actions run [29963402984](https://github.com/ltl-mdavies/vornan_pathfinder/actions/runs/29963402984).
3. Verified the final runtime posture:
   - connection-test gate: false;
   - discovery-preview gate: false;
   - live-customer submit: false.
4. Reloaded production Pathfinder and confirmed the sanitized Passed/Connected result remained visible while **Test connection** was disabled.

No task endpoint, attachment endpoint, workbook download, Pathfinder job, webhook, poll, Wrike write, Lift action, Proof change, DNS change, or email action occurred.

## Next approved slice

Exact-task discovery remains blocked until the operator records and separately approves:

- the authoritative Larger Than Life routing field and expected value;
- the exact Ordered workflow status or checkbox/custom-field contract;
- the approved Wrike folder/project API ID;
- one exact Placard Order task ID for a single-workbook example;
- one exact Placard Order task ID for a multiple-workbook example;
- the workbook selection, naming, and version rule.

When that scope is complete, open only the discovery-preview gate, run one approved-task preview, record sanitized identifiers/counts, and restore the gate to false. Continue to stop before attachment download or preview-job creation.

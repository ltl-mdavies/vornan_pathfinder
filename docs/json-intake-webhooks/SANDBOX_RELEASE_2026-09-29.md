# Intake sandbox and customer directory release — 2026-09-29

User authorized implementation/deployment with the customer-directory fix included, preservation of active features, and no overwriting current APIs/settings. JSON Intake is the sole execution owner; Development coordinates compatibility. Live Support reports no competing release or unmerged hotfix. Authorization does not include real Lift orders, Wrike writes, callbacks or email.

## Baselines and affected surfaces

Fetched main: `14ff397b9b1bc317d9c22cb6023b95ba2360a5f7`; no intervening remote commits at initial inventory. Existing API stack/artifact agrees with this SHA. No queued/in-progress GitHub release observed. Current API settings include live submit, scheduled Wrike intake/submit/writeback and document publication enabled, SES and 60-day status links, and enabled LTL Demo QA capabilities. Old workflow defaults differ; they must not be reapplied.

Release surfaces are **new independent JSON intake sandbox** and **Admin frontend**. Existing API, Proof, Status, scan-worker and all their stack parameters/artifacts stay untouched. Admin continues to use `https://api.pathfinder.vornan.co`; it is not repointed to the sandbox. Customer-picker fix is `271c0a6` and is included in this feature branch.

Actual current Admin entrypoint: S3 version `lUPtS3uu8C6T1HsIaZbCS2buPVhgXKRw`, modified 2026-09-03T21:31:58Z, SHA-256 `07e09e124bf928d584d291a18421c36ef2df80c1fe68734543d4e267d455805b`. Ten directly/transitively referenced JS/CSS/HTML assets were captured with checksums under ignored `outputs/intake-release-2026-09-29/admin-before/manifest.json`. The corresponding workflow baseline is `c421b37526f4df7c85655eae9ae784bbec70b14b`, run 33808276604. Current GitHub flags keep Artwork Catalog pilot true; Intake Exceptions flags absent/default false; auth required and existing email-domain restrictions preserved.

Full frontend delta reviewed from the deployed baseline: customer-directory fetch/search/scroll/selection fix plus main's explicitly gated Intake Exceptions/Deliveries views. Those new views remain disabled. Existing Proof/status renderers are unchanged by this branch; their regressions remain in the release suite. No main fix (#349 hardware, #350 status recovery, #351 bounded lookup) is reverted.

## Independent receipt-only architecture

New stack name: `vornan-pathfinder-json-intake-sandbox`. Separate HTTP API, Lambda, DynamoDB table, encrypted/versioned/private S3 bucket, Secrets Manager record, logs and narrowly scoped role. No resource imports or existing API/domain mappings. No IAM access to shared data, provider credentials, SES, Lift or Wrike. Runtime bundle excludes the shared server/store runtime and PDF parser. Its implementation never fetches artwork or calls providers. Table and evidence bucket are retained on stack deletion; no automatic receipt expiration.

S3 stores immutable receipt revisions first; a DynamoDB transaction atomically records current/history pointers. Acceptance is returned only after durable commit. Consistent reads verify object hashes and receipt identities. A failed transaction can leave an unreferenced object but cannot acknowledge an order. Receipt retries, changed-order conflicts, cross-scope lookup and authenticated status use the existing v1 adapter/auth/service behavior. A null ledger explicitly prevents processing; there is no worker/scheduler.

Limits: 1 MiB raw JSON, 4 MiB retained receipt, API throttling 5 requests/sec and burst 10, Lambda concurrency 5, timeout 25 seconds. Status indicates receipt/asset-pending; it does not claim artwork validation, Lift confirmation or shipping. Health exposes disabled provider capabilities. The sandbox is deployed disabled with an empty credential-hash array; activation/provisioning is separate and test-only.

## Validation and execution ledger

Focused durable sandbox tests and CloudFormation validation passed during implementation. Full candidate checks, exact merged SHA, PR, artifact/change-set IDs, final regression totals and postchecks must be recorded before claiming deployment complete. The build script verifies no shared runtime/parser imports. Infrastructure tests inspect owned resources, IAM actions, private storage, retention and routes.

Deploy script creates a disabled CREATE change set only, refuses an existing stack, and requires a clean exact current merged-main SHA. Review every action as Add before executing. Any existing-stack update must use an explicitly reviewed change set preserving credentials/storage; do not rerun creation defaults. Existing shared API deployment workflows must not run for this release.

Rollback: disable only the new sandbox parameter (preserve receipt storage and credentials), or restore the previous sandbox artifact with explicit previous parameters. Admin rollback restores the captured entrypoint/assets or their S3 versions and invalidates only the Admin distribution. Preserve receipt evidence and existing customer data. Before Admin deployment recheck current entrypoint version and active workflows; if either changed, stop and reconcile.

## Credential handoff and acceptance

Provision independent test Bearer credentials, store only token hashes with scoped identity/expiry/revocation, and keep raw tokens out of repository/log/chat. Share Andy's token through an approved secure channel, separately from future callback signing material. First smoke uses synthetic receipts and a temporary test token, including duplicate/conflict/auth/status/isolation checks. No callback signing secret is needed until outbound delivery is implemented.

Production Lift customer/catalog mapping, PDF processing/inspection, durable job binding and actual shipping callbacks remain later activation work. This sandbox gives Andy a durable authenticated place to send payloads now without those capabilities. Secure handoff details and public base URL are provided only after verified deployment.

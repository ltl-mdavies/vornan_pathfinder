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

## Completed rollout evidence

- PR: https://github.com/ltl-mdavies/vornan_pathfinder/pull/352. Reviewed feature head `5eae1f961ebe2b228023ced7ba1c7328954752ae`; merged/deployed commit `01ef97446744cb4a4bfdf83ebdef31b4373d451a`. Trees are identical. PR CI run 36574653332 and merged-main CI run 36575186397 succeeded.
- Local validation: 1,185 workspace tests (707 API, 148 Admin plus remaining packages), all workspace checks/builds, 17 browser tests, API/Proof Lambda packaging. Deployment contracts: 164 after the bundle-boundary regression was added (163 prior suite plus the separately passing new case). Three isolated infrastructure/bundle checks pass; packaged sandbox handler imports successfully. New nested-path guard rejects accidental shared runtime and PDF parser imports.
- Full-App picker test with mocked APIs: 31 options, ID `17409` search, Silicon Pasture selection and refresh retention passed. Browser screenshot and snapshots retained under ignored release output. Initial incomplete mock-envelope errors were fixture setup problems, fixed without application changes.
- AWS account `744016783602`, region `us-east-1`, explicitly verified before execution. New-stack artifact `s3://vornan-pathfinder-artifacts/json-intake-sandbox/01ef97446744cb4a4bfdf83ebdef31b4373d451a.zip`.
- Disabled CREATE change set `sandbox-01ef97446744` / `2f7c3753-0c24-4fec-bc8b-a1ea302a53a4`: all 14 actions Add, no replacements or existing-resource changes. Stack creation succeeded.
- Test activation `enable-synthetic-smoke` / `f315119c-82f2-4a70-b1e6-0adce433e4ab`: only new Function.Environment plus its IntegrationUri dependency; no replacements. UPDATE_COMPLETE.
- Live base URL: https://0kh8s19cc5.execute-api.us-east-1.amazonaws.com. Routes are `/api/v1/intake/orders` and `/api/v1/intake/orders/{receipt_id}`. Health confirms intake on; Lift submission, asset processing and callback delivery off.
- Actual AWS smoke passed: unauthorized POST 401; new synthetic receipt 202; exact replay 200/same ID; business change 409; authenticated status 200 with null Lift order and pending assets; other test scope 404; wrong store 422. Synthetic receipt `rcpt_583efedeb01c1683bee518f9eb698a88b40cb21005890f60ea44380c8c93690e` retained for audit. No provider calls occurred.
- Temporary smoke tokens revoked. Andy's test token provisioned for customer `17409`, integration `stickerpress-sandbox`, store `ltlco`, test environment, read/write orders, expiry 2026-10-29T13:34:55Z. Raw token is only in a private mode-0600 local handoff file under ignored release outputs; never committed or printed. Secret stores only the token hash. Credential has not been sent to Andy. No outbound signing secret provisioned.
- Admin-only workflow https://github.com/ltl-mdavies/vornan_pathfinder/actions/runs/36575584366 succeeded at the exact merged commit. Actual served index SHA-256 now `5915ea9367446f89e22037447eaeddc44df11eca59b344f3b794a2746ed8c319`; all ten referenced assets retrieved. Served App contains the full customer refresh path and selection-preserving warning, retains the original API origin and contains no sandbox API origin.
- Post-release comparison: shared API code SHA, revision ID, full environment hash, API stack parameter hash, Proof/Proof-assets stack parameter hashes and update times, API health body hash, and Status page hash are exactly unchanged. All checked public endpoints return HTTP 200. React, Firebase, XLSX and artwork PDF preview asset hashes also match the prior Admin build.
- Evidence lives in ignored `outputs/intake-release-2026-09-29/`: sanitized before/after baseline JSON, Admin asset manifests/copies, peer review, browser evidence and smoke result. No raw token is included in public evidence or the updated Andy ZIP.

These checks found no regression within the tested scope; they are not a guarantee for every live authenticated workflow. Existing customer orders/Proof links were not created or mutated to test this deployment. Customer picker UI behavior was tested with synthetic data, and deployment was verified from actual served assets; an authenticated production lookup is not claimed.

## Customer identity and directory correction — September 29, 2026

The earlier `17409` / Silicon Pasture identity and initial credential scope above are superseded. Marcus supplied the corrected customer `174094` / Silicone Pasture / customer number `0000000549` (549), independently verified against the live Lift CSV and authenticated Pathfinder picker. No receipt used the incorrect identity; the sole stored receipt belongs to the isolated synthetic release-smoke identity. The old Andy credential was revoked and a new credential issued for `174094`, retaining its existing expiry and read/write test-only permissions. Historical receipts were not rewritten. Updated recipient ZIPs and private credential files supersede the earlier handoff.

Customer refresh root cause was two empty deployed URL parameters. Change set `repair-customer-directory-20260929` reused the deployed API template and every unrelated parameter; its resolved change was Lambda environment only. Stack update completed. API code SHA was unchanged, and exactly `LIFT_CUSTOMER_LIST_URL` and `LIFT_CUSTOMER_STATUS_URL` changed in the actual Lambda environment. Both corresponding GitHub release variables were set to these verified URLs to prevent the workflow from blanking them again. Live refresh cleared both warnings; search found Silicone Pasture while the selected Momentara workspace remained unchanged. Read-only verification created no workspace or Lift order.

# Pre-intake visibility and bounded reference PDF release — 2026-10-28

## Scope and authority

Marcus authorized a safe API/Admin release and normal scheduler recovery of C317112 and C317113 in Pathfinder Live Support. Development was sole release executor; Live Support independently reviewed the exact release packet before execution. Preparation evidence is retained below, followed by actual deployment and recovery results.

Source: isolated `codex/pre-intake-visibility`, based on main `80215c544e9e38be34aeed802106a2317b8c76ea`. Unrelated worktrees remain untouched.

- Record sanitized Wrike preparation failures before a job exists, scoped by customer/method/task. Expose bounded read-only authenticated pages on Dashboard and Jobs → Intake exceptions.
- Keep first/last failure, occurrence count and preparation-recovery history. Conditional writes reject older observations, including a success-only watermark when no alert exists. Watermarks are not alerts and never appear in the UI. No historical failure backfill.
- Persistence failure preserves the original preparation result/error and emits sanitized logging; no new provider retry, submit, reconciliation, or writeback behavior.
- Raise reference PDF cap from 25 to 32 MiB; workbook 15 MiB, aggregate 50 MiB, attachment counts, identity guards and PDF validation remain unchanged. Content-length and streaming limits cancel overflow downloads.
- No public Proof/Status frontend, customer profile, API setting, scheduler, queue, or provider configuration changes.

## Incident and limits

Both current blocked tasks have a 27,673,344-byte (26.39 MiB) reference PDF, with separate attachment identities. C317112: task MAAAAAERUQie / 4585490590. C317113: MAAAAAERURGD / 4585492867. Customer 284619, method method-1784901795973. Each aggregate is below 50 MiB. Same filename/size does not prove identical contents. Two are the reported failures in the inspected cycle; the truncated pending backlog is not exhaustive future blast-radius evidence.

Capture is sequential; Lift receives a published file URL, not inline/base64 PDF bytes. Synthetic local tests peaked at 235,552,768 bytes RSS, not a Lambda worst-case guarantee. Production Lambda observed at 1024 MiB / 300 seconds. External Lift fetch maximum remains unverified. Intake acceptance must not be confused with downstream Lift confirmation.

## Validation

- Full typecheck, workspace tests (1,415 tests), all workspace builds and API bundle build passed after the watermark guard.
- 170 deployment contract tests passed. Historical infrastructure hashes remain checked after removing only the explicitly asserted new table/env/IAM additions.
- Existing browser regressions: 17 passed. Custom Proof viewer/background refresh production smoke separately verified October 28 without decisions; no further Proof activity needed for this release.
- Isolated built actual-App preview: Dashboard blocked failures, size/limit details, recovery distinction, Jobs intake exceptions and customer isolation verified. Unavailable storage must display unknown, not success. Fixtures are synthetic and cannot call production.
- Browser HMR preview was blank; production-built fixture preview rendered successfully. No production workaround or code change made for HMR.

## Reviewed production targets and pre-execution gates

- Shared API stack/function `vornan-pathfinder-api-prod`, us-east-1.
- New retained, deletion-protected, encrypted/PITR DynamoDB diagnostic table; API role adds only GetItem/PutItem/Query for that exact table; one API environment binding. Expected change set: table + role + API function only. Reject unexplained changes.
- Admin bucket `vornan-pathfinder`, distribution `E34F508KID3LHW`, to be freshly verified. Preserve current build flags, including Artwork pilot. Assets first, HTML last; no asset deletion.
- Fresh production template and all current parameters must be captured. Preserve every parameter with UsePreviousValue except exact immutable Lambda artifact key. NoEcho values must not be printed or copied into evidence.
- Exact PR-head CI, independent code review, merged-main CI, exact-main immutable build, source-map dependency diff, nonexecuting change-set inspection, versioned Admin index/transitive-asset rollback inventory, and final no-overlap check were required before execution; results are recorded below.

## Rollback and acceptance

Keep prior API artifact/configuration in durable S3 release storage and prior Admin object versions with index/transitive-asset inventory. Revert compatible API code and Admin entrypoint if verification fails; retain diagnostic table/data. Never delete accepted orders or withdraw valid confirmations as rollback. The older API ignores the new diagnostic environment binding.

After approved execution, verify the actual artifact/revisions and authenticated Dashboard/Jobs data paths. Observe the already-enabled scheduler rather than manually racing it. For each contract require job/ExtID, one unambiguous confirmed Lift order and supported Wrike comment ID/time. Ambiguous submissions are reconciled, never retried. If first preparation succeeds, no new-table alert existed and no alert-clear transition was observed; report that honestly. Do not induce production errors to demonstrate alerts.

## Execution — October 28, 2026

Deployed merged main `f5c408f94c6af0346244044993a609d5db4e025c` (PR 370). PR CI 40768698210 and merged-main CI 40769394572 passed. Live Support independently approved exact execution and verified API closure.

- API corrected canonical-YAML change set `pre-intake-f5c408f94c6a-yaml/1e29e019-f807-49b8-a35b-d1eabbec84e2` executed once at 21:21:04Z. Stack reached UPDATE_COMPLETE. Superseded JSON-normalized candidate was **not executed** because it introduced unrelated representation-only resource changes.
- Corrected preview had three intended semantic changes plus three exclusively derived unchanged-ARN dependencies (API integration, scheduler target, invocation permission). Actual stack events changed only the table, API role, and API function. Scheduler rule, input, retry policy, enabled state, interval, and permission identity were unchanged.
- API SHA256 (base64) `7NfmGl8UlAhcJsrsqlyYVuzy6RRlJHF3/5ujxdbkRFI=`, revision `5ca4c54a-fcbb-4f96-a862-bd59272feb79`. All 120 effective parameters matched the reviewed plan; every prior environment value preserved plus the diagnostics table binding. Exact-table GetItem/PutItem/Query verified; table active with deletion protection, KMS encryption and PITR. Proof scan worker revision/code/config unchanged.
- Admin-only workflow [40771698471](https://github.com/ltl-mdavies/vornan_pathfinder/actions/runs/40771698471) succeeded from exact merged source. Assets first, entrypoint last, no deletes; no variables changed. Bucket `vornan-pathfinder`, CloudFront `E34F508KID3LHW`; invalidation `IAPU1BJ3IH00GM58RQ6JCR3O7J` completed.
- Admin index version `5Naes.i9AfNfrKnBHczUmU.l0e1ovLPY`, SHA256 `e94207a9a366236d81baa934592dd3f65ad191e2ebe3f6f2bf301c37393e1d93`. A vendor-chunk discrepancy with the original local verification build was investigated: a fresh isolated exact-commit checkout, `npm ci`, and the same build command as CI reproduced **all 37 deployed files byte-for-byte**. Original manifest retained; no speculative rollback/redeploy. CDN index matched verified S3 bytes.
- Authenticated Dashboard and Jobs/Intake exceptions reads passed, including open/all-recorded empty states and honest coverage labels. Both newly confirmed orders visible in Jobs and Dashboard. No production failures were induced. Public Proof/Status frontends and JSON intake configuration were not deployed or changed.

### Normal scheduler recovery

Cycle `wrike_scheduled_20261028212753236` completed preparation 2/failed 0, submission 2/failed 0, and writeback posted 2/failed 0. No manual intake, replay, resubmission, or comment was performed.

| Contract | Job / Ext ID | Confirmed Lift order | Independently verified Wrike comment |
| --- | --- | --- | --- |
| C317112 | `job_20261028212809_171d63` / `PFMVSMLX3Q3994` | A0234335 | `IEAALTG3IM6AJK34`, 2026-10-28 21:28:49Z (5:28:49 PM ET), status link present |
| C317113 | `job_20261028212814_75fd6c` / `PFMVSMM0GZF405` | A0234336 | `IEAALTG3IM6AJK6G`, 2026-10-28 21:29:04Z (5:29:04 PM ET), status link present |

Live Support independently read exact Wrike tasks and found exactly one matching confirmation each. Each job had a single accepted/Submitted durable attempt and no unresolved or canonical/Lift validation failures. These were first successful preparations after feature creation; there was no prior diagnostic alert to clear and no historical backfill.

### Evidence, rollback, limitations

Private durable evidence: `s3://vornan-pathfinder-artifacts/releases/pre-intake-f5c408f94c6af0346244044993a609d5db4e025c/`. Includes baseline, exact template/parameters, API source-map diff, artifact/rollback manifests, execution and after-check reports. API prior immutable key `api/pathfinder-api-lambda-d3731a1097171f24b0016073218c480e8458fd86.zip` remains versioned. Admin prior index version `xRCE6RjsgC2cZKgaKBRzg7MtRnhKkSEd` and 33-object transitive version inventory retained. Rollback keeps diagnostic data and accepted orders; restore old API code using a newly reviewed code-key-only change set, and old Admin assets/index with app-scoped invalidation if required.

Live Support issued final independent release/recovery GO at 21:33:21Z after independently hashing all 37 public CDN files against the fresh reproduction and confirming completed invalidation. The known pre-release candidate-failures alarm recovered; the final alarm list was empty. The 21:32:51Z post-release log sample had zero diagnostic-persistence warnings and zero timeouts, maximum invocation duration 71,629.54 ms, and maximum reported memory 676 MiB of 1024 MiB. These are observed-cycle measurements, not worst-case guarantees. Both jobs remained OrderConfirmed with one accepted attempt and one posted writeback at the final 21:32:55Z read. Independent release/no-overlap lock closed; no further customer/provider/replay action required.

Dependency audit warnings from the unchanged lockfile remain a separate maintenance concern; no dependency upgrades were bundled into this release. The superseded JSON change set is OBSOLETE and was never executed. Production images and signed URLs are omitted from source-controlled records; authenticated screenshots and manifests are retained privately with the release evidence.

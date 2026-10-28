# Pre-intake visibility and bounded reference PDF release — 2026-10-28

## Scope and authority

Marcus authorized a safe API/Admin release and normal scheduler recovery of C317112 and C317113 in Pathfinder Live Support. Development is sole release executor; Live Support independently reviews the exact release packet before execution. This record is preparation evidence, not a deployment claim.

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

## Intended production targets and gates

- Shared API stack/function `vornan-pathfinder-api-prod`, us-east-1.
- New retained, deletion-protected, encrypted/PITR DynamoDB diagnostic table; API role adds only GetItem/PutItem/Query for that exact table; one API environment binding. Expected change set: table + role + API function only. Reject unexplained changes.
- Admin bucket `vornan-pathfinder`, distribution `E34F508KID3LHW`, to be freshly verified. Preserve current build flags, including Artwork pilot. Assets first, HTML last; no asset deletion.
- Fresh production template and all current parameters must be captured. Preserve every parameter with UsePreviousValue except exact immutable Lambda artifact key. NoEcho values must not be printed or copied into evidence.
- Exact PR-head CI, independent code review, merged-main CI, exact-main immutable build, source-map dependency diff, nonexecuting change-set inspection, versioned Admin index/transitive-asset rollback inventory, and final no-overlap check remain required before execution.

## Rollback and acceptance

Keep prior API artifact/configuration in durable S3 release storage and prior Admin object versions with index/transitive-asset inventory. Revert compatible API code and Admin entrypoint if verification fails; retain diagnostic table/data. Never delete accepted orders or withdraw valid confirmations as rollback. The older API ignores the new diagnostic environment binding.

After approved execution, verify the actual artifact/revisions and authenticated Dashboard/Jobs data paths. Observe the already-enabled scheduler rather than manually racing it. For each contract require job/ExtID, one unambiguous confirmed Lift order and supported Wrike comment ID/time. Ambiguous submissions are reconciled, never retried. If first preparation succeeds, no new-table alert existed and no alert-clear transition was observed; report that honestly. Do not induce production errors to demonstrate alerts.

## Execution

Pending exact release review; no deployment or recovery claimed by this record.

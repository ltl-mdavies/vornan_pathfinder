# Proof restricted allocation QA release — October 29, 2026

Status: deployed and authenticated baseline smoke passed. A0232139-only allocation configuration activation completed and verified; supervised live allocation QA is handed to the Proof owner. Revised-art submission and broader customer launch remain off.

## Execution — October 29, 2026

- PR 374 merged as `7b6259c63c6eb4a73744c55d3d366eb88b173197`, reviewed head `b600993c6286dbb17d17cc30f64339eda81a3afa`; CI 40919171553 passed.
- Stack `vornan-proof-dev` completed initial update. Reviewed changes: public Lambda, same-ARN integration dependency, and the single exact-table ConditionCheckItem role permission. No replacements.
- Public Lambda code SHA256 `EALxJrlOgoVHUskLqoccyudTBXuf+G7Ve8VSTtCmpWI=`, timeout 60 seconds. First deployed with allocation false/scope empty.
- Proof frontend published at 17:22 UTC, index version `np6qUsZaucT2Gqa1JEj5Fa8j6jqbeOeL`; invalidation `I17S2JHLHBSTOBBXU2CMQZ7SE1` completed. All 13 CDN files match local SHA256 manifests. Previous assets retained.
- Sync/operator/primary API revisions, code and configuration unchanged. Admin and Status index versions unchanged. IAM simulation now allows ConditionCheckItem only on the intended ProofCore table; remaining inline policy unchanged.
- Proof owner authenticated baseline smoke passed after a full reload using the existing A0232139 simple session: reviewer retained, Open 5 / Approved 1 of 6 / Awaiting proof 1, line 2 remains approved, full-resolution custom PDF canvas (no iframe), control tooltip, filename information and full-art thumbnails intact. Refresh retained selected line and open File history; no captured console errors/warnings. Allocation remained unavailable; revised-art submission was not exposed. No decisions or access mutations during smoke.
- Aggregate public Lambda Errors metric: zero across 15 datapoints in the 17:10–17:25 UTC window; metrics can lag and do not replace authenticated verification.
- Durable evidence/rollback: `s3://vornan-pathfinder-artifacts/proof/releases/allocation-qa-b600993c6286dbb17d17cc30f64339eda81a3afa/` (private). Includes prior public ZIP/template/role, prior web assets, candidate artifacts, manifests, execution guards and verification reports. No private access tokens or reviewer data exported.
- Separate activation change set `allocation-qa-enable-a0232139-b600993` changes only the public Lambda configuration plus same-ARN integration dependency: allocation true, scope exactly `1249:A0232139`. Every other parameter uses its previous value. Fresh aggregate access check found zero other usable LTL Demo access; recheck immediately before Proof saves the supported order exception.
- Activation reached UPDATE_COMPLETE. Verified public revision `91965885-91c4-4b55-8282-429464fa09f8`, identical code hash, exact scope, unrelated environment/function values unchanged. Fresh aggregate access check at 17:27:30 UTC still found zero other usable LTL Demo access; Proof received the supported UI exception/grant handoff.
- Existing File history can show an Approved in Lift timestamp for a currently pending attachment because Lift supplies that timestamp. Follow-up polish item, not evidence of current approval; no change included in this release.

### Final integration findings

Integrated Proof recovery delta 8e2711d as c710837; frontend source is identical to the submitted UX revision. Pathfinder UX recorded exact-revision restricted QA clearance on October 29. Its 86 UI tests, build and full typecheck pass. Full integrated suites pass: 1,454 application/package checks, 175 deployment checks and all 17 browser regressions. CI first exposed an obsolete browser-test expectation (Ready to approve vs approved Ready to review); corrected only the test string and reran the complete browser suite locally, including final submission/completion assertions. No UI change was needed.

Actual AWS change-set review adds the unchanged API Gateway integration ARN reference as a dynamic dependency of the public Lambda; existing integration ccg8t2g remains AWS_PROXY to the same function with 30-second edge timeout. No routing/authentication changes are intended.

Read-only IAM simulation identified an actual missing permission: ConditionCheckItem is implicitly denied on ProofCore, while PutItem is allowed. New durable snapshot/claim transactions use ConditionCheck, which requires its own underlying IAM action (AWS DynamoDB transaction IAM documentation). Add only `dynamodb:ConditionCheckItem` on the exact ProofCore table to the existing public role under CustomerRuntimeActive; no scan/delete/admin/customer-workspace permission added. This explicitly adds the public role's inline policy to the reviewed infrastructure scope. Existing TransactWriteItems statement is preserved; do not infer it authorizes ConditionCheck.

The initial unexecuted change set is superseded by this permission correction; create/review a new one. Retain prior role/template for rollback and verify live policy simulation after deployment before any QA action.

Direct human approval for A0232139-only Advanced QA access was subsequently confirmed in the Proof chat. After deployed baseline smoke, Development will activate only the exact `1249:A0232139` allocation scope; Proof owns the supported UI order exception and fresh grant/session to avoid duplicate access changes. No email. All other defaults/exceptions stay unchanged. Revised-art remains off.

## Authority and reviewed scope

Marcus requested proceeding through v1 blockers in Vornan Proof Development on October 29, following the restricted deployment → A0232139 live 5/7 QA plan. Development owns the coordinated release; Proof owns supervised customer-path QA. UX approved allocation candidate 43929b4, thumbnail delta 834928da3d5d370dab3843e8f8caa45a694cd765, and final paused-status protection revision 8e2711d3163882dbadb0abf1d61a799a0d948f48 for restricted QA only. Final frontend source matched that approved revision.

Base: main 344c2416cd87342d940b533f1c8eb0e9d6fb65ae. Clean integration clone: `/private/tmp/pathfinder-proof-allocation-release.erUVXt`. Separate from owner worktree and unrelated live operations work. Workspace deployment requirements and UX governance reviewed.

## Exact resources

- Stack `vornan-proof-dev`; proposed public-only code/config update to `vornan-proof-public-dev`.
- Proof SPA `s3://vornan-pathfinder-proof-dev/`; CloudFront `E381PLTIBZ9880` / proof.vornan.co.
- Private artifact/rollback storage: `vornan-pathfinder-artifacts`, release-specific prefix to be recorded before execution.
- Preserve `vornan-proof-sync-dev` and `vornan-proof-operator-dev` packages/configuration through unchanged legacy artifact references.
- Preserve primary `vornan-pathfinder-api-prod`, Admin `vornan-pathfinder` / E34F508KID3LHW, Status `vornan-pathfinder-status` / E13RHNZTC6PRRC, intake schedules, authentication, customer defaults, credentials, existing Proof tables/queues/assets and permissions.

## Integration safeguards

- PublicFunctionCodeS3Key provides a public-only artifact override, retaining the original shared artifact as worker/operator code. Empty override preserves existing stack behavior.
- Allocation flag remains default off. New CustomerAllocationScope defaults empty and fails closed; exact customer-id:order pairs required in both advertised capability and service authorization. No wildcard, customer-wide or malformed scope accepted. General rollout requires explicit later scope changes.
- Both Proof frontend publishers retain previous hashed assets (no --delete); assets first, HTML last.
- Public timeout changes from 15 to 60 seconds. Browser/API-edge timeouts still require durable status recovery, never automatic action replay.

## Preflight evidence

- Full typecheck passed.
- 1,454 application/package tests passed: API 844; Proof 86; Status 17; Admin 262; packages 245. Initial sandbox run could not bind local HTTP test servers; rerun with local binding permitted passed completely.
- 175 deployment-contract checks and all 17 browser regressions passed; Proof Lambda package and SPA production builds passed.
- Exact scope denial tests cover empty, wildcard, malformed, wrong-customer/wrong-order input and denial before any source read, reservation or Lift send.
- Live public package downloaded and checksum verified against AWS CodeSha256. Source-map comparison shows five changed existing application modules, seven newly reachable Proof modules, no removed modules and no dependency source changes. Existing shared order-rollup difference is the previously shipped carrier-name/tracking helper, not an intake/auth change. Verify final bundle again after integration.
- Canonical template vs deployed template differs only in the new public artifact reference, allocation parameters/rule/environment fields and public timeout. Actual AWS change set remains mandatory.
- Template exceeds direct 51,200-byte ValidateTemplate body limit; validation must use private S3 template URL. This was a request-size failure, not a template-validation pass.

## Observed baseline and access inventory

Captured locally at `/private/tmp/proof-allocation-release-evidence.ahidey`; must stage durable artifacts before execution.

- Public revision 6803b36e-69fa-4f5a-b007-86f858158a2f; sync d2f566d7-e558-466e-8a22-a4034e82cf47; operator 9057699d-aa5f-41df-a8c7-368ac3d19e1e. All three code SHA256 Rv5tguDfJ2zoAGPvLuLjfb+ePOcIzvmLiTAUzz+XRys=.
- Primary API revision 5ca4c54a-fcbb-4f96-a862-bd59272feb79, code SHA256 7NfmGl8UlAhcJsrsqlyYVuzy6RRlJHF3/5ujxdbkRFI=.
- Proof index version RcX49LmmhntkyxGj2T4MmPtQpmGfzDBB; Admin E0JCVlkCfGUzdyK8jwp2V1Z8n7sGtJaa; Status 3d_p4qRzSbwo_Wi5_kmv5.SIzdn36Swp.
- Consistent paginated inventory at 16:31 UTC: 3 customer workspaces, zero Advanced defaults/order overrides; 69 grants, zero Advanced grants; one session, zero Advanced sessions. Only unexpired/non-revoked review grant is simple A0232139. Repeat before any activation. No token/reviewer details belong in public release notes.
- General customer review scope remains disabled; persistent LTL_DEMO_ALL QA profile remains intact. Operator execution remains locked. Do not alter them to enable allocation QA.

## Remaining QA gates

1. Exact-scope activation verification passed; preserve all unrelated environment variables and resources during subsequent QA.
2. Proof owner applies the specifically authorized A0232139-only Advanced exception through the supported UI, creates a fresh order-only review grant/session, and performs the supervised live 5/7 line-4 test. No email; leave other defaults/exceptions unchanged. Repeat access impact check immediately before saving.
3. Record authoritative Lift reconciliation and durable receipt recovery, not just an HTTP success. Keep revised-art submission off pending separate contract/UI verification; isolated revised-art work c45630a is excluded from this release.

## Recovery

Preserve prior assets and exact public code/configuration references in private durable release storage. Before any allocation action, disabled code deployment can be rolled back using the saved public artifact override and reviewed template/config. After a durable claim or external action, do NOT roll back to code unable to interpret its receipt, clear claims, or replay actions. Pause new allocation work, retain claims/receipts, and reconcile first; roll forward with compatible recovery when necessary. Revoking/changing scoped authority can prevent viewing existing receipts, so do not use access revocation as a substitute for safe operational recovery.

Deployment is complete as described above. This Development release does not itself make proof decisions; the separately authorized fixture actions belong to the Proof owner and must be recorded separately.

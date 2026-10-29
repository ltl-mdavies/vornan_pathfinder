# Proof restricted allocation QA release — October 29, 2026

Status: preparation; NOT deployed. Allocation activation and order policy changes are separate from the initial disabled release. Revised-art submission and broader customer launch remain off.

### Final integration findings

Integrated Proof recovery delta 8e2711d as c710837; frontend source is identical to the submitted UX revision. Pathfinder UX recorded exact-revision restricted QA clearance on October 29. Its 86 UI tests, build and full typecheck pass. Full integrated suites pass: 1,454 application/package checks, 175 deployment checks and all 17 browser regressions. CI first exposed an obsolete browser-test expectation (Ready to approve vs approved Ready to review); corrected only the test string and reran the complete browser suite locally, including final submission/completion assertions. No UI change was needed.

Actual AWS change-set review adds the unchanged API Gateway integration ARN reference as a dynamic dependency of the public Lambda; existing integration ccg8t2g remains AWS_PROXY to the same function with 30-second edge timeout. No routing/authentication changes are intended.

Read-only IAM simulation identified an actual missing permission: ConditionCheckItem is implicitly denied on ProofCore, while PutItem is allowed. New durable snapshot/claim transactions use ConditionCheck, which requires its own underlying IAM action (AWS DynamoDB transaction IAM documentation). Add only `dynamodb:ConditionCheckItem` on the exact ProofCore table to the existing public role under CustomerRuntimeActive; no scan/delete/admin/customer-workspace permission added. This explicitly adds the public role's inline policy to the reviewed infrastructure scope. Existing TransactWriteItems statement is preserved; do not infer it authorizes ConditionCheck.

The initial unexecuted change set is superseded by this permission correction; create/review a new one. Retain prior role/template for rollback and verify live policy simulation after deployment before any QA action.

Direct human approval for A0232139-only Advanced QA access was subsequently confirmed in the Proof chat. After deployed baseline smoke, Development will activate only the exact `1249:A0232139` allocation scope; Proof owns the supported UI order exception and fresh grant/session to avoid duplicate access changes. No email. All other defaults/exceptions stay unchanged. Revised-art remains off.

## Authority and reviewed scope

Marcus requested proceeding through v1 blockers in Vornan Proof Development on October 29, following the restricted deployment → A0232139 live 5/7 QA plan. Development owns the coordinated release; Proof owns supervised customer-path QA. UX approved allocation candidate 43929b4 and thumbnail delta 834928da3d5d370dab3843e8f8caa45a694cd765 for restricted QA only. A subsequently reported paused-status protection fix is still awaited; do not publish the final frontend before its exact-revision approval.

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

## Preflight evidence so far

- Full typecheck passed.
- 1,450 application/package tests passed: API 844; Proof 82; Status 17; Admin 262; packages 245. Initial sandbox run could not bind local HTTP test servers; rerun with local binding permitted passed completely.
- 174 deployment-contract checks passed; Proof Lambda package and SPA production builds passed.
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

## Remaining execution gates

1. Integrate final paused-state frontend fix and exact UX review; rerun impacted tests/build and review source diff.
2. Commit/push reviewed scope through PR/CI and ensure main includes it without unrelated deployment. Record immutable source SHA and artifact hashes.
3. Stage durable current public package, entry HTML, reachable assets and configuration/template baseline. Do not publish secrets or source maps as public frontend assets.
4. Create and inspect an AWS change set using previous values for every existing parameter; new allocation flag false, scope empty, public-only key updated. Require exactly intended public function change; no worker/operator/IAM/CDN/storage changes.
5. Recheck revisions, environment hashes and artifact/index versions, then execute authorized disabled release. Publish frontend only after its gate clears.
6. Verify actual deployed artifacts, authenticated current QA read/session, viewer controls/hover text, quiet refresh, scope denial and single-proof compatibility. Proof owner performs authenticated smoke with existing session; no decisions implied by smoke.
7. Request/record specific order-exception/new-grant/allocation activation authority if not already explicit. QA scope is 1249:A0232139 only; leave defaults and other orders unchanged. Fresh session required after changing the order binding.

## Recovery

Preserve prior assets and exact public code/configuration references in private durable release storage. Before any allocation action, disabled code deployment can be rolled back using the saved public artifact override and reviewed template/config. After a durable claim or external action, do NOT roll back to code unable to interpret its receipt, clear claims, or replay actions. Pause new allocation work, retain claims/receipts, and reconcile first; roll forward with compatible recovery when necessary. Revoking/changing scoped authority can prevent viewing existing receipts, so do not use access revocation as a substitute for safe operational recovery.

No production changes or live approval actions were performed while writing this record.

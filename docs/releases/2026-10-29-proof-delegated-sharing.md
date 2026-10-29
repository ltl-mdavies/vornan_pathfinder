# Proof delegated order sharing — implementation review

Status: local candidate; not deployed or activated. Development owns integration/release. Pathfinder UX must approve this exact implementation before merge/deployment.

## Source and scope

Branch `codex/proof-delegated-sharing`, based on main `484105688788b425dfa4644e370d9812a1b259fc`. The commit containing this record is the review candidate; the exact SHA is provided in the coordinated handoff.

Implements Share beside the order counts, using the approved compact layout. Original authorized reviewers can create View or Review & act links; recipients cannot create further links. These are bearer links: forwarding an existing URL is still possible. No changes to Proof bearer authentication, approval semantics, optimistic reconciliation, viewer layout, or revised-art activation. Delegated revised-art submissions remain denied.

Expiry choices: 24 hours, 3, 7, 14 days, bounded by parent grant and effective activation deadline. Default View/24 hours. Optional private description, effective expiry with timezone before creation, copy confirmation/fallback, explicit revoke confirmation, empty/loading/failure and response-loss recovery states.

## Security and consistency

- Legacy links remain single-use. Delegated links create independent sessions/CSRF secrets and require each recipient to identify separately before actions.
- Every authenticated recipient request checks current child and parent authority, expiry, revocation, capability policy and sharing gate. Direct consistent reads follow any GSI lookup.
- No onward grant creation, cross-order management, or inherited participant identity. View cannot approve, request changes, allocate quantities or submit revised art. Review retains all current feedback/version/shared-art/quantity restrictions.
- Creation transaction atomically CAS-updates parent, inserts child and audit. Grant updates/revokes use snapshot CAS so stale writers cannot resurrect authority.
- Raw link secrets are not stored. Same-session response recovery uses a domain-separated HMAC keyed by validated raw CSRF secret, bound to parent/session/UUID and persisted request fingerprint/expiry. The browser persists only the pending request, not the URL or CSRF secret. Recovery is not available from another session; owners can revoke a listed link and create another.
- Order/session context is bound explicitly to all share requests to reject stale cross-tab cookies. Background list responses cannot overwrite later mutations; reopening reconciles/removes revoked copyable URLs.
- Limit 100 created links per parent and five seconds between new creations; identical retries are exempt. Existing edge/API throttles remain in place.

## Validation

From the isolated candidate checkout:

- `npm run test --workspace @pathfinder/api`: 885/885 passed (localhost binding required).
- `node --import tsx/esm --test apps/api/tests/proof-sharing.test.ts`: 12/12 passed, including final strict-scope and View capability assertions.
- `npm run test --workspace @pathfinder/proof`: 103/103 passed.
- `npm run test:proof-deploy`: 185/185 passed.
- `npm run check --workspace @pathfinder/api`: passed.
- `npm run build --workspace @pathfinder/proof`: passed.
- `npm run build:proof-public-lambda`: public, sync and operator bundles built successfully.
- `npm run build:api-lambda`: main API compilation passed; this is NOT authorization to deploy the whole main bundle.
- `git diff --check`: passed before commit.

The original/delegated approval and allocation suites run the same mocked transport matrix for both roles: positive approval/change-request and quantity-split reconciliation, View/unidentified denial, stale version/feedback/shared-art/quantity guards, idempotency and no automatic resend. No real Lift requests occur.

Frontend artifact identifiers:

- `index-CHbOA1Uh.js`, SHA256 `314bcb6fd3a0a064a732f38c02976281d3a4af0229a33c432d7ac27206c5cfe4`
- `index-DLHbDlkn.css`, SHA256 `f476c7232addabf9d4ac43f9677e448eecb487d7dbb87f41156a6b2310dac544`
- `index.html`, SHA256 `5c4549d476604cce97777e5d51bec7794d7269e01053fd361bb50e69263400b2`

### Browser evidence and limits

Production-built frontend served at localhost:5192 with synthetic in-memory API fixtures and `.invalid` dummy links. Screenshots are in `/Users/marcusdavies/.codex/visualizations/2026/08/10/019fed7e-564b-7141-992d-bf856a4ca509/allocation-qa-oct29/`:

- `share-final-empty-1366.png`: View/24h defaults and empty list.
- `share-final-parent-limit.png`: seven-day choice capped by three-day parent, exact timezone.
- `share-final-unconfirmed.png`: simulated lost create response, retained settings and Check status.
- `share-final-created-1366.png`, `share-final-created-1920.png`: recovered same dummy link.
- `share-final-mobile.png`: 390×844 centered, scrollable panel, 16px side margins.
- `share-final-recipient-1366.png`: no Share entry; read-only actions disabled.
- `share-final-external-revoke.png`: another fixture actor revoked link; reopening removes copyable URL.
- Earlier `share-real-revoke-confirm.png`: explicit confirmation; `share-real-created-1366.png`: same UI before mobile margin fix.

Browser checked create/recovery, reload recovery, copy success, revoke confirmation, external revoke reconciliation, Escape/close focus return, desktop/mobile. Clipboard denial fallback and delayed-list race guards have code/test coverage, not manual browser fault injection. Full screen-reader and actual 200%-browser-zoom testing are not claimed. Synthetic background refresh intentionally returns 405; any sync warning visible behind the panel is a fixture limitation, not a live Lift failure. This is not production integration evidence.

## Coordinated release prerequisites

Read workspace `docs/DEPLOYMENT_REQUIREMENTS.md` and UX governance before release. Actual production resource IDs, live revisions, approved cohort, artifact package diffs and exact rollback retention must be recorded by Development before changes.

1. Exact-source UX approval plus Development security/integration review.
2. Deploy compatible grant writers before activation: Proof public API, Proof operator and main Pathfinder `/api/proof` grant/policy consumers. Include any operational scripts used after activation. Public-only release is insufficient.
3. Keep sync code unchanged. New default-empty `OperatorFunctionCodeS3Key` allows operator-only compatibility release; public override remains separate. Shell requires a verified operator override (explicit empty only for legacy); workflow preserves the existing live override. Never reset it to old shared code accidentally.
4. Main API must use a reviewed live-package/source-map compatibility diff. Development found unrelated upload-module drift in whole-current-main output and is preserving the live upload modules. Build success does not authorize that unrelated change. No intake or other app changes are intended.
5. Canonical configuration: CloudFormation `SharingEnabled=false`, `SharingScopes=""`; mapped only onto the public function as `PATHFINDER_PROOF_ENABLE_SHARING` / `PATHFINDER_PROOF_SHARING_SCOPES`. Both shell and workflow expose them. Strict exact customer/order pairs, maximum 25; no wildcard or malformed partial acceptance. Enabled configuration requires existing public-review authority; it does not turn approval/revision gates on.
6. Verify reviewed stack change set, Lambda environment byte budget, current IAM transaction rights on exact core/audit tables, customer-policy read rights, revision IDs and artifact contents. No new broad IAM grant is included. Existing customer-runtime transaction authority is required by the activation rule.
7. Preserve existing approval/allocation/revised-art gates, runtime settings and active access. Inspect all parameter values; default-off deployment inputs must not unintentionally reset unrelated active settings.
8. Publish Proof frontend assets first, HTML last, retain prior hashed assets and invalidate only Proof. No broader app frontend release.
9. Only after separate activation authorization: verify a fresh owner and recipient in the exact approved cohort, independent identification, View rejection/Review guards, revoke/expiry, legacy access, cross-tab behavior and main/operator revocation. Do not perform live proof decisions unless expressly authorized.

## Rollback compatibility

Before any delegated grant exists, prior artifacts may be restored within the reviewed scope. Once any child exists, do NOT roll the public/main/operator back to code that ignores delegated kind, parent revocation or sharing gate. Turning sharing off is a safe access kill switch only while compatible auth code remains deployed. Prefer compatible-code rollback with sharing disabled. An older backend requires enumerating and revoking/fencing all delegated grants and preventing concurrent creation first, with verified postconditions. Frontend-only rollback is safe with compatible backend retained. Retain reviewed artifacts/configuration durably, not only in temporary QA directories.

## Not performed

No push, merge, deployment, activation, live grants, email, proof decisions, revised-art upload or production configuration changes. Untracked `apps/api/data/` is excluded from the commit and left intact. Final approvals and production checks remain with the coordinated owners; no outstanding product-permission decision is required.

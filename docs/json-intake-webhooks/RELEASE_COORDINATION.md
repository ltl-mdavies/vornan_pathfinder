# Release coordination and regression protection

This project develops while live Pathfinder, Momentara/Wrike, Proof, Order Status, and Intake Assurance continue evolving. The goal is evidence-backed compatibility, not freezing production work. Pathfinder Development coordinates releases; this task owns the JSON/webhook feature branch and release candidate.

## Collaboration and change ownership

- Work only in the new managed worktree/branch. Do not switch/reset/edit another task's checkout; preserve their dirty files and untracked artifacts.
- Fetch main at kickoff, before shared-interface changes, before opening/updating review, and immediately before release review. Record intervening hotfixes and reconcile intent, not just conflict markers. If base or code changes after tests, run affected checks again and repeat the final candidate gate as required.
- Coordinate before editing shared canonical types, store/schema, server/router auth, template parsing, Lift transport/reconciliation, Proof assets, shared rollup UI, manifests/lockfiles, CI or infrastructure. Prefer additive modules with small integration points.
- Peer task titles/IDs are in COORDINATION.json. User authorizes ongoing project/release coordination messages among these tasks. Messages must stay scoped to ownership, overlap, evidence and release timing; no message delegates production authority.
- One release owner deploys the shared API at a time. Preannounce candidate SHA, services affected, config diff, expected resource changes, smoke/rollback plan and operational timing. Obtain peer evidence for touched surfaces, not broad blanket sign-offs unrelated to the slice. Do not assume a task reply grants the user's release authorization.
- Hotfixes have priority. Do not deploy an old feature checkout over newer fixes. Never overwrite owner work to make tests pass or weaken tests to fit the new module.

## Keep these behaviors intact

| Surface | Regression evidence |
| --- | --- |
| Momentara Wrike intake | Existing qualification/vendor/status rules, configured roots and method scope, workbook/header/quantity/date parsing, hardware lines, attachment revisions, immutable source evidence and known parser hotfixes |
| Order submission/reconciliation | Idempotent identity, one confirmed Lift association, EXT_ID query uses p3, timeout/uncertain submission reconciles before retry, collision/ambiguous results remain safe, no duplicate orders |
| Wrike comments/Intake Assurance | Confirmation comments only after verification, existing writeback deduplication and repair, ledger ownership and delivery claims, natural scheduler behavior and budgets |
| Proof | Custom unified PDF/image controls and hover/focus text, navigation/zoom/rotation, high-resolution assets, reviewer/revision/approval permissions and audit, resync preserves visible content, latest Lift line step can move backward or forward, explicit rejection/revision preserved |
| Order Status | Production typography/branding/layout and shared renderer, first-load creative thumbnails, CREATED_TS and PROOF_APPROVED_TS labels, prompt shipment loading/loading state, carrier/service labels, compact mixed-case chips, sync message in top header with no page shift, accurate timestamps, cancellation behavior, token access/privacy |
| Status email/recovery | SES availability gating, recovery lookup performance, new links 60 days, existing expiry semantics, retention versus access deadlines, neutral request responses and tenant/order access checks |
| Admin/auth/infrastructure | Existing Firebase auth/CORS/role boundaries, current API settings/secret refs/table namespace/buckets/TTL schedules, no accidental table replacement, global feature posture unchanged except reviewed new configuration |

Historical docs may describe Proof or other features as off when they are now enabled. Never restore those historic settings merely by following an old runbook. Actual read-only production inventory and owner evidence prevail. An active-customer directory change is not authorization to submit orders.

## Release candidate record

Create a durable release ledger in docs/json-intake-webhooks with: baseline/current main SHA, exact candidate/merge SHA, PR URL, changed surfaces, relevant intervening hotfixes, test commands/results, no-secret config diff, deployment workflow IDs/artifact versions, pre/post smoke evidence, current flag posture and rollback identifiers per surface. Record 'not checked' where evidence is absent; don't infer live deployment from Git history or a finished build.

## Validation sequence

During development, run focused behavioral tests appropriate to each slice. Before a shared API/canonical release, run the repository's current typecheck, workspace tests, build, deployment-contract tests, required packaging checks, and relevant synthetic browser regressions from the exact candidate. Prefer current scripts over hardcoded stale test counts. Known root scripts include npm run check, npm run test, npm run build, npm run test:proof-deploy, npm run package:api-lambda, npm run package:proof-lambdas, and npm run test:browser. Run SAM/shell validation when their files change. Tests must use local/mock dependencies unless a separate live test is authorized.

Include new tenant-isolation, concurrent duplicate/retry/restart, persistence round-trip, bad schema/quantity/hash/file/URL, adapter-versioning, URL refresh versus revision, HMAC corruption/replay, durable event recovery, retry exhaustion, and disabled-feature behavior cases. Preserve the sent signing vector or explicitly version a changed one. Regression cases must prove old inputs/outputs retain behavior; new optional canonical fields must not become required for old jobs.

Inspect staged files for signed URLs, secrets, addresses, production payloads, real customer artwork, runtime stores, screenshots and generated archives. Do not commit the private handoff directory. Scope new credential/asset storage and IAM to the minimum reviewed surface; do not reuse partner webhook keys for inbound API auth.

## Deployment gate and sequencing

1. Prepare a concrete reviewed release candidate and plan; user deployment authorization is required for this new project. No production mutation is authorized by kickoff.
2. Re-fetch main and read-only verify actual current deployed versions/configs for API, Admin, Status and Proof. Inspect running release workflows. Capture each affected service's last known-good artifact and current config. Never print secrets.
3. Review the complete CloudFormation/config diff against live settings. Preserve scheduled Momentara intake/submission/reconciliation/writebacks, Proof gates and SES settings. Don't turn these off to simplify rollout; if an outage/hold is actually required, explain and coordinate separately. Don't let workflow defaults overwrite currently live parameters.
4. Merge only reviewed small changes through the agreed repo workflow. Revalidate the actual merged candidate. The release operator must verify the workflow resolves to that SHA; if main advances, reassess rather than silently shipping a different tree. Do not evade main-only workflow protections to deploy a stale branch/SHA.
5. Default deployment is API-only if no other surface changed. Deploy affected dependent clients only after compatible API health checks; deploy Proof/Status only when actually required and reviewed by their owner. No mass redeployment from this feature branch.
6. Keep new module disabled or test-only initially. Existing customer behaviors must remain unchanged. Controlled test activation for Silicon Pasture does not imply production Lift submission authority.
7. Perform scoped read-only post-deploy checks: health/auth, known Momentara jobs and reconciliation/writeback state, scheduler observation without manually firing it, existing Proof viewer and relevant Status pages. Never manufacture a live customer order/comment/email as a smoke test without explicit authority.
8. Confirm partner test receipt/deduplication/files/status/callback behavior through a sanctioned test route. Later approve live customer submission and any shipping events separately from code deployment. Record the actual outcome and any unverified behavior.

## Rollback and recovery

Have per-surface last known-good code/artifact AND configuration records. Prefer disabling only the new module/customer integration gate to contain a regression while preserving Momentara. Pause only new webhook delivery if needed; retain receipts/assets/outbox history. Redeploy only affected services from verified compatible artifacts using the release workflow. Do not restore old runtime settings from this handoff or delete/roll back shared DynamoDB/customer data. Additive schema must remain readable by previous code. If rollback could lose externally accepted receipts or approval evidence, stop and use an explicit recovery plan.

If callback delivery is uncertain, retry using stable event IDs per the new contract. If Lift submission or Wrike posting is uncertain, retain existing reconciliation/dedup safeguards; callback policy does not authorize blind retries of those external writes.

## Coordination notices

At kickoff: share scope, default-disabled posture, expected overlaps and owner task.
Before shared-file work: identify precise contract/files and proposed compatibility strategy.
Before release: candidate/merge SHA, intervening changes reviewed, gates/config diff, tests, affected deployments, current service baselines, smoke/rollback plan.
After release: workflow/artifact evidence, observed existing-customer behavior, test integration result, remaining limits and live flag posture.

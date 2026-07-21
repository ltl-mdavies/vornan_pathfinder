# Pathfinder Combined Release Coordination

Date: 2026-07-20

Working branch: `codex/vornan-proof-foundation`

Stable base at review start: `eaf12af` (`main`, `origin/main`)

Release scope: Pathfinder API, authenticated admin web, public status web, shared Order Rollup packages, and the isolated Vornan Proof foundation.

## Current release decision

Do not commit, push, merge, or deploy the shared worktree while either active Codex task is still changing it.

The next appropriate checkpoint is after all of the following are true:

1. The active Vornan Proof read-only hardening batch is complete.
2. The Proof task has classified its untracked QA and design artifacts as either intentional release files or local scratch.
3. Pathfinder and Proof have stopped editing the shared branch long enough to review one stable diff.
4. The complete combined validation matrix below passes from that exact stable tree.
5. The staged file list is reviewed for secrets, local data, generated output, screenshots, and unrelated artifacts.

This is a release-readiness slice, not a deployment authorization. A deploy should always use a committed SHA that has been pushed and reviewed.

The repository now has a non-deploying `Validate Pathfinder` workflow for pull requests and pushes to `main`. The production API, admin-web, and status-web workflows reject dispatches from any branch other than `main`, and each runs the full workspace tests before publishing.

## Branch workflow in plain language

The branch is the proposed release. A commit is a named, reproducible checkpoint on that branch. Pushing publishes that branch to GitHub but does not make it live. Merging moves the reviewed checkpoint into `main`. Deployment then publishes the selected `main` commit to AWS.

Use this sequence:

1. Finish the combined work on `codex/vornan-proof-foundation`.
2. Review and stage only intentional files.
3. Create one or more coherent commits on the feature branch.
4. Push the feature branch to `origin/codex/vornan-proof-foundation`.
5. Open and review a pull request from the feature branch into `main`.
6. Merge only after the combined checks pass.
7. Deploy the merged `main` SHA in the controlled order below.
8. Record the deployed SHA and smoke-test evidence in the build log and handoff.

Do not force-push, reset `main`, or deploy an uncommitted worktree. Do not merge another branch into this shared worktree while either task is active.

## Commit scope review

The release commit should normally include:

- application and shared-package source;
- focused tests and fixtures that contain no customer secrets;
- workspace manifests and the lockfile;
- reviewed GitHub Actions workflows and AWS infrastructure;
- deployment and validation scripts;
- durable architecture, build-log, handoff, and QA documentation.

The release commit must exclude:

- local JSON stores and customer/operator runtime data;
- `.env` files, credentials, tokens, raw headers, and secrets;
- generated `dist`, `outputs`, Lambda ZIP, and package directories;
- temporary logs and browser artifacts;
- local screenshots or comparison pages unless explicitly accepted as durable documentation;
- any file copied from or modifying the Adspace repository.

Artifact classification completed with the Proof task:

- `.codex-proof-qa/` is local screenshot/comparison scratch and is excluded by a narrow root-level ignore rule.
- `design-qa.md` depends on that machine-local evidence and is excluded by a narrow root-level ignore rule.
- `docs/VORNAN_PROOF_PATHFINDER_ARCHITECTURE_HANDOFF_2026-07-19.docx` is the sanitized authoritative architecture input and should be included in the reviewed checkpoint.

Unknown future artifacts still require review before staging; do not add an ignore rule merely to hide an unclassified file.

## Combined validation gate

Run from the repository root after both tasks stop editing:

```bash
npm run check
npm run test
npm run build
npm run test:proof-deploy
npm run package:api-lambda
npm run package:proof-lambdas
sam validate --template-file infra/aws/api-cloudformation.yaml --lint
sam validate --template-file infra/aws/proof-cloudformation.yaml --lint
bash -n scripts/deploy-api-lambda.sh
bash -n scripts/deploy-admin-web.sh
bash -n scripts/deploy-web-hosting.sh
bash -n scripts/deploy-proof-stack.sh
bash -n scripts/deploy-proof-web.sh
git diff --check
```

Then review:

```bash
git status --short
git diff --stat
git diff --name-status
git diff --cached --stat
git diff --cached --name-status
```

Before committing, inspect the staged diff for credential-like values, raw status tokens, customer data, generated archives, and accidental files. Confirm the Proof write-gate scan still reports every approval, revision, undo, public decision, and Lift-write capability as disabled.

## Controlled production rollout

There are four separately deployed surfaces. “Deploy the full app” means coordinating them; it should not mean running them simultaneously without checkpoints.

### 1. API

Deploy the merged `main` SHA with the `Deploy Pathfinder API` workflow.

Keep the existing production authentication, CORS, storage, secret, email, and Lift transport values. Keep Proof grant creation and Proof link email disabled. Do not use this rollout as authorization for a new Lift order submission.

Post-deploy checks:

- `GET https://api.pathfinder.vornan.co/health` succeeds and reports the expected production storage and authentication posture.
- An authenticated admin API request succeeds.
- An unauthenticated protected API request is rejected.
- A read-only confirmed-order lookup and Order Rollup snapshot work for a known test order.
- No raw token, secret, or Lift credential appears in the response or logs.
- Existing Lift submit transport remains in its explicitly approved current state; no submit is triggered by smoke testing.

Stop the rollout if API health, authentication, persistence, or read-only Lift lookup is incorrect.

### 2. Authenticated admin web

Deploy the same merged SHA with `Deploy Pathfinder Admin Web`, pointing at `https://api.pathfinder.vornan.co` and keeping Google authentication required.

Post-deploy checks:

- The desktop and mobile sign-in layouts render correctly.
- Google popup authentication returns to the app successfully.
- The viewport-fixed navigation and scrollable content layout remain correct.
- A known customer job opens and its shared Order Rollup renders header, lines, line steps, proofs, and shipment summary.
- Destructive import-method and target actions still require confirmation.

### 3. Public status web

Deploy the same merged SHA with `Deploy Pathfinder Status Web`, pointing at `https://api.pathfinder.vornan.co`.

Post-deploy checks:

- A controlled existing token renders the expected immutable snapshot.
- A legacy single-order token remains compatible.
- A multi-order token retains its selector and responsive layout.
- Public header, proof, destination, and package projections expose only customer-safe allowlisted fields.
- The request form retains neutral acceptance behavior and its ten-order limit.

Do not send a customer email as part of the smoke unless a separately approved controlled email test is planned.

### 4. Vornan Proof

Treat Vornan Proof as a separate protected rollout even though its packages are part of the same commit.

First deploy the isolated Proof workflow to its approved non-production environment with:

- `public_read_enabled=false`
- `read_only_qa_confirmed=false` for the initial dark deployment
- `production_public_read_approved=false`
- managed WAF enabled unless an approved shared ACL is configured
- a valid edge shared secret
- every Proof decision and Lift-write flag disabled

Run the workflow's dark read-only smoke and DNS-readiness checks. Only after isolated QA is complete should a production Proof stack be considered, still with public read disabled. Public DNS exposure, token exchange, grant creation, link email, and any customer decision capability require their own later approval gates.

The GitHub deploy role trust policy intentionally admits the protected `dev` environment subject for this dark rollout in addition to the `main` branch subject used by the existing production workflows. It does not admit a Proof `prod` environment subject. Extending that trust requires a separate reviewed change when a production Proof stack is explicitly approved.

## Rollback plan

Record the last known-good production SHA before deployment.

- API: dispatch the API workflow from the last known-good SHA so CloudFormation points the Lambda at that versioned artifact; re-run health and auth smoke tests.
- Admin/status web: dispatch the corresponding workflow from the last known-good SHA and invalidate CloudFront.
- Proof: first force public read and all write flags off, then redeploy the last known-good SHA. If the isolated stack is unhealthy, leave its public DNS uncut or remove the new alias through the approved DNS process.
- Data: do not roll back DynamoDB or Secrets Manager data automatically with application code. Stop and investigate any schema or persistence concern before making data changes.

## Release evidence to record

For the final handoff, record:

- feature-branch commit SHA;
- pull-request URL and merged `main` SHA;
- validation commands and results from the committed tree;
- each workflow run URL and deployed SHA;
- API, admin, status, and Proof smoke results;
- active Proof public/read/write gates;
- any surface intentionally deferred;
- last known-good rollback SHA.

## Immediate next action

Wait for the active Proof hardening task to finish and classify its artifacts. Then freeze the shared branch, rerun the full combined validation gate, review the exact staged file list together, and create the intentional feature-branch commit. Pushing the feature branch is appropriate at that point. Production deployment is appropriate only after review and merge to `main`.

## Release execution evidence — 2026-07-21

The checkpoint described above is complete.

- Combined release PR: #3; merged release SHA `5afbb69`.
- API deployment: GitHub Actions run `29786460634`; production health HTTP 200 with DynamoDB and Secrets Manager ready.
- Admin-web deployment: run `29786589756`; `https://pathfinder.vornan.co` HTTP 200.
- Status-web deployment: run `29786666131`; `https://status.vornan.co` HTTP 200.
- Proof dark deployment: run `29791214408` from merged SHA `f250f29`; stack `vornan-proof-dev` reached `CREATE_COMPLETE`, SPA publication succeeded, the dark smoke suite passed, and the DNS-readiness handoff completed.
- Independent Proof verification reconfirmed public reads off, decisions off, direct API bypass rejected, managed WAF on, and both QA and production-public-read approvals false.

No Proof DNS record was changed and no Proof customer capability was exposed. Production Proof trust, public reads, grant creation, link email, token exchange, customer decisions, and all Lift writes remain separately gated and out of this release.

The next release action is not another deployment. First perform isolated read-only QA against the dark `dev` stack, record the results, and request separate approval before any DNS or public-read change.

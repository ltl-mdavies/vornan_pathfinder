# Proof revised-art submission/recovery — October 29, 2026

Status: paused before push/merge/deployment. Additional selected-file recovery correction and exact UX review required. No production mutations performed.

## Approved scope

Marcus authorized coordinated completion and deployment of the interrupted Proof work. Pathfinder UX approved exact product source `115b539848b9b7c0f9e8b12ea441468ffb6ea98e` on October 29; both receipt-copy findings are closed. Integrated source `23dd46daab8bbb0c347680080a8cc3f6023f5b47` matches that product source exactly plus default-off release wiring `24520b6135c475b5a61ad9a80371c1e6bce813f1`. Documentation checkpoint `326f2c1` is included.

Deploy capability dark: `CustomerRevisionSubmissionEnabled=false`, `CustomerRevisionScope=""`. No live revised-art submission, customer launch, QA activation, emails, grant creation, or Lift mutation is included. Preserve existing effective allocation scope `1249:A0232139`, Demo access, private upload and approval settings. Successful transport, exact-file import, and subsequent proof approval are distinct outcomes; a new proof alone is not evidence of exact-file import.

## Intended targets and isolation

- AWS account `744016783602`, region `us-east-1`, stack `vornan-proof-dev`: expected resource change only `ProofPublicFunction` (code and two disabled/empty environment values). No IAM, integration, routing, tables, worker or operator changes expected. Inspect the actual change set and stop on any additional resource.
- Public function `vornan-proof-public-dev`: build reviewed public bundle; retain the current artifact's unrelated files byte-for-byte. Keep the shared worker artifact parameter unchanged.
- Proof frontend: generated `apps/proof/dist` only, bucket `vornan-pathfinder-proof-dev`, CloudFront `E381PLTIBZ9880`. Assets first, HTML last, no deletion of prior assets.
- Private durable release evidence/rollback: bucket `vornan-pathfinder-artifacts`, prefix `proof/releases/revised-art-<exact release revision>/`.
- Preserve `vornan-proof-sync-dev`, `vornan-proof-operator-dev`, `vornan-pathfinder-api-prod`, Admin bucket `vornan-pathfinder` and Status bucket `vornan-pathfinder-status`. Compare fresh function revisions/code/environment hashes and frontend index versions before/after deployment.

## Validation completed locally

- All workspace typechecks and builds passed.
- 1,467 workspace tests passed, including 96 Proof UI tests; 180 deployment contracts passed.
- Exact product-source comparison versus the UX-approved source shows only four deployment wiring/test files added.
- Timeout guards independently settle GET/POST without retries; interrupted submissions retain intent. Existing Advanced upload-only behavior remains unchanged. Submission authority is exact-scope and default-off, with read-only recovery possible after disabling writes while retaining a scope in a future authorized activation.

## Required execution gates

- Capture fresh deployed artifacts, stack template/parameters, function revisions and environment hashes, index versions. No secrets in public records.
- Build/package diff must change only `public-lambda.mjs` and its map within the existing public artifact. Review frontend manifest and actual upload dry run. Confirm environment fits Lambda's limit.
- Save versioned rollback artifacts and candidate manifests in private durable storage before executing.
- Validate template; use previous values for every existing parameter except the public artifact key; add revision flag false and scope empty. Inspect change set: only public function modification, no replacement.
- PR CI and current-main comparison must pass; recheck resource revisions/template/parameters immediately before execution. No duplicate deployments.
- Verify backend code/hash and effective environment preservation before frontend publication. Verify CDN hashes and unchanged unrelated resources afterward.
- Proof owner to run authenticated smoke of unchanged PDF controls/tooltips, thumbnails, quiet refresh, File History, allocation receipts and private upload entry. Confirm revised-art Submit is absent/disabled. No proof decisions, uploads or Lift writes in smoke.

## Recovery

Retain prior deployed template, public ZIP and frontend files privately with versions/hashes. While the revision feature remains disabled, restore the previous public artifact key and previous Proof entry HTML through reviewed, concurrency-checked operations if needed; keep existing allocation receipts/claims and current allocation/demo/upload gates unchanged. No data rollback or replay. After any future revised-art activation, do not revert to a receipt-incompatible backend; disable submission and preserve exact scope for read-only recovery instead.

## Remaining gates

Proof owner found that switching proofs loses a selected but unuploaded File. Release paused pending per-binding draft preservation and exact UX follow-up. Read-only live capture for `e90914c` confirmed unchanged production baselines, 1,484 environment bytes after disabled flags, and only two public-bundle files changed. That candidate/capture is superseded and must not be deployed; rebuild and recapture after the correction.

Follow-up product source `c3cbddc` is integrated locally (per-binding in-memory draft retention and content-sized receipt rows); 98 Proof UI tests and Proof typecheck pass. Independent review also identified that an already-running asset-status poll can complete after switching proof bindings and overwrite the new draft. Sent to Proof owner for a binding/active completion guard and delayed-response verification. Technical hold remains; no release execution.

Artifact/change-set/concurrency review, CI, deployment and authenticated smoke are pending. Any A0232139-only live revised-art QA requires a fresh line-3 preflight and separately coordinated activation; exact-file import confirmation requires authoritative evidence or manual Lift-side verification.

# Proof File history timestamp correction — October 29, 2026

Status: release preparation; not yet published.

## Scope and authority

Narrow continuation of Marcus's approved Proof completion/deployment work. Proof owner handed off source `2277bb14e27e4d014664b84fa11bb101d85d0694` and evidence/fixture commit `7b8ba38f7c1b420dad59532b070855538bfa6914`. Pathfinder UX granted exact-revision source and pending/approved visual approval October 29. Current-main integration changes only two Proof application files, their tests, a preview fixture and QA documentation. Revised-art candidate c45630a and its worktree are excluded.

Only show Approved in Lift when the selected history version has APPROVED status and an available timestamp. Retain upload date and explicit status for pending/rejected/unknown versions. No stored data or approval behavior changes.

## Targets and isolation

- Publish only generated `apps/proof/dist` to `vornan-pathfinder-proof-dev`; invalidate only Proof distribution `E381PLTIBZ9880`.
- Use the existing frontend publish sequence (assets first, HTML last), retain old hashed assets, and do not run the combined stack workflow for this frontend-only fix.
- No Lambda, IAM, API, stack, table, customer/grant/policy, intake or activation changes. Preserve exact allocation scope `1249:A0232139`; revised-art stays off.
- Preserve current Proof backend and durable allocation receipts/claims; this release cannot replay or modify them.

## Validation and deployment gates

- Complete workspace typecheck passed; all 87 Proof UI tests passed; production build passed.
- Frontend source matches approved 2277bb1 exactly. New main entry `index-jXDbd5xb.js`; CSS, icons, React/PDF/worker chunks unchanged from the current deployed build.
- PR CI/full regression must pass before merge/publication.
- Capture current frontend version and all runtime revisions/configuration hashes; verify no concurrent change before publishing.
- Inspect actual S3 dry-run and generated file allowlist. Stage current rollback web files and candidate hashes in private `vornan-pathfinder-artifacts` release prefix before publication.
- After publication, verify invalidation completion and all CDN file hashes, unchanged runtime/frontend baselines, and authenticated pending/approved File history through the existing QA session. No proof decisions, new grants or emails in smoke.

## Recovery

Restore the retained prior Proof entry HTML and its prior assets, then invalidate only Proof distribution. Keep current backend, allocation scope and durable receipts; no data rollback or replay. Previous assets remain available throughout.

## Remaining limitations

Native 200% zoom verification is deferred while the Mac is locked. Revised-art submission/recovery remains a separate unfinished release, not enabled by this correction. Broader customer activation remains off.

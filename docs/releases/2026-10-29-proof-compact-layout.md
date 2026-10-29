# Proof compact layout — October 29, 2026

Status: source prepared; coordinated production publication not yet executed.

## Scope and ownership

Source: `/private/tmp/pathfinder-proof-compact-release-20261029`, branch `codex/proof-compact-layout-release`, based on owner commit `539909e`. Integrate only the new compact-layout commit and, if missing, new-tab tooltip commits `e638cde` and `539909e`; do not merge the owner's unrelated branch history.

Pathfinder Development owns clean current-main integration and release. Marcus approved option 1 and subsequently said “Excellent! Please proceed.” Explicit publication clarification is requested before execution. No Lift actions or capability changes are authorized by this UI release.

Production changes: compact laptop headings; two-row creative/quantity dock; preserve visible feedback restrictions and 44px action targets; close filename tooltip on blur; lazy PDF worker module with static Vite asset import. Existing approval, allocation, authentication, refresh, and revised-art guards remain unchanged.

Excluded: local Share preview, mock link creation, demo fixtures, synthetic artwork, preview CSS and routes. Production source and artifact contain none of those additions. Real sharing remains separate.

## UX approval and validation

Pathfinder UX (`01a16a35-2fc7-7a62-8945-f6c7f25a1638`) approved the implemented option-1 local prototype on October 29: no P1/P2 issues, compact two-row dock and Share design approved. Exact evidence directory: `/Users/marcusdavies/.codex/visualizations/2026/08/10/019fed7e-564b-7141-992d-bf856a4ca509/allocation-qa-oct29/`.

Reviewed captures: `compact-final-1366x768.jpg`, `compact-final-1366x640.jpg`, `compact-final-1920x1080.jpg`, `compact-feedback-longfilename.jpg`, `compact-mobile-feed.jpg`. At 1366×768 the artwork region increased from observed ~172px to ~338px; dock decreased from ~217px to ~123px. Share in those captures is intentionally excluded from this production patch.

UX's minor tooltip-behind-dialog request was corrected using close-on-blur and verified in `compact-share-tooltip-dismissed.jpg` (open Share dialog, zero format tooltip nodes). Source review should confirm production changes match these reviewed layout rules.

- Narrow production worktree: 101 Proof tests pass; TypeScript/Vite production build passes; git diff --check passes.
- Full prototype: 103 tests/build pass; local staging, switching creatives, quantity save and Undo tested without Lift submissions.
- Fresh production build contains only expected existing branding/fonts, app chunks, PDF module and PDF worker. No new preview public files, `.env`, node_modules, mock sharing strings or sample proofs.
- Candidate production output: `index-Ch6zFghs.js`, `index-BRNuHuRA.css`, `pdf-worker-url-D8eRykn8.js`; rebuild on current main may change hashes.
- Full screen-reader and native 200% zoom audit are not claimed. Responsive desktop/mobile checks are recorded above.

## Intended resources and release gates

Workspace deployment requirements and UX governance read. Existing release records identify Proof SPA bucket `vornan-pathfinder-proof-dev`, Proof CloudFront distribution `E381PLTIBZ9880`, origin `proof.vornan.co`, and private rollback bucket `vornan-pathfinder-artifacts`. Release owner must freshly confirm exact targets before upload.

Development's October 29 read-only baseline: main `1e32d9162754dc01d17dc42a1e191a9b0840e730`; Proof index version `dG4yFKfQVqdSCIvX2i_cCMpcAgZiNMlX`; main `index-BH8ImXSS.js`, CSS `index-B4Btv7QO.css`; public Lambda revision `5b7505bb-f465-4e0a-9e0f-75dae39f0007`. Revised-art submission false; recovery scope `1249:A0232139`; upload QA window empty. Preserve all.

Before publication the release owner must record: current-main integration/CI, final artifact hashes, fresh target and concurrent-revision checks, exact S3 dry run, and private durable rollback prefix. Publish only Proof generated output: hashed assets first, HTML last, retain prior assets, invalidate only Proof distribution. Do not execute the combined backend/stack workflow.

No Lambda, API, IAM, CloudFormation, routing, CORS, database, Admin, Status, intake, credentials, grants, or capability changes.

## Recovery and post-deployment verification

Retain prior Proof HTML/assets in a private release-specific prefix before upload. Roll back only by restoring retained prior Proof HTML/assets and invalidating the Proof distribution; no backend/data rollback.

Verify deployed HTML and every candidate asset hash plus completed invalidation. Using existing authenticated QA access, verify real single/multi-creative proof loading, custom PDF canvas and worker, compact dock/44px buttons, filename/new-tab tooltip, feedback block, staged quantity guidance, and quiet refresh preserving selection/modal. Do not submit approval/revision actions, create grants, or change access during smoke. Confirm Share preview is absent and backend/capability baselines unchanged.

Record execution evidence here or in Development's corresponding release record. No publication success is claimed by this preparation note.

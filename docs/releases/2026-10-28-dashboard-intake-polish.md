# Dashboard Intake checks polish — October 28, 2026

## Scope and ownership

Marcus approved this refinement and deployment after reviewing the isolated local
preview. Development owns deployment; UX supplied the reviewed four-file patch
SHA256 `c12ca04bc9345999045d2770ecf16445e28bf013ee96d99d41d03e1383922370`.
Release base: `f5c408f94c6af0346244044993a609d5db4e025c`, including today's
32 MiB PDF / pre-job diagnostics hotfix. Clean integration clone:
`/private/tmp/pathfinder-dashboard-polish-release`.

Runtime changes are limited to Admin IntakeDiagnostics and its Dashboard CSS.
Show/Refresh move into the header, neutral empty/error states replace provider-
specific and developer copy, coverage remains available through keyboard-accessible
help, and empty pagination is omitted. Existing reads/filtering/recovery semantics
are retained. Test fixtures remain local only.

No API, Proof, Status, shared packages, workflow, intake settings, customer data,
mapping, authorization or provider action changes. Proof v1 `50d109f` is separate
and excluded: revised-art handoff and authorized live mutation QA remain outstanding.

## Pre-deployment evidence

- Canonical workspace AGENTS and DEPLOYMENT_REQUIREMENTS read.
- Exact target: account 744016783602, `s3://vornan-pathfinder/` built Admin files,
  CloudFront E34F508KID3LHW (`pathfinder.vornan.co`, admin S3 origin), `/*`
  invalidation. Assets first, HTML last, no deletion sync. No other target.
- Full typechecks pass. Regression tests: 1,415 passed / zero failed (API815,
  Proof76, Status17, Admin262, packages245). Initial sandboxed Supertest listener
  failures were resolved by rerunning with local binding allowed, not code edits.
- UX supplied desktop/mobile/loading/error/history/pagination evidence; Development
  independently reviewed 1366x768 and 390x844, help via keyboard, empty/history/
  unavailable, no global narrow overflow, and focused tests. These are synthetic
  UI checks, not live intake mutations or full accessibility certification.
- Clean npm ci, Node22.16.0, production Admin build: 37 files. Browser-public
  Firebase values match current live entry. Existing auth/API/build flags retained;
  operations/artwork pilot true, intake exceptions false. No preview fixtures,
  private keys, source maps, .env or dependency directories in public output.
- Existing large-bundle warning remains; no dependency update in this slice.
- Evidence/build manifest: `/private/tmp/dashboard-polish-release-evidence/`.
  Merged-main artifact and durable private S3 evidence prefix recorded at execution.
- Concurrency baseline: Admin index version `5Naes.i9AfNfrKnBHczUmU.l0e1ovLPY`,
  distribution ETag ETVPDKIKX0DER. API revision
  `5ca4c54a-fcbb-4f96-a862-bd59272feb79`; Proof public revision
  `6803b36e-69fa-4f5a-b007-86f858158a2f`; Proof index
  `RcX49LmmhntkyxGj2T4MmPtQpmGfzDBB`; Status index
  `3d_p4qRzSbwo_Wi5_kmv5.SIzdn36Swp`. Recheck before publishing.

## Rollback

All 37 live Admin files downloaded and SHA256-verified against the previously
reproduced production manifest. S3 object versions captured; bucket versioning
enabled. Durable copies of baseline/candidate/rollback are staged in the private
versioned `vornan-pathfinder-artifacts` bucket before publication.

Restore Admin index version `5Naes.i9AfNfrKnBHczUmU.l0e1ovLPY` to the same
`index.html` key with text/html and no-cache,no-store,must-revalidate; invalidate
only E34F508KID3LHW `/*`. Retained prior assets remain compatible with the unchanged
API. No migration or data rollback required.

## Execution gates and acceptance

Pending: exact PR/main CI, fresh main/live concurrency check, durable artifact
staging, Admin-only main workflow, all live artifact hashes/cache completion,
authenticated Dashboard open/all-history reads and existing navigation checks.
Verify protected API/Proof/Status revisions unchanged. No synthetic production
failure, Lift order, proof decision, grant/email, Wrike comment, or settings write
is part of release acceptance. Record resulting SHA/workflow and evidence on closure.

## Deployment result

- PR372 head `7f72b09152981617b3d09a22da6bdf41329f0aa8`; exact merged/main
  `344c2416cd87342d940b533f1c8eb0e9d6fb65ae`. PR validation40787475563,
  merged-main validation40787919853 and Admin deployment40788338960 all succeeded.
- Production build: 37 files; 33 unchanged, three new hashed App/CSS/entry chunks,
  changed index. All37 live CDN hashes match the exact merged-main build.
- Index version `E0JCVlkCfGUzdyK8jwp2V1Z8n7sGtJaa`, SHA256
  `17417bd3f131ceed91837a958f9871525bd3966c571b82993b62c261c2cee397`.
  Invalidation `IB1TOYNLIRBLSGRVTQNFO1AO3B` completed on E34F508KID3LHW.
- Private durable evidence/rollback/candidate prefix:
  `s3://vornan-pathfinder-artifacts/releases/dashboard-polish-7f72b09152981617b3d09a22da6bdf41329f0aa8/`.
  Merged-main manifest version `LxyrQ247nnX8h5W0kpLxky9vXA5glMRh`.
- Authenticated live reload passed; compact header and both Open issues / All
  recorded issues reads returned the correct neutral empty states. Keyboard help
  opened, including coverage limitations; default view restored. Recent orders
  C317112/A0234335 and C317113/A0234336 remain confirmed. Jobs navigation/read
  passed, and Dashboard reports scheduler healthy.
- Primary API revision, Proof public revision and both public Proof/Status index
  versions match the pre-deploy baseline exactly. No Proof/Status/API deployment,
  provider action, permission change or production data edit was performed.
- Existing GitHub action-runtime deprecation and large-bundle warnings remain;
  no dependency/workflow upgrades were bundled. No production error was induced
  to test the module; unavailable/history detail coverage is from isolated QA.

Proof v1 remains a separate incomplete candidate. Fresh owner review found final
approval-completion and reversal/reapproval claim issues; isolated fixes and
customer revised-art handoff work are in progress. Launch cohort and disposable
Lift mutation-test order require confirmation; A0233367 remains view-only scope.

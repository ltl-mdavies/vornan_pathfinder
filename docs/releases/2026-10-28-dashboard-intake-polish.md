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

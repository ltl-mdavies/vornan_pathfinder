# Pathfinder Admin release recheck

The Admin candidate is rebuilt with the accepted Manual Import recovery fix and unchanged production configuration. Release remains on hold for native 200% zoom and active public Proof/Order Status session checks. No runtime source changed during this recheck; no production objects, configuration, orders, comments, emails or mappings were written.

## Source and artifact

- Build source: `f50becaaf74581fb2e9c4e0c10446feb2802bb2f`; runtime and UX harness match independently accepted `d67dc12` exactly.
- Refreshed remote main: `819454b0dcf563e0f28ca29db2d238ab4d95f73d`; zero main-only commits, 24 candidate-only commits before this documentation update.
- No differences from main in API, public Proof, Order Status, shared packages, deployment workflows or the Admin deploy script.
- Production-configured artifact: `/private/tmp/pathfinder-admin-release-v2.mzk2c3/candidate`, 36 files, Node 22.16.0. The [new manifest](2026-10-24-admin-ux-candidate-v2.json) is `prepared_release_hold`; the original manifest stays invalidated.
- Index SHA-256: `bb757b571d1056b16630fd3c532de045c0a68db3bf0cfe2d3225a5a99fb48cd3`.
- New chunks: `assets/App-Dlri9Ysm.js`, `assets/index-DD7zGQuL.js`. Only those chunks and the index differ from the earlier candidate; CSS, fonts, branding and dependency assets are unchanged.
- Authentication stays required; API base, allowed domains, operations workspace and artwork pilot settings match production. Intake exceptions remain disabled in build configuration. All five browser-public Firebase fields match the deployed entry bundle; values are not included here.
- Build and artifact checks passed: no source maps, tested local simulator markers, private-key markers or AWS access-key patterns. Existing large-chunk warning remains.
- Three Admin deployment contract tests passed again. Runtime and harness remain unchanged from the recorded 1,374-test acceptance; that suite was not unnecessarily rerun for documentation/build-only work. `git diff --check` passed.

## Target and rollback revalidation

AWS account `744016783602`, Admin bucket `vornan-pathfinder`, dedicated distribution `E34F508KID3LHW`, distribution ETag `ETVPDKIKX0DER`, current index VersionId `aN1a4IxFtVxSF_wgpdfNNlHPKNtu3hfZ`, and latest successful workflow `40006379327` remain unchanged. Repository build flags also remain unchanged. No newer Admin run appeared in the latest-run check.

All 36 exact object versions in the rollback manifest remain available with matching ETags and lengths. S3 versioning is enabled; no lifecycle configuration exists. These checks establish retained-object availability, not a new full download/hash of each version. Prior full hashes remain recorded in the rollback manifest.

The refreshed S3 sync dry run proposes 35 non-index uploads only to the Admin bucket, with no deletion. HTML remains a separate final publication step. No upload command without `--dryrun` was run.

## Authenticated baseline checks

The original Chrome tab still timed out, but a new tab at the production Admin URL successfully reused the authorized Marcus Davies session. These observations are of the **currently deployed baseline**, not the unreleased candidate. They do not replace post-deployment smoke testing.

1. Dashboard loaded real recent orders and a partial cached Proof preview. Health details showed a recent Wrike cycle, with intake marked Needs review; Lift and JSON health were not monitored and notification coverage was unknown.
2. Jobs showed 164 loaded records across customers and intake methods. Filtering Silicone Pasture yielded one JSON API job; filtering LTL Demo yielded two Manual XLSX jobs. Audit also reported 164 persisted jobs. This is UI cross-checking, not an independent raw API reconciliation.
3. Momentara job `JOB-301606`, contract `C316939`, showed confirmed Lift order `A0234013`, one submit attempt, and explicit recovery-complete messaging for the earlier uncertain response. No submit, retry or Lift refresh action was invoked.
4. Proof loaded 12 awaiting-approval lines, two waiting-for-proof lines and 19 total cached lines in the loaded subset. Customer grouping worked. Cached dates were clearly labeled stale; Momentara's scoped Proof view did not expose LTL Demo rows.
5. Customer directory showed the three configured Pathfinder customers. Momentara overview showed 161 tracked/confirmed orders and 18 intake issues, distinct from zero confirmation/blocked issues. Those existing intake issues were not modified or treated as a new release regression.
6. Targets, Audit and Settings loaded. Settings showed SES status-link delivery configured; order-dropbox email verification remained unavailable behind its existing gate. No settings were saved. The captured browser log returned no warnings/errors during the checked navigation.

The current baseline still has the mixed customer/legacy sidebar that this release is intended to replace. Local candidate visual acceptance is recorded separately. The loaded customer records did not provide an unconfirmed job to inspect; none was created for testing.

Selected screenshots are under `output/playwright/release-oct24/`: `01-live-dashboard.jpg`, `02-live-reconciled-job.jpg`, and `04-live-proof-customer-group.jpg`. The local image `03-local-zoom-unverified.jpg` is explicitly **not** 200% zoom evidence.

## Remaining checks and release boundary

- Native Mac capture still fails. Automated browser zoom shortcuts produced no verified zoom change; viewport remained 2212 × 1220 with device-pixel ratio 2. Requested user-set Chrome menu zoom at 200% on the local 5210 review tab. Do not equate a smaller viewport or a Retina pixel ratio with browser zoom.
- Existing public Proof session resolved to the session-ended screen. Requested an existing working LTL Demo Proof link/session and Order Status link. No new grants/status links were created and no customer-facing actions were taken.
- Candidate production-authenticated data paths and post-deployment behavior remain to be checked. An authenticated old baseline plus isolated local tests is not acceptance of a deployed new candidate.
- All-role access, screen-reader speech, live configuration writes and live provider submission/reconciliation remain outside the established browser evidence.

Pathfinder Development retains deployment ownership. Do not publish while required checks remain open. Immediately before any approved main-only release, repeat source/live-version/concurrency checks and rebuild if source or configuration changes.

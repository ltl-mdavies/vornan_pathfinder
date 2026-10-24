# Pathfinder Admin release recheck

The Admin candidate is rebuilt with the accepted Manual Import recovery fix and unchanged production configuration. The supplied Order Status link passed the inspected no-shipment and creative-detail checks. An active LTL Demo public Proof session also passed the custom PDF controls and sampled refresh checks below. Candidate 200% checks are now complete; the user authorized proceeding with deployment. Populated shipment rows still lack live evidence and are an explicit limitation for the unchanged Status app, not a claim of coverage. No runtime source changed during this recheck. The explicitly scoped QA actions synchronized the A0233367 proof cache and created one internal view-only grant; no configuration, orders, comments, emails or mappings were written, and no proof decisions were made. Publication and post-deployment acceptance are recorded separately.

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

## Public Status smoke check

The user supplied a working existing Status link for `A0234013` / `C316939`. Its duplicated URL text was reduced to the single supplied URL; no new link was created. The bearer token is intentionally omitted from this record.

On October 24 at approximately 10:42 AM Eastern, the page first showed its cached order and explicit shipment-checking loader, then reached Live updates on with a fresh update time and a no-tracking empty state. This order has zero packages, so carrier names, delivered chips and populated tracking rows could not be exercised with it. No claim about shipment population speed is made from this check.

All three expanded lines displayed Creative, Proof created and Proof approved timestamps, title-case Ready to Print chips, and loaded thumbnails. The three lines happen to share October 23 at 3:16 PM in this order; this verifies rendered labels, not independent timestamp-source correctness. Branding, row expansion and the no-shipment state were visually intact. Captured browser warning/error logs were empty. Screenshot: `output/playwright/release-oct24/05-live-status-expanded.jpg`.

## Public Proof smoke check

In response to the request to create an internal LTL Demo QA link, the user supplied order `A0233367`. The existing Admin flow initially reported no synchronized cache. Sync Proofs then verified customer 1249 (LTL Demo), active order, one line, one pending proof, and zero warnings. One view-only grant was created with label `Internal release QA — view only — 2026-10-24`; it was not emailed. Its bearer URL is intentionally omitted here. The public review page confirmed both decision buttons disabled. No customer capability or API setting was changed.

The actual high-resolution PDF rendered through the custom floating PDF controls, not browser PDF controls. Zoom in changed the visible setting to 125%; the Zoom in tooltip was visibly present. The Fit menu exposed Fit page, Fit width and Actual size, and Fit page restored fitting. A manual Request latest proof details action displayed Checking for proof updates while the selected line and PDF viewer remained in the DOM; the subsequent screenshot retained the rendered artwork, and the completion snapshot retained the queue, viewer and disabled decisions. These are sampled observations, not a frame-by-frame assertion that no transient flicker can ever occur. Captured warning/error logs were empty.

Evidence: `output/playwright/release-oct24/06-live-proof-view-only.jpg`, `07-proof-zoom-tooltip.jpg`, and `08-proof-refresh-check.jpg`. The last screenshot was captured after the checking indicator had cleared; the checking-state DOM was observed separately. The view-only session was left open for the user. This verifies the deployed public Proof baseline, which is unchanged by the Admin candidate; it does not exercise approval or revised-artwork submission.

## Candidate 200% acceptance and final concurrency check

The user had zoomed the in-app local candidate, not the controlled Chrome tab. On October 24, the in-app tab at port 5210 measured 872 × 657 CSS pixels / device-pixel ratio 4, consistent with the user's explicit 200% confirmation. Ten screenshots under `output/playwright/release-oct24/zoom-200/` document Dashboard, Jobs, Proof, keyboard-reachable Proof actions, customer directory, customer overview, customer switch retaining Proof, Targets, Audit and Settings. Navigation and labels remained readable; wide tables used contained horizontal scrolling without widening the page. Proof grouping changed successfully; keyboard focus scrolled the Open Proof action into view. Customer switch from LTL Demo to Momentara retained the scoped Proof view. No browser warnings/errors were captured. This is zoom/reflow acceptance, not screen-reader or full accessibility certification.

Fresh remote main remained `819454b0dcf563e0f28ca29db2d238ab4d95f73d` with zero main-only commits. Current Admin index VersionId/ETag, distribution ETag/alias/origin, and successful workflow remained as recorded above. No queued/running Admin workflow appeared in the latest runs. Repository build variables remained unchanged. Pathfinder UX independently rechecked the reviewed runtime fingerprints and reported no concurrent source edits or new blocker, and confirmed it will not start a duplicate release. Development retains sole release ownership.

## Remaining checks and release boundary

- Candidate 200% acceptance is complete using the correct in-app tab; earlier Chrome observations are superseded for this gate.
- Public Proof access is now verified through the scoped view-only A0233367 session above; the earlier expired session is no longer a blocker.
- Candidate production-authenticated data paths and post-deployment behavior remain to be checked. An authenticated old baseline plus isolated local tests is not acceptance of a deployed new candidate.
- All-role access, screen-reader speech, live configuration writes and live provider submission/reconciliation remain outside the established browser evidence.

Pathfinder Development retains deployment ownership. Pre-deployment checks are complete for the Admin-only scope. Immediately before the approved main-only release, repeat source/live-version/concurrency checks and reproduce the artifact from merged main. Post-deployment authenticated verification remains mandatory; restore the compatible previous entrypoint if the release fails verification.

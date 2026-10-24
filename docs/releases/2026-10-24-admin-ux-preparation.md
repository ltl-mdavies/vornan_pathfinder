# Pathfinder Admin UX release preparation

Prepared October 24, 2026 for Pathfinder Development. **Pre-deployment checks are complete and the user authorized proceeding.** Manual Import recovery has independent acceptance and a refreshed production-configured artifact. Authenticated Admin baseline, candidate 200% zoom, and current public Proof/Status session checks are documented in the latest recheck record. Scope remains Admin-only; no provider decisions or configuration changes are authorized by this release. Publication and post-deployment acceptance must be recorded separately.

The [focused Manual Import fix](2026-10-24-manual-import-recovery.md) at `d67dc12` has independent local acceptance from Pathfinder UX. The original candidate manifest remains invalidated. Use the [refreshed candidate manifest](2026-10-24-admin-ux-candidate-v2.json). The [latest verification record](2026-10-24-admin-ux-release-recheck.md) distinguishes live baseline checks from local candidate acceptance and supersedes the historical pending-check statements below. Recheck live versions immediately before publication.

## Scope and ownership

- Source: `/private/tmp/pathfinder-ux-shell`, branch `codex/pathfinder-ux-shell`, implementation checkpoint `9d27f5d`.
- Fresh main: `819454b0dcf563e0f28ca29db2d238ab4d95f73d`; zero main-only commits and 19 candidate-only commits at preparation. Main is an ancestor of the candidate.
- Release owner: Pathfinder Development. Pathfinder UX confirmed its source freeze, accepted local behavior and no competing release.
- Runtime changes are confined to `apps/web`: shared navigation and layout, customer workflows, administration, catalog presentation, Proof queue presentation and submission recovery feedback. Tests and review documentation accompany them.
- There are no candidate differences from refreshed main in `apps/api`, `apps/proof`, `apps/status`, `packages`, deployment workflows or the Admin deployment script. No database migration is involved.

The workspace `AGENTS.md` and `docs/DEPLOYMENT_REQUIREMENTS.md` govern execution. Source preservation and tests reduce regression risk; they do not establish untested live provider behavior.

## Exact production targets

| Resource | Verified value |
| --- | --- |
| AWS account | `744016783602` |
| Admin URL | `https://pathfinder.vornan.co` |
| S3 destination | `s3://vornan-pathfinder/` |
| CloudFront distribution | `E34F508KID3LHW` |
| Distribution domain | `dgpk5x391g0c3.cloudfront.net` |
| Origin | `vornan-pathfinder.s3.us-east-1.amazonaws.com`, empty origin path |
| Distribution configuration ETag | `ETVPDKIKX0DER` |
| Current index version | `aN1a4IxFtVxSF_wgpdfNNlHPKNtu3hfZ` |
| Current index ETag | `9c87d34d4cae1198962ae9e9157542fe` |
| Current index SHA-256 | `18c104dc1542bac3fb24eaebdf6500b00e58cb77d67337e2cb30e105d85fa89b` |

The distribution is deployed, has only the Admin alias and origin, and has no additional cache behaviors or CloudFront Function associations. Its configuration was last modified July 17, 2026. Only the Admin bucket objects and this distribution's cache are release targets. Do not deploy API, public Proof, Order Status, routing, credentials or infrastructure.

The latest successful Admin workflow is [run 40006379327](https://github.com/ltl-mdavies/vornan_pathfinder/actions/runs/40006379327), from `4b2c01e6c11463ab5249532b3484207401730034`, completed October 23 at 18:51 UTC. The current index was written at 18:51:13 UTC. No Admin source commits separate that deployed revision from the refreshed main baseline.

## Production configuration

The candidate uses the current repository variables and deployment workflow defaults, not the broader local fixture configuration.

| Build setting | Preserved value |
| --- | --- |
| API base URL | `https://api.pathfinder.vornan.co` |
| Authentication required | `true` |
| Allowed email domains | `ltlco.com,vornan.co` |
| Operations workspace UI | `true` |
| Intake exceptions UI | `false` |
| Intake exceptions customer | Empty |
| Artwork Catalog internal pilot | `true` |

Both intake-exception repository variables are absent, so their workflow defaults remain disabled and empty. Local QA enabled that surface for isolated review; this release must not activate it in production. Existing server permissions and customer boundaries remain authoritative.

All five browser-public Firebase configuration fields were read from the deployed Admin bundle and used for the local candidate. The resulting bundle matches those fields exactly. Their values are deliberately omitted from this record. GitHub's corresponding secret names exist; deployment must continue using them, not replace them. Revalidate the built artifact against this configuration before publication.

## Original artifact and validation

The invalidated original production-equivalent build used Node `22.16.0`, npm `10.9.2`, and output directory `/private/tmp/pathfinder-admin-release-rOGVMn/candidate`. It contains 36 files. The [original candidate manifest](2026-10-24-admin-ux-candidate.json) records historical source and hashes; do not publish this artifact. The refreshed artifact is documented in the latest verification record above.

- New application chunks: `App-gIvWvxJI.js`, `App-DK8XhgTp.css`, `icons-CS9jSigk.js`, `index-5C8IxPri.js`.
- Candidate index SHA-256: `d0f350b5a17156da3d8921efbfea61fef43c072e0864591ede6e7c751efd3836`.
- All public brand files, fonts, icons and manifest are byte-identical to their current S3 objects. Shared-name React, Firebase, spreadsheet and PDF-rendering assets are also byte-identical. No same-name dependency drift was found.
- Output checks found no source maps, private-key markers, AWS access-key patterns, tested local QA endpoints or submission simulator markers. The Firebase browser API configuration is expected public frontend configuration, not a server credential.
- Full workspace typecheck passed again during release preparation.
- All five Admin and operations deployment contract tests passed.
- Accepted implementation regression suite: **1,366 passed** — API 800, public Proof 76, Order Status 17, Admin 233, packages 240. See [submission acceptance](../pathfinder-ux-submission-acceptance.md) for the frozen source and behavioral evidence. No runtime source changed during this preparation.
- The existing large-chunk warning remains; this build completed successfully.

The actual S3 sync dry run scheduled 35 non-index uploads exclusively under `vornan-pathfinder`; no deletion or other resource change was proposed. It also schedules byte-identical files because local build timestamps are newer. The index must be published separately and last. Dry run command:

```sh
aws s3 sync /private/tmp/pathfinder-admin-release-rOGVMn/candidate/ s3://vornan-pathfinder \
  --exclude index.html --cache-control public,max-age=31536000,immutable --dryrun
```

## Durable rollback

S3 versioning is enabled and no bucket lifecycle configuration is present. The [rollback manifest](2026-10-24-admin-ux-rollback.json) records 36 retrieved and hashed objects: the existing entrypoint, its discovered dependency graph and all current public files that the candidate would upload. Their exact prior versions remain in S3; temporary local downloads are verification copies, not the retention strategy. Versioning is not an immutable deployment lock: recheck availability and lifecycle settings before release, and retain these versions until the release is closed.

The rollback is compatible because this release changes only Admin assets and has no API or schema migration. Retain all old hashed chunks during publication. If smoke checks fail, stop additional publication and restore the recorded index, then invalidate only the Admin distribution. These recovery commands are documented, not executed:

```sh
release_restore_dir=$(mktemp -d /private/tmp/pathfinder-admin-rollback.XXXXXX)
aws s3api get-object --bucket vornan-pathfinder --key index.html \
  --version-id aN1a4IxFtVxSF_wgpdfNNlHPKNtu3hfZ "$release_restore_dir/index.html"
shasum -a 256 "$release_restore_dir/index.html"
# Stop unless the hash equals 18c104dc1542bac3fb24eaebdf6500b00e58cb77d67337e2cb30e105d85fa89b.
# Verify every referenced object against the rollback manifest before restoring the entrypoint.
aws s3 cp "$release_restore_dir/index.html" s3://vornan-pathfinder/index.html \
  --cache-control no-cache,no-store,must-revalidate --content-type text/html
aws cloudfront create-invalidation --distribution-id E34F508KID3LHW --paths '/*'
```

If an old dependency is missing or differs, retrieve its recorded version, verify its SHA-256 and restore that exact key with its recorded metadata before restoring the index. Do not delete newer chunks. Wait for invalidation completion and verify the restored authenticated app. This invalidation covers the dedicated Admin distribution, not other apps.

## Release sequence and concurrency gates

1. Obtain approval for pushing, merging and the Admin-only deployment. Keep UX source frozen; retain Pathfinder Development as the sole release owner.
2. Fetch main again and compare all overlapping changes. Integrate any newer work without reverting hotfixes. Repeat affected tests and rebuild if runtime source or configuration changes.
3. Push the reviewed branch, review and merge to main. The existing `deploy-admin-web.yml` permits production deployment only from main; do not bypass that guard.
4. Before dispatch and again before publication, compare the current index version, distribution ETag, repository variables and deployment run against this record. Stop and refresh the release plan if any changed. Check queued and running Admin workflows. The current workflow has **no concurrency group**; the documented single-owner gate is manual, not an automated lock.
5. Reproduce the artifact from merged main with the recorded configuration and review any hash or scope discrepancy before dispatch. Then run the main-only workflow with API base `https://api.pathfinder.vornan.co`. Preserve all current gates and secrets. It runs installation, typecheck and tests before building, uploads assets without deletion, publishes HTML last and invalidates only `E34F508KID3LHW`. The workflow does not pause between build and upload, so the pre-dispatch review must be complete.
6. Record the merged revision, workflow run, actual artifact hashes, resulting S3 index version and invalidation ID. Verify that the published artifact matches the reviewed build; an unexpected discrepancy requires investigation and rollback when necessary. Wait for CDN invalidation completion.
7. Complete the authenticated checks below. Do not describe an HTML load or an unauthenticated API response as data-path acceptance.

## Authenticated verification and remaining limits

The following checks are pending release execution:

- Sign in with an authorized account. Confirm no authentication bypass, unexpected permission changes or new customer access.
- Navigate Dashboard, Jobs, Proof, Customers, customer detail tabs, Targets, Audit and Settings. Confirm one shell, correct fonts, retained customer tab and working back navigation.
- Compare global job counts and customer-filtered records with authoritative API results. Inspect a confirmed and an unconfirmed job without submitting or retrying either.
- Check Proof grouping, customer scoping and an authorized Proof link. Confirm public Proof still has custom PDF controls and hover text, and does not clear the viewer during background refresh.
- Check an existing Order Status link for shipments, creative timestamps, concise status chips, carrier names and branding. Do not mint links or post comments as part of read-only smoke testing.
- Verify catalog pilot visibility and existing customer limits; confirm intake-exception controls remain disabled. Check read-only API responses and relevant browser/server errors.
- Recheck pending intake/reconciliation and notification health through existing read-only operational signals. Do not submit Lift orders, send Wrike comments, email customers, change mappings or alter provider settings for a smoke test.

Independent UX acceptance covers recorded desktop layouts and isolated browser behavior. Native 200% zoom, screen-reader speech, all real role/capability combinations, live configuration writes and live transport/reservation/reconciliation were not established by those fixtures. Nonzero historical snapshot comparison coverage is also limited. These limits remain explicit; no broader provider or accessibility certification is claimed.

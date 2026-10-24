# Internal Pathfinder login and startup release — October 24, 2026

## Scope and ownership

Marcus authorized deploying the accepted internal Google login and startup fixes
through the coordinated UX thread. Development is the sole release owner.
Source: /private/tmp/pathfinder-startup-followup, runtime 9f69433 plus startup
d6c37b1; acceptance documentation 91ff149. PR #366.

Customer portal designs are retained under docs/design/customer-portal-login;
they are not shipped in the public bundle and do not implement/enable customer
authentication, invitations, magic links, membership or new provider settings.

No API, public Proof, public Order Status, intake, Wrike worker, database,
deployment workflow, provider settings or allowlist changes. Auth provider
functions and session callback logic are unchanged, protected by a baseline test.
Other worktrees and their uncommitted work remain untouched.

## Pre-deployment evidence

- Read workspace AGENTS and docs/DEPLOYMENT_REQUIREMENTS in canonical
  /Users/marcusdavies/Projects/ltl-workspace. No repository-specific AGENTS exists
  in this isolated worktree.
- Exact AWS account: 744016783602. Static destination s3://vornan-pathfinder/.
  Dedicated CloudFront E34F508KID3LHW, alias pathfinder.vornan.co, S3 origin
  vornan-pathfinder.s3.us-east-1.amazonaws.com; invalidation /* only on that
  distribution. No shared API/auth infrastructure is modified.
- Fresh remote main: cc7c65279ca3c0ab5a2f3c3a57b069665cecc21a; no intervening
  main commits. Latest prior Admin workflow 40105269824 succeeded at that SHA.
- Distribution ETag ETVPDKIKX0DER and status Deployed. Index version
  wrxNUmXODry__uC2qYpIH2jD4CzODQmY; ETag 56b7c25c0c60790f6ed76c3f9b21d19b.
- Production flags match current repository settings: required internal auth,
  existing API origin, ltlco.com/vornan.co domains, operations UI and internal
  artwork pilot enabled, intake exceptions disabled. Five browser-public Firebase
  fields extracted from live bundle match the new build; values not logged.
- Clean artifact built with Node22.16.0 in
  /private/tmp/pathfinder-login-release.q5MRQL/candidate, 37 files.
  SHA-256 inventory in 2026-10-24-login-startup-artifact.json.
  No maps, customer design docs, local review controls, private-key/AWS-key
  markers or source-only preview files. Existing large-chunk warning remains.
- Actual S3 sync dry run: 36 non-index uploads to the single Admin bucket;
  no deletions. HTML published last by established main-only GitHub workflow.
- All workspace typechecks and Admin build pass. 1,392 tests pass: API800,
  Proof76, Status17, Admin259, packages240. Independent UX accepted auth states,
  keyboard/focus, responsive layouts, startup loading/reload/failure/retry and
  supported customer-return behavior. See project-root design-qa.md.
- GitHub full validation required before merge, including Proof browser tests,
  deployment contracts and packaging. Final target/main/concurrency check required
  immediately before dispatch.

## Durable rollback

All 36 previously published files hash-verified via live CDN and S3 object
versions recorded in 2026-10-24-login-startup-rollback.json. S3 versioning enabled;
no lifecycle expiry configured. Workflow retains previous hashed assets.
Rollback version is compatible with unchanged API/configuration.

To restore the former entrypoint, copy index.html's exact version
wrxNUmXODry__uC2qYpIH2jD4CzODQmY back to index.html in vornan-pathfinder,
preserving text/html and no-cache,no-store,must-revalidate, then invalidate /*
on E34F508KID3LHW and verify its SHA-256:
bb757b571d1056b16630fd3c532de045c0a68db3bf0cfe2d3225a5a99fb48cd3.
Retained hashed assets allow this without a backend rollback. No migrations.

## Execution and verification

Completed October 24 at approximately 1:11 PM Eastern:

- PR366 merged as 17f46dbf15b71900296d8fa0a50c3a8692f1741d after validation
  run40114354385 passed. The merged runtime exactly matches the accepted source.
- Main-only Admin workflow40114719486 succeeded (2m51s), including checks/tests.
  No other apps or infrastructure were deployed.
- CloudFront invalidation I7KGR2GREKPB1ZXTYH9QRBYZYT completed.
- Published index version xRCE6RjsgC2cZKgaKBRzg7MtRnhKkSEd; SHA-256
  25abd9757a9ca5f79d84113fec07ea1e3e1f4608c91b54d6eadfcfb0ea28e449.
- Complete published hashes, cache controls and S3 versions are recorded in
  2026-10-24-login-startup-published.json.

### Build comparison discrepancy resolved

The first naive local-vs-live hash comparison failed. CI omitted exactly the
leading 604-byte 2025 Google license comment in the Firebase chunk. Removing
only that comment from the local Firebase artifact produces an exact byte match
to CI's Firebase artifact. This changes its content-hashed filename and cascades
to the entry/App filenames and their references. All 37 files were subsequently
verified byte-for-byte against the reviewed artifact with only that specific
comment removal and three exact filename substitutions permitted. No executable
code, configuration or other content differences remain.

Local Node22.23.3/CI=true reproduction still kept the comment, so Node version
alone was not the cause. The precise toolchain condition for comment retention
is not established; it is not a runtime-behavior discrepancy. Raw published
hashes are retained rather than falsely claiming all preflight hashes matched.

### Authenticated verification

Chrome preserved the existing user session. Root reload showed the quiet
Vornan logo/Checking your session treatment, then a populated Dashboard.
Recent order rows matched the pre-release baseline. Jobs loaded 164 records
with Wrike, JSON API and Manual XLSX filters; the directory showed three
Pathfinder customers. Opening LTL Demo showed scoped customer loading and then
two confirmed Manual XLSX orders and its real workspace data.

Independent UX IAB verification also passed two authenticated root reloads into
populated Dashboard data, without legacy panels, stray directory actions or the
old login hero. IAB warning/error logs were empty. Chrome had only pre-deployment
extension listener messages timestamped 1:03 PM, not new application errors.

Local evidence: output/login-release/live-dashboard.jpg and
live-customer-workspace.jpg. Independent evidence: UX login-startup-review/
production-startup-reload.jpg and redacted production-verification.json.

Existing sessions were not signed out solely to create a login screenshot.
Signed-out appearance, busy/error/expiry/restricted/unconfigured states are
covered by the actual-component local preview, independent UX acceptance and
published-code equivalence. New live Google reauthentication was not performed.
No email, proof decision, customer settings, provider submission or API writes
were made as part of release verification. Public Proof/Status runtime unchanged.

Prior rollback version and hashed assets remain retained as described above.
GitHub emitted non-blocking action-runtime/ubuntu migration annotations; existing
bundle-size warnings remain. These are future maintenance, not release blockers.

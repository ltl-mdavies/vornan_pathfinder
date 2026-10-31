# Proof reviewer runtime preparation — held for approval

## Review update — 2026-10-31

Finalization check: fetched origin/main still equals the reviewed base below.
Read-only AWS comparison passed at 2026-10-31T15:28:13Z: stack status/timestamp,
original template, saved artifact parameters, and all three Lambda code hashes,
roles, timestamps and environment digests match the captured baseline. The held
change set remains CREATE_COMPLETE/AVAILABLE with the same five modifications.
Handoff/reviewer-sign-in flags remain off. This is a scoped baseline comparison,
not a comprehensive AWS resource drift scan. Evidence: final-live-drift.json in
the local release output directory. No deployment or activation was performed.
Final regression rerun: workspace typechecks pass, all 1,608 workspace tests pass
with zero failures/skips, and all 192 infrastructure/release tests pass. The first
sandboxed run could not bind Supertest HTTP listeners (listen EPERM); the rerun
with local network permission passed without runtime source changes. Only a
documentation trailing blank line was removed during final staging.

Fetched origin/main remains exactly 9e33ef8736202136dcca5d9d6ff946befbd749f8,
matching this candidate's base. UX confirmed no separately pending source patch;
preserve PR387 thumbnail reuse, stacked creative metadata cards, compact pending
Status notice and Proof's header-only access UI. Historical banner/acceptance
notes in design-qa.md are superseded by its top header-only acceptance section.
This is baseline preservation review, not new visual acceptance of every change.

Private, encrypted, versioned archive:
`s3://vornan-pathfinder-artifacts/proof/releases/runtime-prep-20261031-8cdb84052d77ce34/`.
Eight candidate/recovery records were uploaded with create-only writes and
SHA256 readback, followed by sanitized change-set review evidence. Exact live
public/operator/sync Lambda recovery ZIPs were downloaded and verified against
AWS CodeSha256. No environment secrets or business data were archived.
Source patch and per-file hashes are local in outputs/proof-runtime-review-20261031;
local browser/synthetic harnesses and apps/api/data are excluded. This is a dirty
candidate snapshot, not a merged release commit; source integration remains held.

Non-executed UPDATE change set `proof-runtime-review-8cdb84052d77ce34` reached
CREATE_COMPLETE / AVAILABLE. Five Modify entries, all Replacement=False:
ProofManagedWebAcl (rules), ProofPublicFunction (code and optional verifier env),
ProofWebResponseHeadersPolicy (CSP), plus dependency-only ProofPublicIntegration
(function ARN) and ProofWebDistribution (WAF ARN). No stores, IAM, worker code,
intake resources, deletions or replacements. All existing stack parameters use
UsePreviousValue except the explicit public artifact override and two new runtime
preparation parameters. No handoff or reviewer activation flag is introduced.

**Cloud validation cleared:** with user approval, official AWS CLI 2.39.3 was
signature-verified (Apple notarized AMZN Mobile LLC package) and extracted only
under `/private/tmp/proof-awscli.nz2uBt`. Existing CLI 2.27.49 was not replaced.
The new CLI's describe-events call returned two STACK_EVENT entries, zero
VALIDATION_ERROR entries and no remaining pagination token. Thus CloudFormation
reported no property-validation, resource-name-conflict or S3-emptiness findings.
This is pre-deployment validation, not proof of runtime behavior. Evidence was
saved as validation-events.json in the same private versioned release archive,
with SHA256 readback. Earlier archived pending notes are superseded by this record.
Change set is left unexecuted for review. Live stack remains UPDATE_COMPLETE with
unchanged LastUpdatedTime.
Final merged-source/artifact identity, integrated visual checks and approval are
still needed before execution; live-role verification follows approved deployment.

## Candidate changes (local only)

- Lambda build validates and packages the non-secret production external-account
  descriptor as `proof-reviewer-external-account.json`. Rejects QA providers,
  alternate endpoints, key-based credentials and extra descriptor fields.
- New `StatusReviewerRuntimePrepared` template parameter defaults to false.
  When explicitly true, **only ProofPublicFunction** receives FIREBASE_PROJECT_ID,
  GOOGLE_CLOUD_PROJECT and GOOGLE_APPLICATION_CREDENTIALS. The ADC path is
  `/var/task/proof-reviewer-external-account.json`.
- CloudFormation rule and deployment-script preflight require the reviewed
  `ltl-dashboard-site` Firebase configuration. No credential secrets are packaged.
- No new IAM policies, live trust changes, worker wiring, public endpoints,
  activation flags, grants, intake behavior or customer settings in this step.
- Preparing the runtime also prepares the already-reviewed Firebase CSP through
  the explicit project parameter. It does **not** activate sign-in or handoff.

## Verification completed

- Full workspace typechecks passed.
- Full workspace tests: 1,608 passed, zero failed/skipped.
- Infrastructure/release scripts: 192 passed, zero failed/skipped.
- Proof/Status frontend builds and Proof Lambda bundle build passed.
- Packaged production federation descriptor readback passed.
- CloudFormation lint: zero errors, one existing W1030 warning at line 194,
  Parameters/PathfinderCustomerWorkspacesTableArn/Default (optional empty ARN).
  Must supply the reviewed workspace ARN for the customer-enabled release.
- Three existing S3 guard rules passed: encryption, no public read, no public
  write. These are scoped compliance checks, not a complete security certification.
- Live read-only check: execution role still exactly matches provisioned Google
  trust. Existing environment 1,615 bytes; adding verifier configuration yields
  1,766 bytes, below the 4,096-byte limit. No live values/secrets logged.
- Live LastModified remains 2026-10-30T01:55:06.000+0000; both handoff and reviewer
  sign-in remain off. No deployment or activation performed.

Earlier isolated cloud acceptance proves the real browser-token-to-Firebase
verification chain; see proof-keyless-verifier-provisioning.md. It does not prove
production grant promotion, and no live reviewer account was disabled/revoked.

## Remaining approval/release gates

1. Finalize the release commit; independent integrated UX capture review is accepted. The
   rebuilt public bundle, map, package.json and external-account descriptor match
   the archived ZIP entries byte-for-byte; the source template matches the archived
   template. Both production frontend builds and git diff --check pass again.
   The final commit is recorded separately in release-commit.json to avoid a
   self-referential source hash; no merge or push is implied. Exclude local
   QA harnesses and apps/api/data/intake-diagnostics.json from release.
2. Before execution, recheck live stack/configuration drift against the captured
   parameters and independent public/operator/sync artifacts. Archive/readback and
   non-executed change-set validation are completed as documented above, not pending.
   The archive is versioned/create-only, not an Object Lock/WORM guarantee.
3. Obtain explicit deployment approval for runtime preparation with handoff and
   sign-in still off. After approved deployment verify exact live role federation,
   packaging, CSP and unchanged existing application flows.
4. Separately approve the tightly scoped LTL Demo activation manifest, including
   Pathfinder-side handoff wiring, server flags and frontend sign-in configuration.
   Complete real order/session/CSRF promotion acceptance without proof decisions
   before declaring the feature ready. Existing access rules must remain intact.

## Integrated local evidence — 2026-10-31

Fresh captures: `/private/tmp/proof-integrated-review-20261031/`, covering Status
at 1366/1920/390 widths and Proof view-only, popover, rejected-account and verified
states. All identities and artwork are synthetic. No decisions, emails or uploads
were performed. These captures are not real Firebase or production promotion proof.
Status collapse/re-expand kept thumbnail request counters unchanged (10/10/4/2);
the offscreen third creative loaded on entering the viewport, preserving lazy loading.
Status document width matched viewport width at 390, 1366 and 1920. Wrong-account
Proof remained view-only with zero Approve/Request changes buttons and feedback
inside the dismissible header popover. UX independently accepted the supplied set
after three resize-timing artifacts were recaptured. Use
proof-view-1366-corrected.png, proof-popover-1366-corrected.png and
proof-wrong-1920-corrected.png instead of the three corresponding originals.
Their pixel dimensions and DOM viewport measurements match 1366x768/1920x1080,
with DPR, visual scale and CSS zoom equal to 1. No release-blocking visual regression
was identified. Acceptance covers synthetic presentation, not authentication,
deployment or activation. Runtime source/artifacts were not changed by this check.
`outputs/proof-runtime-review-20261031/integrated-alignment.json` binds the final
source manifest to the verified runtime ZIP and 33 production frontend files.

## Rollback

Disable the new handoff/sign-in flags first if ever activated. Restore the captured
public Lambda artifact, frontend artifact, response headers and stack parameters
without replacing stores or touching operator/sync overrides. Runtime preparation
can be returned to false; this removes only its three optional environment keys.
Do not delete existing grants/history, Firebase users, or business records.

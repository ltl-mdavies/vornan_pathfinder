# Vornan Proof Asset Infrastructure

## Purpose

This foundation provides private AWS storage and a future delivery boundary for
files uploaded as part of Vornan Proof workflows. It is intentionally separate
from Wrike, SharePoint, Dropbox, order-grid evidence, and other external file
repositories.

The first release is infrastructure-only and fully dark. It does not provide an
upload API, signed URL, public resolver, service DNS record, Lift request, or
customer-visible capability.

## Initial resources

- A dedicated S3 bucket named inside the
  `vornan-pathfinder-proof-assets-*` boundary.
- Default AES-256 encryption, versioning, object lock support, bucket-owner
  enforced ownership, and all four S3 public-access blocks.
- CloudFront origin access control with permission to read objects only through
  the exact distribution.
- A viewer-request CloudFront Function that returns `404 Not Found` for every
  request until a separately reviewed resolver/signing layer replaces it.
- No Route 53 or Cloudflare record. The initial deployment uses only the
  generated CloudFront hostname for a fail-closed smoke test.

The issued certificate covering `go.vornan.co` may be attached later, but the
dark deployment preflight rejects both a certificate and alias today.

## Malware protection boundary

The stack defines an optional GuardDuty Malware Protection for S3 plan for the
Proof upload bucket. It is disabled by default and may be activated only in the
`dev` environment through a separately inspected CloudFormation change set.
The ordinary deployment script always passes
`ProofAssetMalwareProtectionEnabled=false` and cannot activate the plan.

When separately enabled, the plan:

- protects only the exact `orders/` prefix in the Proof upload bucket;
- enables the managed `GuardDutyMalwareScanStatus` result tag;
- uses a dedicated GuardDuty service role scoped to the exact Proof bucket and
  GuardDuty-managed EventBridge rule namespace;
- may enable S3-to-EventBridge notifications, create a GuardDuty-managed rule,
  and write the AWS validation object
  `malware-protection-resource-validation-object`; and
- does not grant access to the Wrike delivery bucket, KMS, object deletion,
  application credentials, upload APIs, publication, delivery, or Lift.

Creating the plan is operational activation: AWS service terms and scanning
charges apply. It must not be combined with scan-worker activation. After a
separate activation, require plan status `ACTIVE`, tagging `ENABLED`, the exact
`orders/` prefix and role, and account for the validation object. Any warning or
error status is a stop condition.

### Controlled benign scan evidence

The first object-scan proof uses only the repository's deterministic 676-byte
benign PDF. It is not customer artwork and does not use the authenticated upload
API. The QA harness is deliberately narrower than a general S3 utility:

- `npm run preflight:proof-asset-scan` requires account `744016783602`, the
  active dev plan, exact Proof bucket and `orders/` prefix, managed result
  tagging, the expected GuardDuty rule/target, and only the AWS validation
  object in the bucket;
- every Pathfinder Proof upload, operator-action, grant, email, and scan-worker
  gate must remain false, the worker has no event mapping, and its queue/DLQ
  must be empty;
- `npm run qa:proof-asset-scan` requires the exact confirmation phrase and a UTC
  expiry no more than four hours away, writes exactly one deterministic object
  with `AWS_MAX_ATTEMPTS=1`, AES-256, exact SHA-256 checksum, PDF content type,
  `proof-lifecycle=unfinalized`, and synthetic-only metadata;
- only the exact object version is polled. Success requires the managed
  `GuardDutyMalwareScanStatus=NO_THREATS_FOUND` tag. Threat, unsupported,
  access-denied, failed, unknown, or timeout results stop without re-upload or
  automatic retry;
- if S3 accepted the one write but its CLI response was lost, a repeat run
  performs read-only reconciliation of exactly one matching key/version,
  verifies its checksum/type/encryption/metadata/tags, and resumes polling
  without another `PutObject`; ambiguous or missing versions stop;
- the raw key/version exist only in a mode-`0600` manifest under `/tmp`; console
  evidence contains digests instead; and
- `npm run purge:proof-asset-scan` is a separate confirmed operation that
  revalidates the plan, gates, manifest, checksum, exact version, tags, and legal
  hold before deleting only that fixture version. It verifies no fixture version,
  delete marker, or multipart upload remains and never touches GuardDuty's
  validation object.

A reserved manifest with no S3 fixture can be removed only through the confirmed
purge command after a fresh preflight proves that no object version exists.

The seven-day unfinalized lifecycle is only a fallback for an interrupted QA
session. The normal successful path ends with the exact-version purge. Worker
activation, EICAR/malicious evidence, customer uploads, publication, delivery,
and Lift remain separate later approvals.

Example bounded commands (choose a fresh future expiry):

```bash
npm run preflight:proof-asset-scan

PATHFINDER_PROOF_SCAN_QA_CONFIRMATION="RUN ONE BENIGN PROOF ASSET SCAN" \
PATHFINDER_PROOF_SCAN_QA_EXPIRES_AT="2026-08-02T22:00:00Z" \
npm run qa:proof-asset-scan

PATHFINDER_PROOF_SCAN_QA_CONFIRMATION="PURGE ONE BENIGN PROOF ASSET SCAN" \
PATHFINDER_PROOF_SCAN_QA_EXPIRES_AT="2026-08-02T22:00:00Z" \
npm run purge:proof-asset-scan
```

### Bounded scan-worker activation review

The scan worker remains default-disabled. Before any one-object activation,
use the read-only four-mode evaluator to prove each transition without creating
or executing a change set, uploading an object, writing DynamoDB, retrieving a
credential, publishing an asset, or calling Lift.

The exact source-object key must already follow the server-owned Proof storage
contract. The activation expiry must be strict UTC, future, and no more than
four hours away. Console output contains only the key's SHA-256 digest, bounded
timestamps, booleans, and queue/resource counts; it never prints the raw key or
an object payload.

1. `preflight` requires the settled API and asset stacks, active GuardDuty plan,
   healthy inert worker, no Pathfinder scan rule or event-source mapping, empty
   worker queue/DLQ, and every Wrike, upload, operator, grant, email, and live
   customer-submit capability dark. Existing production Lift order-submit
   transport settings are verified but do not authorize a Lift call.
2. `review` reads one supplied change-set ARN and requires only four conditional
   Adds (exact EventBridge rule, queue policy, event-source mapping, and DLQ
   alarm) plus a non-replacing worker Lambda modification. Its parameters must
   contain the exact key and bounded expiry while every unrelated gate remains
   dark. The standard API deployment's `CAPABILITY_NAMED_IAM` acknowledgement
   is required, but no IAM resource change is allowed. Every included resource
   `AfterContext` must match the exact reviewed properties, and the worker's
   before/after contexts may differ only in its exact non-secret environment.
   Review does not execute the change set.
3. `active` requires the deployed Lambda environment, exact-key EventBridge
   pattern, single exact-queue target and source-account policy, single enabled
   mapping, future expiry, and empty starting queue/DLQ to match.
4. `closure` requires the worker gate false, key and expiry blank, conditional
   trigger resources absent, no mapping, and both queues empty.

Example read-only commands, using values from a separately approved activation
packet:

```bash
npm run preflight:proof-asset-scan-worker

PATHFINDER_PROOF_SCAN_WORKER_CHANGE_SET_ARN="arn:aws:cloudformation:us-east-1:744016783602:changeSet/REVIEWED_NAME/REVIEWED_ID" \
PATHFINDER_PROOF_SCAN_WORKER_ALLOWED_OBJECT_KEY="orders/A0000000/tasks/approved-task/revisions/prevision_<64-lowercase-hex>/source/passet_<64-lowercase-hex>/safe-file.pdf" \
PATHFINDER_PROOF_SCAN_WORKER_EXPIRES_AT="2026-08-02T22:00:00Z" \
npm run review:proof-asset-scan-worker

PATHFINDER_PROOF_SCAN_WORKER_ALLOWED_OBJECT_KEY="orders/A0000000/tasks/approved-task/revisions/prevision_<64-lowercase-hex>/source/passet_<64-lowercase-hex>/safe-file.pdf" \
PATHFINDER_PROOF_SCAN_WORKER_EXPIRES_AT="2026-08-02T22:00:00Z" \
npm run active:proof-asset-scan-worker

npm run closure:proof-asset-scan-worker
```

The example values are structural placeholders, not an activation packet. A
real activation still requires separate approval of the exact non-customer
evidence object, change set, and time window. The evaluator never authorizes or
performs the change. Worker evidence must be reconciled durably and the worker
returned dark before publication/resolver work begins. Customer uploads,
malicious-file tests, asset publication, revised-art delivery, and every Lift
action remain separate gates.

### Read-only post-scan evidence reconciliation

After one separately approved scan-worker activation has processed its exact
non-customer object, run the post-scan reconciler before closing the worker
window. It first reuses the full `active` evaluator, then performs only exact,
consistent reads of the approved ProofCore record, its six deterministic audit
milestones, and the approved S3 object version's metadata and tags. It also
derives the exact outbound publication key and requires that no object version
or delete marker exists at that key.

The caller must supply the same approved object key and expiry plus the exact
S3 version ID and SHA-256 observed during the controlled upload/finalization
session:

```bash
PATHFINDER_PROOF_SCAN_WORKER_ALLOWED_OBJECT_KEY="orders/A0000000/tasks/approved-task/revisions/prevision_<64-lowercase-hex>/source/passet_<64-lowercase-hex>/safe-file.pdf" \
PATHFINDER_PROOF_SCAN_WORKER_EXPIRES_AT="2026-08-02T22:00:00Z" \
PATHFINDER_PROOF_SCAN_EVIDENCE_OBJECT_VERSION_ID="exact-s3-version-id" \
PATHFINDER_PROOF_SCAN_EVIDENCE_SHA256="<64-lowercase-hex>" \
npm run reconcile:proof-asset-scan-worker
```

Success requires all of the following:

- worker rule, mapping, Lambda environment, gates, plan, and empty queues still
  match the exact bounded active contract before and after evidence collection;
- the exact order profile remains in LTL Demo customer `1249`, with the same
  current actionable task, attachment, and Proof version as the asset record;
- the durable asset is version 6 at `scan_pending`, cleared, and
  `no_threats_found`, with no publication or delivery fields populated;
- all six upload/verification/scan audit milestones exist exactly once and the
  three system scan milestones share one opaque correlation;
- the exact S3 version matches the durable checksum, content type, length,
  AES256 encryption metadata, immutable Proof identity metadata, GuardDuty
  `NO_THREATS_FOUND`, and `proof-lifecycle=retained-source`; and
- no outbound publication object version or delete marker exists.

Every S3 read is bound to AWS account `744016783602`, and an incomplete or
paginated outbound-version inventory fails closed rather than claiming absence.

Output contains only digests, bounded timestamps, booleans, and counts. It does
not print raw object keys, S3 version IDs, filenames, audit IDs, order/task/
attachment identifiers, or metadata. `scan_evidence_recomputed` remains false:
the raw EventBridge event ID is intentionally not retained, so this reconciler
proves mutual durable consistency but does not claim to reconstruct the
event-level evidence digest independently.

The reconciler performs no DynamoDB query/scan or write, object-body read,
Secrets Manager/log read, object write/delete, change-set execution,
publication, customer route, or Lift operation. Reconciliation success still
does not authorize publication. Close and verify the worker window separately
before starting any later capability.

## Storage layout contract

Future upload code must use the versioned contract in
`@pathfinder/proof-domain/proof-asset-lifecycle`. Internal object keys remain
private implementation details:

```text
orders/{order}/tasks/{task}/revisions/{revision}/source/{asset}/{safe_filename}
orders/{order}/tasks/{task}/revisions/{revision}/outbound/{publication}/{safe_filename}
orders/{order}/packets/{packet}/{safe_filename}
```

Future public delivery paths use opaque identifiers and must not expose the
internal order, task, customer, object key, or S3 version:

```text
https://go.vornan.co/a/{opaque_asset_locator}
https://go.vornan.co/p/{opaque_packet_locator}
https://go.vornan.co/f/{opaque_file_locator}
```

The alias is reserved for direct HTTP 200 asset delivery. It must not redirect
to S3, CloudFront object URLs, or other external repositories.

## Lifecycle policy

| Asset class | Initial policy |
| --- | --- |
| Incomplete multipart upload | Abort after 1 day |
| Unfinalized or quarantined upload | Delete after 7 days |
| Lift outbound publication copy | Delete after 14 days |
| Customer proof packet | Delete after 30 days |
| Retained source upload | Cleanup eligible after 60–90 days; initial maximum 90 days |

Retained source objects intentionally have no unconditional S3 expiration rule.
A future cleanup worker must calculate the immutable cleanup eligibility from
the later of order completion or last Proof activity, then refuse deletion while
the asset is referenced, on legal hold, or bound to a
`submission_uncertain`/`reconciling` action. Replays must never extend the
original cleanup date.

S3 lifecycle tags used by the future upload service are:

- `proof-lifecycle=unfinalized`
- `proof-lifecycle=quarantined`
- `proof-lifecycle=lift-outbound`
- `proof-lifecycle=proof-packet`

## Revised-art ordering

Revised artwork may become Lift-eligible only after the server has:

1. completed the source upload;
2. pinned the exact S3 key, version ID, checksum, order, task, attachment,
   Proof version, and revision;
3. completed content verification and marked the asset cleared;
4. created and verified the immutable outbound publication;
5. recorded a server-authored `lift_not_before` timestamp 1–2 seconds after
   publication readiness; and
6. revalidated the exact asset/publication binding immediately before the
   single supervised Lift request.

The Lift request must never be sent while an upload or outbound publication is
still pending. The delivery URL is resolved transiently by the server. Raw
signed URLs, query strings, credentials, JWTs, and creative content must not be
stored in the action ledger, audit events, logs, or API responses.

## Expansion gates

Each capability is a separate review and release:

1. dark bucket/CloudFront foundation;
2. default-dark GuardDuty plan and service-role definition;
3. dev-only GuardDuty plan activation;
4. bounded malware-scan evidence and separate scan-worker activation;
5. authenticated upload initiation/completion API;
6. opaque resolver and short-lived signed delivery;
7. `go.vornan.co` alias and DNS;
8. proof-packet assembly/download;
9. revised-art publication resolver;
10. bounded supervised Lift revised-art QA;
11. any customer-facing activation.

Importing files from Wrike, SharePoint, Dropbox, order grids, or other external
repositories is explicitly out of scope. It may be considered later as a
separate ingestion architecture.

## Deployment

Validate the dark posture:

```bash
PATHFINDER_PROOF_ASSET_ENVIRONMENT_NAME=dev npm run verify:proof-assets
```

After the infrastructure change is reviewed and merged, deploy it with:

```bash
PATHFINDER_PROOF_ASSET_ENVIRONMENT_NAME=dev npm run deploy:proof-assets
```

The deployment script forces the alias and certificate parameters empty, forces
malware protection false, and finishes by requiring an HTTP 404 from the
generated CloudFront hostname. A successful dark deployment does not authorize
GuardDuty activation, uploads, signing, DNS, customer access, or any Lift
action.

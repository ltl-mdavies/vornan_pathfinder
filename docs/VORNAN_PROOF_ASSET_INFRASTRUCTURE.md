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

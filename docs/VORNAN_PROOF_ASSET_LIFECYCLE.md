# Vornan Proof asset lifecycle

Status: extensible Phase 4 contract foundation. This document records product and
architecture decisions; it does not authorize AWS infrastructure, upload APIs,
deployment, credential use, or a Lift write.

Last updated: 2026-07-28.

## Purpose

Pathfinder Proof needs durable, private storage for files uploaded as part of the
proofing lifecycle. The first use is revised artwork supplied through Pathfinder.
The repository also supports an internal full-resolution order packet and a
client-downloadable proof packet while the order remains inside its retention
window.

This repository is **Proof uploads only**. It does not ingest files from Wrike,
SharePoint, Dropbox, order grids, customer file servers, or other external
repositories. Any future external-repository ingestion requires a separate
source-security design, capability gate, implementation review, and deployment
approval.

The `go.vornan.co` CloudFront distribution may also host a separately gated
`/d/*` behavior for Wrike order documents. That behavior uses its own physically
separate Wrike delivery bucket, permissions, lifecycle, and publication ledger.
It does not place Wrike, SharePoint, order-grid, or reference-proof files in the
Proof asset bucket and does not expand the Proof upload boundary described here.

## Recorded architecture decisions

1. Use a dedicated private, encrypted, versioned Proof asset bucket. Do not reuse
   the Wrike source-evidence bucket, admin/static-site buckets, or customer file
   repositories.
2. Browser uploads go directly to private object storage using bounded presigned
   upload operations. Large files must use resumable multipart upload; the
   application API does not proxy file bodies.
3. Internal object keys are grouped by Lift order, Proof task, and revision. Public
   paths remain opaque and do not expose order, customer, task, or revision IDs.
4. Source files and their verified metadata remain durable for the active Proof
   lifecycle. A separate short-lived outbound copy is supplied to Lift.
5. `go.vornan.co` is the approved public hostname for Proof asset delivery and
   packet sharing. This explicitly supersedes the older optional-locator-only
   direction. The Proof asset CloudFront behavior must return the file directly
   with HTTP 200; it must never redirect Lift to another host.
6. The 60–90 day policy applies to retained Proof source assets. Initial default
   and maximum retention is 90 days. Temporary outbound copies retain the shorter
   14-day lifecycle from the original architecture.
7. Retention expiry makes an asset eligible for cleanup; it is not permission to
   delete an asset involved in an uncertain/reconciling submission, active packet,
   incident investigation, or explicit legal/operational hold.
8. A revised-art Lift action can reference only an opaque server-owned Proof asset
   identity. Arbitrary client-supplied HTTPS URLs are insufficient.

## Object organization

S3 uses key prefixes rather than real directories. The required internal shape is:

```text
orders/{A########}/
  tasks/{task-id}/
    revisions/{revision-id}/
      source/{asset-id}/{safe-filename}
      outbound/{publication-id}/{safe-filename}
  packets/{packet-id}/
    manifest.json
    proof-packet.zip
```

The source record binds the immutable bucket key, object version ID, byte length,
MIME type, SHA-256 checksum, order, task, attachment, revision, and upload actor.
The outbound publication binds a new opaque publication ID to the exact verified
source version and checksum, plus its own immutable object key, version ID, and
matching checksum.

Public paths are deliberately different:

```text
https://go.vornan.co/a/{opaque-asset-token}
https://go.vornan.co/p/{opaque-packet-token}
https://go.vornan.co/f/{opaque-manifest-token}
```

`/a/` returns one file directly. `/p/` returns a generated proof packet. `/f/`
returns an authorized order-file manifest or download experience. Signed URLs and
cookies may add query parameters, but no public path contains the internal S3 key.

## Lifecycle and Lift readiness

The asset state model is:

```text
initialized
→ uploading
→ uploaded
→ verifying
→ scan_pending
→ ready_for_lift
→ submission_uncertain
→ reconciling
→ retained
→ deleted
```

`ready_for_lift` is server-authored and requires all of the following:

- upload completion was acknowledged by S3;
- the exact source object version, length, MIME type, checksum, ownership tags,
  and order/task/revision prefix were verified;
- malware/content scanning returned `no_threats_found`;
- a separate outbound copy was published from that immutable source version;
- the outbound object was verified again;
- its `go.vornan.co` URL returned a direct HTTP 200 with the expected content type
  and length and no redirect;
- `lift_not_before` was durably recorded as the delivery-verification time plus a
  configurable one-to-two-second settling delay;
- the asset is not cleanup-eligible unless an explicit hold keeps it active.

The delay is an additional delivery-settling buffer. It is not the upload
completion mechanism. Workers wait until the durable `lift_not_before` timestamp;
they do not rely on an in-process `sleep()`.

Only after this barrier may the action ledger atomically transition from
`prepared` to `submission_uncertain`, then send exactly one Lift request. Automatic
retry remains prohibited. An authoritative Lift GET follows immediately and any
unproven outcome remains reconciling/manual-review.

## Retention and cleanup

Initial policy:

| Asset class | Cleanup timing |
| --- | --- |
| Incomplete multipart upload | Abort after 24 hours |
| Upload never finalized | Eligible after 7 days |
| Threat/unsupported/failed scan quarantine | Eligible after 7 days, subject to security review |
| Lift outbound publication | Eligible after 14 days |
| Generated proof packet | Eligible after 30 days and may be regenerated |
| Retained source/revision assets | Configurable 60–90 days; default 90 |
| Audit and lifecycle metadata | Retained under the separate audit policy; no creative bytes or live URL |

The retained-source clock starts at the later of order completion or last Proof
activity. The server records that anchor no later than the current time; clients
cannot supply or move it. The prepared action binds the anchor, retention days, and
cleanup-eligibility timestamp. Replays do not extend retention. Cleanup removes source/outbound objects,
noncurrent versions, thumbnails, packets, and manifests when their respective
policy permits.

Cleanup must fail closed when:

- the asset is referenced by a `prepared`, `submission_uncertain`, or `reconciling`
  action;
- the order or packet is still active;
- a legal, security, support, or operational hold is present;
- object version/checksum identity does not match the lifecycle record;
- the cleanup worker cannot prove that all dependent links and publications have
  expired.

Deletion records the object/version identifiers, checksum, reason, and timestamp.
It never preserves a signed URL, credential, JWT, customer comment, or file bytes.

## Security boundary

- S3 Block Public Access remains enabled.
- CloudFront Origin Access Control is the only public read path.
- Upload, verification, publication, packet generation, and cleanup permissions
  are separated and prefix-scoped.
- Signed Lift delivery URLs are short-lived (initial target: 24 hours).
- Client/internal links are short-lived and reissuable while the asset remains
  retained.
- Accepted file types, maximum sizes, content sniffing, malware scanning, and
  thumbnail behavior remain configuration-backed and fail closed.
- ZIP may be generated as a client/internal proof packet but is never submitted to
  Lift as revised artwork.

## Configuration and future change

The following are policy inputs rather than hard-coded infrastructure assumptions:

- retained source days: integer 60–90, default 90;
- outbound copy days: initial 14;
- generated packet days: initial 30;
- signed Lift URL lifetime: initial 24 hours;
- settling delay: integer one or two seconds, default two;
- accepted MIME types and size limits;
- packet composition and whether it includes all or only current revisions;
- hold types and authorized release roles.

Any change updates this document, the pure domain contract, focused tests,
deployment-safety tests, and the corresponding infrastructure lifecycle rules in
the same reviewed checkpoint.

## Incremental implementation plan

1. **Contract and fail-closed guard** — pure asset states, key conventions,
   retention calculation, direct-delivery readiness, and opaque asset binding.
2. **Upload/finalization metadata contract** — the package-local
   `@pathfinder/proof-domain/proof-asset-upload` subpath now models initialized
   uploads, immutable completion metadata, verification/scan results, outbound
   publication, direct-delivery verification, packet membership, and
   monotonic server-authored retention activity. It has no package-root export,
   application caller, persistence adapter, AWS client, upload route, signer,
   resolver, or Lift transport.
3. **Private storage foundation** — bucket, encryption/versioning/public block,
   lifecycle rules, multipart controls, scan events, alarms, and least-privilege
   IAM.
4. **Upload/finalize API and UI** — initialization, browser multipart upload,
   finalize, progress/recovery, and operator inspection.
5. **Verification/publication** — checksum/content validation, malware result,
   immutable outbound copy, direct `go.vornan.co` verification, and durable settle
   barrier.
6. **Packets and sharing** — manifest, internal all-file download, client packet,
   short-lived authorization, and regeneration.
7. **Dark deployment and synthetic QA** — default-disabled infrastructure and
   lifecycle validation without a Lift write.
8. **Bounded Lift QA** — one exact approved LTL Demo order, attachment, asset,
   action, credential window, and zero-retry attempt.

## Open questions

- Whether the client packet includes every revision or only selected/current
  revisions by default.
- Which file types require asynchronous conversion before preview while retaining
  the original source.
- Operational ownership for malware findings, cleanup exceptions, and hold release.
- Whether internal art-team sharing uses the same packet or a separate
  source-complete packet.

These questions do not weaken the current boundary: no arbitrary URL can be sent
as revised art, and no external repository is an upload source.

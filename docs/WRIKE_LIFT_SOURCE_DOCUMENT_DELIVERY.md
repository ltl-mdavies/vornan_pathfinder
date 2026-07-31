# Wrike Source Documents in Lift `create_order`

Status: **local default-dark publisher foundation; deployment and live submission remain gated**

## Decision

One qualified Wrike Placard Order may contribute three distinct order-level URL values to one Canonical Order:

| Source | Canonical field | Purpose |
| --- | --- | --- |
| Selected order-grid workbook | `order.order_attachment` | The exact workbook used to build the order. |
| Wrike `LTL Artwork Folder URL` custom field | `order.artwork_folder_url` | Momentara's folder containing print-ready artwork. |
| Optional selected Wrike proof PDF | `order.reference_proof_url` | A small campaign reference proof, not a Pathfinder approval proof. |

All three values are rendered into the original Lift `create_order` body. Their outgoing property names are controlled by the selected Lift Output Template, so Lift-specific mapping changes do not change Wrike source setup or the canonical model.

The preferred artwork-folder path is the one-call `create_order` field. `FLEX_FIELD9` is retained only as the proven destination for a future, separately gated post-create order-header update. It is not emitted by the preferred create-order mapping, and no automatic fallback is active.

## Source selection

- Every matching current workbook remains a separate order candidate.
- Reference-proof capture is default inactive.
- When activated, zero matching PDFs is allowed, exactly one is retained, and more than one blocks for operator review.
- Matching uses the stable attachment/version identity and a configurable filename substring; it never chooses an arbitrary newest PDF among multiple matches.
- The Wrike artwork-folder field must be a valid HTTPS URL without embedded credentials.

## Evidence and delivery boundaries

Wrike's temporary download URL is never used in the Lift payload. Pathfinder downloads the selected bytes with redirects disabled, validates size and content type, and stores immutable evidence keyed by Wrike account/task/attachment/version identity.

The local delivery publisher now:

1. creates an immutable outbound copy in a dedicated Wrike delivery bucket, never the Proof-upload bucket;
2. publishes an opaque `go.vornan.co/d/...` URL;
3. replace characters outside the portable filename set `A-Z`, `a-z`, `0-9`, `.`, `_`, and `-` with underscores;
4. prove a direct HTTP 200 with no redirect, the sanitized filename and expected byte length before order submission;
5. conditionally creates the object and validates its exact S3 version, checksum metadata, filename and byte length;
6. persists the immutable publication manifest under the retained private Wrike source-evidence boundary, never beside the expiring public copy;
7. preserves the retained source evidence separately from the shorter-lived outbound copy.

The outbound copy expires after exactly 14 days because Lift downloads it immediately. The retained manifest prevents a replay from silently reviving an expired URL or extending its retention clock. Broader source-evidence retention and cleanup remain a separate policy decision.

The shared `go.vornan.co` CloudFront edge uses separate origins and path namespaces:

- Proof assets remain in the Proof-only bucket under their approved paths.
- Wrike documents use `/d/...` and a physically separate `wrike-lift-delivery-only` bucket.
- The `/d/*` viewer-request function and API publication gate both default to false/404.
- No route can publish while either boundary remains dark.

## Create-order and fallback policy

Preferred:

```text
Wrike task + workbook + optional proof PDF
→ Canonical Order
→ configured Lift Output Template fields
→ one create_order request
```

Fallback, default off and not implemented by this foundation:

```text
created Lift order
→ explicitly enabled order-header update policy
→ FLEX_FIELD9
```

The fallback must be an Output Route capability, not hidden Wrike-specific submit code. A future implementation must require an explicit toggle, durable create-order success, exact Lift order identity, idempotent update intent, authoritative readback, and a distinct audit record. It must never run merely because the create-order response omitted an unverified attachment field.

## Fail-closed conditions

- More than one matching reference PDF.
- Unsafe, redirected, missing, oversized or invalid source document.
- A delivery URL whose filename does not exactly match the deterministic sanitized source filename.
- Missing or mismatched immutable attachment/version/checksum binding.
- Missing delivery publication or failed direct-200 preflight.
- Duplicate outgoing field names or unsafe Output Template field names.
- Lift submit uncertainty. Pathfinder must not automatically replay `create_order` or invoke the update fallback.

## Confirmed Lift handoff contract

- Pathfinder owns the generic create-order property names. Jason/Lift can map those properties to target-specific Lift order fields without changing the canonical model or Wrike configuration.
- One order-grid URL and one reference-proof PDF URL are accepted as separate scalar fields. Pathfinder does not send an array or comma-separated attachment list.
- Lift does not require a MIME-type contract for these fields. Pathfinder still validates source files internally, sanitizes delivery filenames and verifies direct delivery before submission.
- The current Lift read API cannot prove attachment ingestion, so the initial QA must include a manual Lift-order inspection and record the observed result.

## Activation sequence

1. Merge the local contracts, publisher and infrastructure with all new gates dark.
2. Review and deploy the separate Wrike bucket/origin while `/d/*` and API publication remain disabled.
3. Run a bounded non-submit capture and verify immutable workbook/PDF evidence.
4. Publish approved synthetic or demo documents and verify direct HTTP 200/no redirect.
5. Inspect the exact rendered Lift JSON before submission.
6. Obtain a separate approval for one exact LTL Demo `create_order` call.
7. Manually verify the workbook, reference proof and artwork-folder result in Lift.
8. Keep the update fallback off unless the preferred mapping is proven insufficient and a separate fallback slice is approved.

This document does not authorize a live Wrike capture, object publication, DNS or CloudFront mutation, Lift submission, order-header update, or Proof capability.

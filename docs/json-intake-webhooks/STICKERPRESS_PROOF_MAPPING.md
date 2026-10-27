# Sticker Press Approved/Pending mapping

**October 27 update:** Marcus confirmed Andy approves before intake and Approved triggers Jason’s Lift bypass rule. New scoped preparation now projects Approved to string ID `5217817` and Pending to `5217816` in `lines[].approval.proof_status`, using the supplied ecomm_product_status.csv. Eligibility checks below remain unchanged. New jobs record an approval mapping version in their configuration hash; existing jobs remain untouched. The prior requirement to define a local proof-exception workflow is superseded for the approved-only pilot: incomplete/conflicting approval is held for partner correction. See [current pilot checklist](PILOT_READINESS_2026-10-27.md). The historical text below describes the earlier label-based implementation.

Andy confirmed that `approved_by: "auto"` means his artwork quality gate passed and the file is approved for production. Jason confirmed Lift's exact labels are `Approved` and `Pending`, with strings mapped to LOV IDs by the import interface. No numeric IDs are guessed.

The customer-specific receipt-to-order preparation maps `lines[].proof_status` upstream to the reusable Ecomm output's `lines[].approval.proof_status`:

- `Approved`: `auto`, valid approval timestamp no later than preparation time, and matching approval/declared/retained production PDF checksum and byte count. Exactly one retained original with a storage reference is required.
- `Pending`: missing, unrecognized or incomplete evidence, a non-auto actor, invalid/future timestamp, unverified/changed artwork, or an existing internal Pending decision. A timestamp by itself is not permission to skip proofing.
- Existing `Approved` is recomputed; it cannot replace verified evidence. Existing internal `Pending` is preserved. Lines are evaluated independently.

Scope is the existing strict Silicone Pasture 174094 / stickerpress-sandbox / test / Ecomm route and product binding. Neither the reusable Ecomm template nor High End Work is changed. The source receipt is cloned, not rewritten. No confirmed or uncertain job is regenerated, resubmitted or modified; A0233832 remains historical.

## Availability and boundaries

The implementation is used by `mapStickerPressReceiptToCanonical`, configured previews, and the existing operator `prepareReceiptSubmissionJob` path. The durable-job operator script preserves existing jobs on replay. These preparation functions are not mounted in the API or webhook workers, so this source change requires no shared API, Admin, Proof, Status, or worker deployment. Future operator preparation must use the merged source version. It does not retroactively set proof status on A0233832.

The live v1 intake contract is unchanged: missing approval blocks are still rejected there, and `proof_required` is not yet an accepted field. Pending fallback in this resolver does not broaden intake acceptance or bypass existing artwork mismatch validation. Jason's null-to-Pending use case needs a separately coordinated adapter/asset-path change if Andy needs to submit unapproved artwork. Until then, valid `operator`/`customer` evidence maps conservatively to Pending because Andy confirmed only `auto` for skipping.

Andy has not confirmed the exception contract yet. A future explicit per-line proof-required field must take precedence, be included in the business fingerprint, and follow revision/conflict rules for accepted orders. Do not instruct Andy to send that field yet. For this test, verify Jason's string-to-LOV mapping before submitting any new payload.

## Shipping inspection, October 23

Read-only inspection of A0233832 and its original receipt verified all three line bindings (100 units each). Lift returned `Pending Art Approval` at inspection time. PackageDetails returned HTTP 200 with `rowset: null`; ShippingReport timed out twice, including one bounded retry. These results are inconclusive, not evidence that no shipment exists.

No shipment quantities, carrier/service or tracking could be verified. The receipt and Pathfinder job were unchanged by the reads. The separate sandbox callback worker retained its existing artifact and guard against shipping evidence; no shipping data was added to the receipt, and no callback was sent or enabled.

Next: obtain Jason's saved shipment confirmation, tracking and line quantities, then reread complete scoped reports. If the shipment is saved but these reports still omit it, resolve Lift report exposure before any callback activation. Do not fabricate a shipment from label creation or treat `Waiting for pickup` alone as proof of line-level dispatch.

## Validation

Focused tests cover exact labels, missing/invalid approvals, timestamps, changed and ambiguous retained files, internal Pending precedence, per-line mixed output, source/config immutability, existing job replay, transport remaining disabled, and the existing artwork-publication and strict route-isolation tests. API typecheck passes. Full PR CI must pass before merge.

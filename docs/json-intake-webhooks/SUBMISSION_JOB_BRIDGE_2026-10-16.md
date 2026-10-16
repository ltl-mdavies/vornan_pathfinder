# Sticker Press receipt-to-job preparation — October 16, 2026

Marcus authorized connecting Andy's sandbox order to the normal submission process while preserving High End Work. This slice creates a normal persisted Pathfinder job for review; it does not activate transport or submit an order to Lift.

## Result

- Source order: `SPM-D2611133`.
- Receipt: `rcpt_1b05a005e1fe64e71a8515dace68753d77c96d727f414d3e07145fb5b767567f`.
- Job: `job_json_c056759e4523d5ef9debdddcf67d708237355112413823ca00d89635c19707d0`.
- UI label: **JOB-197070**.
- Pathfinder order: `PFC056759E4523D5EF9DEBDDDC`.
- Customer: Silicone Pasture / `174094`.
- Route: `route-ltl-lift-91-ecomm-orders`.
- State: **Waiting**; zero submit attempts; no Lift association.
- Three lines mapped to product `374549`. All three retained production PDFs were read from the scoped sandbox bucket and checked against source approval hashes and byte counts before persistence.

The job is visible in Silicone Pasture's Recent Jobs and normal job detail view. Generic job detail headings currently use legacy Wrike wording; this job has no Wrike source evidence, scheduled intake, task linkage or writeback. The actual import-method label is **Sticker Press sandbox JSON**. This is an explicit operator bridge, not a registered scheduled import method or automatic processing of future receipts.

## Reusable template versus customer mapping

**Lift Ecomm Orders** remains a reusable target template. Its body has no fixed Andy customer/product values. The customer-specific Output Product Map owns `STICKERPRESS_STICKER` → product `374549`, and the Ecomm customer route selects the shared template and Lift/91 connection. `mapStickerPressReceiptToCanonical` applies that saved single-product binding to every receipt line while preserving source SKU, description, dimensions, materials, cut evidence and approval hashes.

`scripts/prepare-stickerpress-submission.ts` is restricted to the approved receipt above. Without arguments it reads current configuration and prepares a private transaction plan. `--apply` atomically inserts a job and reserves its Pathfinder order ID, while adding a **disabled** `sandbox-stickerpress-174094` profile to only the Ecomm route. The test profile retains customer 174094; it does not redirect Andy's order to LTL Demo.

The transaction conditions the receipt pointer, target/template record, route record, product record, and absence of the job/order ID. The deterministic job ID is derived from receipt identity. A second `--apply` was run and returned `replayed: true`, the same job and the same Waiting state without writing another job. Existing confirmed or uncertain jobs are returned intact, never reset for retry. Uncertain transaction outcomes require re-reading the deterministic job, not creating a different identity.

## Preserved behavior and validation

No shared API/UI/Lambda deployment, scheduler activation, receipt mutation, callback, or Lift request occurred. Existing target/template records and both High End Work customer routes were compared after persistence and remained identical. The only existing record updated was the new Ecomm route, to add its disabled test profile and timestamp. Existing profiles and settings on that route were preserved.

Tests: API TypeScript check passed; 11 focused tests covering the bridge, configuration isolation and existing submit-integrity/document behavior passed. Final replay-isolation assertions were tested again. The live replay check returned the original job. Current main was fetched before work.

Private plan, before snapshots, receipt, saved job and result/replay evidence are under ignored `outputs/stickerpress-submission-2026-10-16/`. Do not commit those artifacts.

## Remaining before Lift submission

The job intentionally has no artwork delivery URLs or reviewed-submit fingerprint. It has a persistent `JSON-ARTWORK-PUBLICATION-PENDING` failure, Waiting state, disabled test profile, Draft route and Draft template. Normal certification cannot clear those requirements merely by refreshing the job. There is no bypass of the reviewed payload, idempotency or uncertain-outcome controls.

Next work is to publish the retained originals through the reviewed delivery mechanism, bind and recheck delivery against these approved hashes at submit time, prepare the exact request through the normal certification/integrity path, and activate only the Ecomm test route/profile for the controlled import. Do not treat the local preparation helper as a completed live artwork preflight. Receipt-to-confirmation ledger linkage and authoritative confirmation/shipping callbacks must be completed using the actual resulting Lift association.

To reverse this preparation, keep the Ecomm route/profile disabled and archive this specific unused job through the normal recovery flow. Preserve its reserved order ID, receipt identity and audit evidence. Do not delete or reset a job with any submitted/uncertain/confirmed attempt, and do not roll back High End Work or the shared target.

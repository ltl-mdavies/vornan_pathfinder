# Lift shipping collector — local slice, 2026-09-29

`lift-shipping-collector.ts` provides explicitly enabled, test-scoped GET collection from the three inspected Lift report endpoints. It is not mounted in the server or a scheduler. Credentials are injected, sent only in headers, and excluded from returned evidence and error messages. Redirects are refused; URLs and parameter names are fixed in code. Every returned row must belong to the confirmed order.

## Completeness and freshness

Each report needs an explicit pagination policy. Offset mode requires boolean completion metadata, consistent counts/offsets where supplied, full intermediate pages, and no repeated pages. A single-response policy requires an external review reference establishing that the endpoint returns the entire scoped report. Missing pagination metadata alone does not establish that policy. No live policy has been configured or verified by this slice.

Limits are 20 pages, 5,000 rows and 5 MiB cumulatively per report. HTTP requests share a 30-second abort deadline; returned collections must also pass an elapsed-time check. Credential providers must supply their own bounded lookup. Failed collection returns no partial report set. The caller must route collection failures through source-hold handling before allowing pending events to send; a standalone failed collection does not mutate receipts.

The returned evidence includes receipt/order/confirmation bindings, start/end times, pagination policy and a digest. Raw reports may contain private information and must remain in controlled storage, never logs or partner callbacks. The digest detects changes; it is not an authorization token.

`captureCollectedLiftShipping` connects the collected reports to the existing adapter and receipt capture. It checks evidence integrity, association and a 60-second age limit on both capture reads, then loads trusted package review and the durable reconciliation revision. It does not invent revisions or interpret a label as dispatch. Stale or changed collected evidence produces a source-unverified hold. This capture-time check does not provide ongoing source freshness at callback-send time.

## Prepaid attachment publisher assessment

The existing `wrike-lift-document-publication.ts` is tied to Wrike source evidence, document roles and manifests. Its checksum verification, immutable publication records and controlled delivery URL pattern are useful precedents. Passing prepaid labels through it unchanged would bind them to the wrong source contract.

The subsequent [prepaid delivery slice](PREPAID_LABEL_DELIVERY.md) reuses Momentara's `order_attachment` submission field, with its own prepaid role, receipt/external-order binding, retained checksum-verified bytes and immutable publication manifest. It remains local and is not mounted in the runtime. The agreed [procedure](PREPAID_LABEL_PROCEDURE.md) remains the operational model: an attachment does not establish dispatch, and no automatic replacement label purchase is allowed. No Lift attachment write was performed.

## Remaining integration

Persist reviewed report completeness, line/package identity and dispatch authority; maintain durable reconciliation revisions; handle failed polls and send-time freshness; provide explicit hold resolution; and connect a dedicated prepaid attachment publisher. Only then mount the workflow for sanctioned sandbox testing. Existing High End Work routes, shared Lift normalizers, template registration and live configuration remain unchanged.

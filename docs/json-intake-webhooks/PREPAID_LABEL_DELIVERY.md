# Prepaid labels through the existing Lift attachment path

Marcus confirmed on 2026-09-29 that prepaid labels should use the same Lift order-attachment mechanism as Momentara's Wrike order grid. In the current code that mechanism supplies a controlled download URL in `order.order_attachment` during the existing order submission. No separate append-attachment endpoint was found or invented for this slice.

## Implemented locally

`json-intake/prepaid-label.ts` retains one PDF per intake receipt, using the existing private retention transport and receipt CAS history. Bindings include customer/integration/store/test scope, receipt, business fingerprint, external order ID and a hash of the original source URL. The computed content hash and byte count bind the retained PDF. Replays read and verify the retained bytes instead of downloading a potentially changed label at the same URL. Concurrent conflicting retention requires review.

The production reader must be the existing configured, DNS-pinned HTTPS asset reader. The helper bounds PDFs to 5 MiB and checks the PDF header. That check establishes a file-type boundary, not usability, security scanning or correct destination/carrier; the publication caller must supply a trusted label review bound to the retained evidence hash.

Publication uses the existing controlled `https://go.vornan.co/d/…` delivery pattern with a separate prepaid document role and manifest namespace. Storage dependencies and enablement are explicit; there is no default live configuration. Conditional writes, object version/metadata checks and immutable manifest comparison prevent silent replacement. Direct-download preflight rejects redirects and verifies the downloaded bytes against the retained checksum. Source URLs and private storage references are excluded from the Lift payload.

The configured retention period must match the deployment's delivery-object lifecycle, and it must cover the reviewed `required_until` fulfillment date. Retries preserve the original publication clock. A future-dated order that outlives the configured period is blocked; do not assume a fixed 14-day window is adequate.

`applyPrepaidOrderAttachment` sets the existing canonical `order_attachment` and appends this instruction to `order_note`:

> Customer-supplied prepaid label — do not purchase shipping.

It preserves an identical attachment on replay and refuses to overwrite a different attachment. It clears the source label URL only in the outgoing canonical copy. The stored receipt remains unchanged. The existing Lift mapper carries the controlled URL into the submission payload, and `buildJsonLiftPreview` optionally accepts the publication to show this exact candidate. Preview submission remains disabled, and all unrelated readiness gaps remain.

## Scope and follow-through

This slice prepares an attachment for order creation. It does not append documents to an already-created Lift order, establish multi-attachment behavior, or replace an order grid. A receipt with another attachment needs a supported append/multi-document operation before proceeding. v1 intake supplies one label URL; package/tracking association remains an explicit shipping step.

The code does not purchase labels, infer tracking from PDFs, mark packages dispatched, or emit shipment callbacks. Follow [the prepaid procedure](PREPAID_LABEL_PROCEDURE.md) for staff checks and separate dispatch evidence.

Before runtime activation: wire durable receipt/asset storage and the trusted label-review record, verify the delivery bucket policy/lifecycle and fulfillment window, and run one sanctioned sandbox order through Lift attachment access and staff tracking/dispatch entry. The final submit guard below now checks publication manifests. No source download, S3 write, Lift order write, deployment or real callback was performed while implementing these slices.

## Final submit guard — 2026-09-29

`prepaid-submit.ts` adds a trusted `prepaid_submit_binding` to the processing-job contract. It contains the retained label evidence, immutable publication and reviewed fulfillment deadline. `buildPrepaidSubmitBinding` prepares it only from a matching unconfirmed receipt/publication. This is internal job data, not an accepted partner request field. The receipt-to-job persistence adapter must still install that binding when creating an e-commerce job.

The shared submit integrity fingerprint includes this binding when present. Jobs without it retain the previous fingerprint algorithm. Certification refresh and job regeneration preserve the binding. Both existing server submit paths now use the document dispatcher: ordinary jobs retain the Wrike preflight, and prepaid jobs require the dedicated check. A prepaid delivery URL without its binding is blocked.

Immediately before submit intent reservation, the prepaid check verifies test scope, job customer and external order ID, the exact canonical/payload attachment URL and instruction, expiry/fulfillment coverage, stored manifest, object version/metadata and checksum of the directly downloaded file. It performs only GET/HEAD operations; a missing object cannot be silently republished. A shared 30-second abort deadline bounds storage/download operations, in addition to the download's eight-second timeout. Verification records the prepaid document role in the existing attempt audit. Changed in-memory job data during verification is rejected; this does not establish persisted-job concurrency protection. The future receipt-to-job workflow must preserve authoritative job-version/CAS integrity at dispatch. Existing uncertain-submit/reconciliation behavior is unchanged.

Prepaid delivery remains disabled unless all three trusted runtime settings are configured:

- `PATHFINDER_ENABLE_JSON_PREPAID_DOCUMENT_DELIVERY=true`
- `PATHFINDER_JSON_PREPAID_DELIVERY_BUCKET`
- `PATHFINDER_JSON_PREPAID_MANIFEST_BUCKET`

These settings were not created or enabled. They supplement the existing submission gates and do not activate JSON intake, register the Draft template, authorize a Lift route, or make the preview submit-ready. The publisher's configured retention must match the delivery bucket lifecycle.

Sandbox execution remains pending: no deployed JSON intake URL or active test credentials are verified in the project handoff; complete customer/product mapping, durable intake-to-job binding and a sanctioned test route are still required. The local tests use synthetic documents and mocked storage/download responses. No Lift sandbox order was submitted by this slice.

# Local shipping callback slice — 2026-09-28

`json-intake/shipping-events.ts` adds local shipping evidence capture, quantity reconciliation and event projection. It extends the existing receipt history, event materializer, current-event check and signed outbox. No production reader, endpoint, scheduler or external callback transport is installed.

## Source boundary

An injected trusted reader supplies a complete `ShippingSnapshot`, bound to integration/customer/store/test scope, receipt, confirmed Lift order and confirmation evidence hash. Package identity must already be resolved from authoritative package records; tracking is not its identity. `source_revision` is a durable reconciliation revision, not a polling counter. The reader must establish freshness and source completeness. Double reads catch changed evidence before receipt CAS, but are not a distributed transaction or production source attestation.

Capture rejects incomplete snapshots, older source revisions, changed content under the same revision, observation time moving backwards and dispatch evidence drift. Capturing the same snapshot is idempotent. Accepted snapshots use the shared receipt revision sequence, keeping webhook order revisions comparable to intake events. Source observations update receipt freshness without moving it backwards.

Dispatched packages require explicit dispatch evidence, carrier, service, tracking and line allocations. Date-only values are rejected as timestamps; an unavailable exact dispatch timestamp remains null. No carrier or dispatch state is inferred from tracking-number patterns, free-text tracker messages, attachments or a line-level ship date. The verified raw Lift reports therefore cannot simply be passed into this interface and treated as authoritative package dispatch.

## Quantities and events

- Expected quantities come from every canonical intake line. Package allocations bind exact external line IDs; unknown/duplicate lines, duplicate package identities and over-allocation fail closed.
- Quantities use bounded exact millionths for reconciliation, supporting the observed fractional large-format allocations without rounding. Invalid, negative, zero or excessively precise/large values reject.
- Pending labels contribute no shipped quantity and emit no shipping events in this slice. Both purchased and customer-prepaid packages use the same explicit dispatch requirements.
- Dispatched packages produce `shipment.updated`. Full coverage of every expected line produces `order.shipped`; otherwise dispatched packages report `partially_shipped`. Unknown/incomplete input cannot establish full shipment.
- Shipment IDs are scoped hashes of the receipt, Lift order and stable source package ID. Tracking corrections retain shipment identity and produce a new event under a later receipt revision.
- Serialized event bodies are projected field by field: internal dispatch references, label URLs, private storage references and extra input fields are not copied. Tracking URLs remain null until a reviewed carrier URL mapping exists.
- Repeated history scans, restart and unchanged projections emit no additional events. Corrected full-shipment summaries can emit a revised `order.shipped`; receivers must apply the accepted event-ID/revision contract rather than treat every delivery as a new business transition.
- Pending events are compared with the latest committed receipt shipping projection before sending. Changed tracking, quantities or fulfillment suppress stale pending events. This checks committed local evidence, not live source freshness; production delivery must add the source freshness policy. Previously delivered events cannot be recalled.

Removing/reversing a dispatched package, reverting delivered state, or changing its line allocations requires review. Capture retains the prior evidence and commits an internal `shipping_review` hold before rejecting the update. Incomplete reads, changed content under the same source revision and drifting reads also place a hold; older source revisions simply reject. Held receipts produce no shipping events, and pending shipping events fail the current-event check, including previously prepared full-shipment callbacks. A later poll cannot automatically clear this hold. An explicit reviewed resolution workflow remains required before activation. Previously delivered events cannot be erased; reversal/retraction notifications need an agreed contract rather than an invented event type.

## Prepaid label introduction

Marcus approved beginning with a prepaid PDF attached to the Lift order, analogous to the Momentara order grid. Retain the exact supplied label privately, publish it through a reviewed attachment path, clearly mark customer-supplied prepaid shipping, and prohibit automatic replacement-label purchase. One label covers one package; unusable labels or additional packages require clarification.

An attachment alone supplies neither authoritative tracking nor dispatch. Shipping staff must record tracking, package allocations and dispatch through a supported, auditable procedure; its source adapter can then populate this snapshot. Attachment publication and that operator procedure are not implemented here. Prepaid use may follow the initial purchased-label launch, but shipping callbacks remain required at launch.

## Verification and remaining work

Synthetic local tests cover partial versus seven-package full shipment, the confirmed 2/1/1 partial shape, exact 0.5+0.5 allocations, pending prepaid labels, absent exact timestamps, scope/association/quantity rejection, concurrent capture CAS and interrupted materialization recovery, durable restart/outbox deduplication, accepted signing verification, tracking corrections and stale-event suppression, conflicting/older revisions, incomplete and drifting sources, and review holds for unsupported dispatch reversals. Existing webhook retry and HMAC fixtures remain unchanged.

The live source examples remain documented in SHIPPING_SOURCE_VERIFICATION.md. They inform the scenarios but have not been turned into real partner events. Remaining launch work includes a source-backed dispatch/identity/freshness policy, preservation of Lift's actual ship date at the appropriate adapter boundary, representative label packaging/prepaid verification, production persistence and reader/scheduler bindings, secure sandbox provisioning, and a sanctioned end-to-end test. No partner credentials or events were sent, no order attachments published, and no live configuration changed.

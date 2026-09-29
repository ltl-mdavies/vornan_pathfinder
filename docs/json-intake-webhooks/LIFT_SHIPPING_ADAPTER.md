# Lift shipping report adapter — local slice, 2026-09-29

`lift-shipping-source.ts` maps the observed AS360Orders, Package Details and Shipping Report `rowset` shapes into the existing local shipping snapshot model. `captureLiftShippingReports` connects an injected committed report/review reader to receipt capture; it does not install HTTP fetching, runtime routes, a scheduler, credentials or external callbacks.

## Binding and coverage

The adapter verifies test/customer/integration/store scope, receipt, confirmed Lift order and confirmation hash. The order header must match the reviewed target customer ID and intake EXT_ID. An explicit one-to-one map connects every Lift ORDER_LINE_ID to an intake external line ID. Order-line quantities must match the canonical expected quantities; missing, extra, duplicated or changed order lines reject rather than becoming cancelled/non-shipping exclusions.

The report collector must assert that all pages were read. A payload still marked `hasMore`/`has_more` true, an unsupported envelope, missing shipping-line coverage or a cross-order row rejects. HTTP success alone is not a completeness guarantee. The production collector's pagination and freshness policy still need implementation and verification.

## Package evidence and dispatch

Package Details supplies package tracking and allocations. The Shipping Report's repeated master tracking value is deliberately not used to replace package tracking. The package key combines order number, SHIPPING_ID and BOX_NUMBER; an explicit identity-policy review is required before a usable snapshot is returned. Stability across repacking/corrections remains an external source-contract requirement.

Identical projected allocation rows from joins count once. Conflicting quantities for the same package/line, contradictory package tracking/service, unknown lines and allocations exceeding expected totals reject. Fractional quantities remain supported through the existing exact bounded reconciliation.

The adapter retains ACTUAL_SHIP_DATE as date-only line evidence. It never manufactures a midnight dispatch timestamp or treats that date, a free-text tracker message, an order-header status, or a label attachment as package dispatch confirmation. Reviewed package facts supply carrier, service, purchased/prepaid label source, explicit dispatch reference, status and timestamps (null where exact times are unknown).

Each package review is bound to a hash of its projected identity/tracking/service/allocations/date evidence. Changed tracking, allocations or line ship dates invalidate that review. Unordered report rows normalize deterministically; negotiated rates, raw addresses, private URLs and other unrelated fields are neither hashed into this projection nor exported. This hash is an internal evidence binding, not an independent approval credential. Carrier/service verification remains the trusted reader's responsibility.

`prepareLiftShippingSnapshot` returns evidence, review gaps and a nullable snapshot. Missing identity/dispatch review returns no usable snapshot. The capture wrapper turns unresolved review into an incomplete-source hold through existing receipt capture. Read/parse/binding errors commit a SOURCE_UNVERIFIED hold and expose only a safe fixed error; old queued shipment/completion events then fail the current-event check. Holds retain the last evidence and cannot clear automatically. Previously delivered events cannot be withdrawn; review resolution/retraction policy remains required.

## Prepaid procedure and release scope

[PREPAID_LABEL_PROCEDURE.md](PREPAID_LABEL_PROCEDURE.md) describes the agreed attachment-first introduction, including separate tracking/package/dispatch entry and no automatic label purchase. This slice tests pending customer-prepaid packages but does not publish attachments or provide an operator dispatch interface.

Tests use synthetic report fixtures reflecting the observed full/partial patterns, including seven boxes sharing one SHIPPING_ID, missing line dispatch, fractional splits, duplicate join rows, scope/coverage failures, corrections, pending prepaid labels, receipt capture and blocking stale queued events after a source failure. No real example order was associated with Silicon Pasture, and no partner event was sent.

Next integration work: durable report collection/reconciliation revisions, actual line/association bindings, reviewed package dispatch source and identity policy, explicit hold resolution, approved attachment publication, then sanctioned sandbox activation and end-to-end testing. The reader must return a committed stable revision/time on both capture reads, not refresh timestamps on every poll.

# Live shipping-source verification — 2026-09-28

Marcus supplied A0230405 as fully shipped with multiple tracking numbers to one location, and A0231011 as fully shipped to multiple locations/methods. Reads were limited to these exact orders using the repository-configured Package Details (`p0`), Shipping Report (`p1`) and AS360Orders (`p0`) report parameters. All six final reads returned HTTP 200. Shipping Report initially timed out; one retry succeeded. No mutations, carrier requests, label purchases, customer callbacks or configuration changes were made.

Raw responses are private local evidence under `/tmp/pathfinder-shipping-verification`, not source-controlled. This note omits customer addresses, tracking numbers, negotiated rates and delivery-recipient details. These are read-time snapshots, not proof of future report stability or atomic consistency across reports.

## A0230405

- AS360Orders: header status `Invoiced`, 12 order lines.
- Package Details: 15 allocation rows, seven boxes, seven distinct tracking numbers, one location and `UPS 2nd Day Air`.
- All rows share one `SHIPPING_ID`. A stable package identity cannot use that value alone. `(order, SHIPPING_ID, BOX_NUMBER)` distinguishes seven packages in this sample; stability across corrections/repacking still needs verification. Tracking number should not be the sole immutable event identity because tracking can be corrected.
- Line 1 has quantity 1 allocated as 0.5 in each of two boxes. Other repeated lines split whole quantities across boxes. Summing package quantities by ORDER_LINE_ID exactly matches each of the 12 ordered quantities (16 in total).
- Shipping Report: 12 rows with actual ship date 2026-09-18, but only one distinct tracking number repeated for every line. That number matches one of the seven package tracking numbers. The Shipping Report alone would omit six tracking numbers.
- Package tracker messages indicate delivered. These free-text messages are not yet a reviewed structured carrier-state contract.

This sample supports combining package-level tracking/allocations with line-level shipment evidence. Fractional allocations appear valid for this large-format job; do not assume integer quantities universally or silently round them. Andy's label quantities still need a representative manufacturing/packaging example.

## A0231011

- AS360Orders: header status `In Production`, three lines with quantities 2, 1 and 1.
- Package Details: two rows, two SHIPPING_ID values, two tracking numbers and two locations. Both returned packages use `PRIORITY_OVERNIGHT`.
- Shipping Report: three line rows. Line 2 has actual ship date 2026-09-18; line 3 has 2026-09-28. Both have tracking and a destination. Package messages indicate delivered for line 2 and picked up for line 3.
- Line 1 (`ORDER_LINE_ID` 10105705, Window Perf, quantity 2) has method `TBD`, no tracking, no actual ship date and no destination. No Package Details row accounts for it. Known package allocations total 2 versus ordered quantity 4.

This conflicts with the supplied fully-shipped/multiple-method description. Do not classify the business order as partial solely from this snapshot, and do not emit full-order completion. Marcus was asked whether line 1 was cancelled/replaced, collected/delivered another way, or should have shipping details. Exclusion or completion requires authoritative evidence, not an inferred exception.

## Required implementation and verification

1. Preserve `ACTUAL_SHIP_DATE`: Lift returns it, but `normalizeShippingReportPayload` currently discards it. It is a date, not an exact timestamp; do not invent a dispatch time/timezone from it.
2. Use Package Details for package tracking, box identity and allocations; join through ORDER_LINE_ID to original intake external line IDs and expected quantities. Shipping Report is supplementary line-level evidence, not a complete package list.
3. Confirm whether an actual ship date is populated at physical dispatch or earlier when labels are created. Current snapshots cannot establish that timing.
4. Verify stable identities and updates through correction/repacking, and obtain authoritative cancellation/non-shipping-line semantics before excluding quantities from completeness.
5. Do not derive carrier identity or normalized status solely from service strings or tracking-number shape. Explicit carrier/state mapping remains required.
6. Still obtain a known partial-shipment example and a prepaid-label example. Synthetic tests can cover withholding completion meanwhile, but cannot prove live source semantics.
7. Maintain customer/order/receipt association checks. These example orders are source-behavior evidence; do not attach them to Silicon Pasture or create partner events from them.

UPS live rates from Shipping Intelligence are not a dependency of these outbound tracking callbacks. Rate shopping/label purchase is a separate integration. Reuse that application's reviewed carrier integration if rate or purchase functionality becomes part of this workflow; do not introduce a second rating implementation solely for callbacks.

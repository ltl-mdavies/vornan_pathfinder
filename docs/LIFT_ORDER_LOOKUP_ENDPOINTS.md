# Lift Order Lookup Endpoints

This note records Lift read endpoints that can enrich Pathfinder job detail after an order is submitted.

## Shared Keys

- `ORDER_NUMBER` is the Lift order number and target-side order record key.
- `ORDER_LINE_ID` is the Lift order line key.
- `ORDER_NUMBER` and `ORDER_LINE_ID` are the common join keys across order, proof, and package/shipping details.

## AS360 Orders

Purpose: lightweight Lift order header and line detail.

- Endpoint pattern: `https://admin.lifterp.com/ords/lifterp/lift/erp/flush/ondemand/91/AS360Orders/N?offset=0&p0=<order_number>`
- Filter:
  - `p0`: `ORDER_NUMBER`
- Returns:
  - order header fields such as customer, title, PO, status, creation date, order step
  - `LINES` array with line number, `ORDER_LINE_ID`, quantity, product name, material, line step, and print dimensions
- Notes:
  - Does not include proofing or shipping details.
  - `UNIT_NUMBER` may be null or not useful for product resolution.

## AS360 Proof Report

Purpose: proof files, proof status, proof comments, and detailed report links.

- Endpoint pattern: `https://admin.lifterp.com/ords/lifterp/lift/erp/flush/ondemand/91/AS360ProofReport/N?offset=0&p1=<order_number>&p2=<order_line_id>`
- Filters:
  - `p1`: `ORDER_NUMBER`
  - `p2`: `ORDER_LINE_ID`
- Returns:
  - proof filename and low/high proof links
  - proof approval status, approved by/date
  - proof comment text and comment timestamps
  - comment attachments
  - detailed report links
- Notes:
  - The same order/line/proof attachment may appear multiple times when there are multiple proof comments.
  - `ATTACHMENT_ID` identifies the proof artifact.

## Package Details

Purpose: packing, package tracking, shipment, and shipment cost detail by order or line.

- Endpoint pattern: `https://ltlco.lifterp.com/ords/lifterp/lift/erp/flush/ondemand/91/PackageDetails/package_details?offset=0&p0=<order_number>&p1=<order_line_id>`
- Filters:
  - `p0`: `ORDER_NUMBER`
  - `p1`: `ORDER_LINE_ID`
- At least one filter is required.
- Returns:
  - package tracking number, package type, box number, dimensions, and weight
  - tracker message
  - location name
  - ship method
  - negotiated rate
- Notes:
  - Negotiated rate is displayed per order line/package row. Pathfinder should dedupe duplicate `NEGOTIATED_RATE` values by shipment/package grouping before presenting shipment cost totals.

## Pathfinder Integration Direction

- Capture Lift `ORDER_NUMBER` from the order import response whenever Lift returns it.
- Store that value on the Pathfinder job as `target_order_number`.
- Use `target_order_number` as the default lookup key for AS360 Orders, Proof Report, and Package Details.
- Use `ORDER_LINE_ID` from AS360 Orders to enrich line-level proof and package calls.
- Keep these lookups read-only. They should enrich job detail and customer-facing order status, not mutate the Canonical Order.


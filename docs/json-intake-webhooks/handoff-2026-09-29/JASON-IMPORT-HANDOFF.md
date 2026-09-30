# Jason — Lift E-commerce Orders import interface

Please build/review the Lift import mapping against `jason-lift-ecommerce-orders.example.json`. This is the full proposed HTTP JSON body, without Pathfinder's internal review wrapper. It covers the approved combined Andy/WooCommerce field layout. `jason-field-mapping.md` lists all 146 template fields for recording Lift destinations and behavior.

This is an interface-design example, not an order to import. Addresses, prices, dates, product references and document URLs are illustrative. `.invalid` URLs cannot be downloaded. File checksums/byte counts are copied from the sanitized fixture, and no corresponding artwork files are included. Customer `174094` / Silicone Pasture, customer number `0000000549` (549), was confirmed in the live Lift directory on September 29, 2026. This supersedes the earlier incorrect ID `17409`. Verify the same identity in the chosen import environment before testing. No actual Lift unit/product mappings have been supplied: `unit_number` is empty and `product_id` is null deliberately. Do not create an order or substitute a product from this example.

## Body and identity

The top-level objects are `customer`, `contacts`, `source`, `order`, and `lines`. The import target is the separate **Lift E-commerce Orders** template, not a modification to the High End Work importer. `source` holds traceability; the example's review schema/integration IDs are illustrative, not production routing settings.

Preserve `order.ext_id` exactly and return the created Lift order number with a verified association to that value. The example EXT_ID is conspicuously synthetic; actual Andy receipts use Pathfinder's deterministic scoped identifier. Repeated identical input must not create another order. An uncertain response must be reconciled by EXT_ID before any resubmission. Please confirm the supported identifier length and lookup behavior, and how errors are returned at order/line level. The established transport uses an `Ext_ID` header matching the body; endpoint, company, authentication and accepted request envelope must be confirmed for this new import interface. No credentials are included here.

Preserve `lines[].external_line_id` as the source-to-Lift-line association. `line_number` is ordering, and `customer_sku` is the customer's reference; neither replaces the Lift product identity. `store_product` and `store_variation_id` are source identifiers used in translation, not Lift unit/product IDs. Route configuration must select the intended Lift unit-number or product-ID model; never infer a target product from the source variation number.

## Dimensions, production and artwork

All dimensions, bleed, roll diameter and spacing are inches. Area is square inches. No separate measurement-unit field is required.

- `final_height` / `final_width`: ordered finished size.
- `live_height` / `live_width`: optional live area. Null means unmapped; do not derive these from final size or PDF boxes.
- `bleed`: per-edge bleed; the first line's 1.85-inch finished size and 2.10-inch page illustrate 0.125 inch on each side.
- `artwork.page_in`: PDF page/MediaBox measurements; `trim_in`: PDF TrimBox measurements. These describe the supplied file and support validation; they are not another set of manufacturing dimensions.

`production.material`, `laminate`, `varnish` are separate neighboring fields. Blank laminate/varnish does not authorize an inferred finish. Cut type/shape/complexity are only under `cut`. Complexity carries square/radius-corner detail, without a separate corner-description field. `spot_name` and `layer_name` are distinct. Presence flags and names must not be treated as proof that a usable contour exists.

Roll finishing has two modes: `max_roll_diameter` with a numeric inch value, or `max_labels_per_roll` with an integer label count. `unwind_direction` and `spacing` are separate. Lines 1–2 illustrate both modes; lines 3–4 have no roll specification. These examples are for field coverage, not a claim that all illustrated products will be manufactured on rolls.

`artwork.file_url` is the controlled published original, paired with `file_name`, `checksum`, `bytes`, format, pages and PDF dimensions. There is one exported SHA-256 checksum. Pathfinder separately checks the source approval hash against it. `approval.proof_status`, provider, actor and timestamp describe upstream approval; they do not manufacture a Lift/Proof approval or authorize changing the bytes. Keep Andy's RGB PDF profile intact; any production color/RIP decision is separate. `preview.file_url` is a visual reference, not the approved production original.

## Dates, money and customer information

`requested_ship_date` is a customer's requested future dispatch date, not promised delivery. `due_date` is a separate field; Jason should confirm its Lift meaning and handling. The example uses ISO date strings for readability. Confirm Lift's required import date format before endpoint testing; Pathfinder has route-controlled formatting. Null dates do not authorize an invented schedule or turnaround.

Order pricing: currency, subtotal, discount, shipping, refund, tax and total. Line pricing: `item_base_price` is per-item calculated cost; `customer_price` is per-item selling price. Monetary values are decimal strings to preserve precision. The example's four lines × 50 × 0.10900 = 21.80 subtotal, plus 8.00 shipping and 1.53 tax = 31.33 total. These are fabricated mapping values, not quotes or pricing rules. Cost is deliberately null. Do not multiply a per-item price twice, infer missing cost/currency, or recalculate/overwrite supplied totals without an agreed rule. Please confirm each destination's tax/discount/refund semantics.

`payment` contains account/payment references only; it must not initiate a charge. `coupons` is optional and empty in the example. Its template representation is proposed rather than demonstrated by the source XML; confirm the mapping before using populated coupons.

Keep billing separate from shipping and contacts. WooCommerce's overloaded customer number does not automatically create or match a Lift customer. Use the reviewed Lift customer association. `source_status` comes from WooCommerce and does not set Lift production/shipping status. `market` and `priority` originated in Andy's input; they are optional trace/handling fields, not automatic priority upgrades. `production.orientation` came from the XML and has unconfirmed meaning; leave it unmapped until clarified, and do not substitute unwind direction.

Null means no mapped value, not zero. Preserve meaningful false and numeric zero. Define the importer's omitted/null behavior explicitly, particularly if the endpoint can update an existing order.

## Documents and shipping behavior

Use the same existing Lift `order_attachment` mechanism as Momentara's order grid. In this example it represents the customer-supplied prepaid label. Retain and download the label without changing it, and display:

> Customer-supplied prepaid label — do not purchase shipping.

Do not overwrite another order attachment. The observed implementation supplies one attachment URL on order creation. Please confirm any supported operation for adding a label later or preserving multiple attachments. Publication access must last through the requested fulfillment date; a fixed short-lived link may be inadequate for advance orders.

`shipping_policy.blind_ship` and `ship_from_name` express shipping instructions; facility return address and the purchased-label method remain reviewed configuration. Label receipt/printing is not dispatch. Carrier, service, tracking, stable package identity, quantities by source line and dispatch must be recorded separately. Extra/unusable/mismatched labels hold shipping for clarification; do not buy replacement labels automatically.

We need package-level shipment updates at launch, whether LTL or Andy purchases the label. Please confirm where staff enter prepaid tracking and dispatch, and which report exposes it. Package identity must survive retries/corrections; multiple boxes may share a Lift shipping ID. A full-shipment event waits for all ordered quantities. Confirmed examples: A0230405 is fully shipped across multiple tracking numbers to one destination; A0231011 is partial, with line 1 outstanding and lines 2–3 shipped. Do not use the header status or one tracking number alone to determine completeness.

## What we need back

1. Completed field worksheet with destination/type, required/default/null handling and any unsupported field.
2. Test import endpoint/envelope/date format, target customer/product mappings and credentials via secure sharing.
3. Order response and EXT_ID duplicate/reconciliation behavior; source line association output.
4. Attachment retrieval/retention and append/multiple-document behavior.
5. Purchased/prepaid shipping entry and report fields for packages, quantities, tracking and actual dispatch.

Start with mapping review. Once the interface and Pathfinder test route are ready, run one clearly marked sandbox order, verify every mapped line and document, then exercise a partial and complete shipment. Do not change the live High End Work/Momentara path to make this example import.

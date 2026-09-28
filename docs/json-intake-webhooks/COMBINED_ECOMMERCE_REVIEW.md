# Combined e-commerce payload — agreed field model

This review combines the Sticker Press fields with the WooCommerce XML field inventory and Marcus's clarified decisions. JSON is the output format. The raw XML and its customer/contact/artwork data have not been copied into the repository. The [combined sample](lift-ecommerce-combined.sample.json) is synthetic, and the [Draft template record](lift-ecommerce-orders.template.json) contains the full mapping structure. Nothing has been installed in a live target.

## Output grouping refinement

The latest draft orders line identity as `line_number`, `unit_number`, `product_id`, `customer_sku`, `product_name`, `description`, then quantity. Unmapped product ID, customer SKU and description remain visible as null; `sku` is no longer a second alias. Dimensions appear as `final_height`, `final_width`, `live_height`, `live_width`, `bleed`, with all dimensional measurements in inches. Unmapped live dimensions stay visible as null rather than being inferred from trim or final size.

Production starts with `material`, `laminate`, `varnish`. Only material is exported; source material code remains private mapping/evidence data. Source finish feeds laminate when no reviewed target laminate is supplied, with no second finish output. Cut type, shape, complexity and die reference reside only in `cut`; complexity carries square/radius-corner details, so no separate corner description is exported. Andy's current source contract has no additional corner-description requirement. Reviewed target cut/laminate values take precedence over source fallback values.

Order fields are grouped into identity/scheduling, billing/shipping, documents and pricing/payment. Line fields are grouped into identity, dimensions, production/cut/roll finishing, artwork/approval/reference, pricing and notes. Layer and spot names remain distinct production metadata. The output now carries only artwork.checksum; the original approval hash is retained and checked internally before exporting approval metadata. High End Work and retained canonical source evidence are unchanged.

## Decisions applied

- Use the existing High End Work customer/destination model. Do not infer a Lift customer from the overloaded WooCommerce Customer Number or implement customer creation/synchronization here.
- Use existing `dimensions.final_width`, `final_height`, optional live dimensions and bleed. Andy's explicit inch unit and PDF page/trim evidence remain available. Do not reproduce predefined/custom/product/shape width and height variants from the XML.
- Use the existing artwork file name, URL and checksum fields. Andy's PDF/hash/approval evidence remains an extension enforced by his intake adapter; generic e-commerce orders do not require those source-specific objects merely to render a preview.
- Retain optional requested ship date. It means a future requested shipping date, not delivery date. Both requested ship date and due date stay visible in this draft as null when unmapped; no turnaround/due date is manufactured. The input fields remain optional. Source-specific date parsing/timezone and Lift date formatting remain route configuration.
- Keep billing/address-book fields, sample, production and account/payment references. Omit XML `Product_Variation`, `Non_variation_attributes` and `login_link`. Andy's separate stable `store_variation_id` remains a source identity, not the excluded descriptive variation string.
- Defer `Custom_Area_Price` and `Original_Price`. Line pricing now uses `item_base_price` (calculated cost per item) and `customer_price` (selling price per item), as explicitly requested. Neither is calculated by the exporter; the older unit_price/markup_price output names are removed.

## Organization and source coverage

| JSON section | Coverage |
| --- | --- |
| `customer`, `contacts`, `source` | Existing High End Work customer/contact/trace model; source order number, store, schema, integration and dates |
| `order` | Title, PO, customer note, optional requested ship date, source status, reference number, account representative, invoice email |
| `order.billing` | First/last name, company, address lines, city/state/postcode/country, email/phone, address-book reference |
| `order.shipping` | Existing ship-to and shipping method/account/billing postcode/country fields; first/last ship-to names can map into existing attention-to |
| `order.shipping_policy` | Andy's supplier/blind-shipping/sender/prepaid-label policy and published label reference |
| `order.pricing` | Currency, discount, subtotal, shipping, refund, tax, total |
| `order.payment` | Payment method, authorized/charged amounts, authorization reference |
| `order.coupons` | Optional array of code/amount records; the source sample had no populated coupons, so this is a proposed normalized representation |
| `lines[]` | Target product identity, source SKU/line ID, name/description/line note, quantity; label description can use existing description or line note |
| `lines[].pricing` | `item_base_price` is cost per label/item; `customer_price` is the marked-up selling price per label/item |
| `lines[].dimensions`, `.artwork`, `.approval`, `.area` | High End Work dimensions/artwork plus Andy's PDF geometry, exact hash/provenance, cut and rectangular area semantics |
| `lines[].production` | Existing material/laminate/coating/ink/cut fields; material, laminate, varnish, orientation and white-ink flag; no material-code/finish/cut duplicates |
| `lines[].cut` | Type, shape, complexity (including corner detail), die reference, method and Andy's embedded spot/layer metadata |
| `lines[].roll_finishing` | Specification and numeric value, unwind direction and spacing; diameter and spacing are always inches |
| `lines[].sample`, `.approval.proof_status` | Optional sample flag and shop proof workflow status, grouped with but distinct from approval provenance |
| Existing reference-proof / preview fields | Optional sample/reference proof can map to the existing reference-proof or line preview delivery field after its meaning/publication is reviewed; no extra login or raw-download fields |

`item_download_url`, `Download_URL` and `artwork_file` are alternative source references for the existing artwork delivery model, not three competing output URL fields. Their source precedence is future adapter configuration. Empty `attribute_size`/predefined/custom/shape geometry variants are not carried as redundant production dimensions. Optional blank laminate/varnish values must not be silently converted into production defaults. No source pricing, currency, die or customer ID is guessed from SKU, area or other labels.

## Pricing and roll semantics

The output always contains `order.pricing` and each line's `pricing`, even without mappings. Unmapped price slots are `null`; explicit zero is preserved as a decimal string. Decimal strings retain sub-cent precision such as `"0.10900"` without binary floating-point rounding. No totals, margin or currency are inferred. Currency is optional and must be explicitly mapped before financial use. Other optional fields retain omitted versus null versus false distinctions.

Exactly one finished-roll mode applies per line:

```json
{"specification":"max_roll_diameter","value":14}
```

or

```json
{"specification":"max_labels_per_roll","value":500}
```

Marcus confirmed that TDP roll diameters are always inches. The e-commerce contract therefore fixes dimensions, roll diameter and spacing to inches; area is square inches. No separate `unit` or `spacing_unit` output fields are needed. The roll specification itself distinguishes a diameter from a quantity of labels. Label count requires a positive safe integer; diameter a positive measurement; spacing a nonnegative measurement. Missing source unit tags are valid under this convention, while conflicting supplied tags (such as millimeters) are rejected rather than relabeled. No conversion from other units is implemented here.

Pricing remains in two intentional sections: order-level currency/subtotal/discount/shipping/tax/refund/total, and line-level `item_base_price`/`customer_price`. Both line prices are per item, not extended totals, and use the order currency. Legacy shop Item_Price represents the customer selling price. No cost value is inferred from Custom_Area_Price, Original_Price or an old markup field. Unmapped cost and selling prices remain null; totals, costs and markups are never calculated by this exporter.

## Scope and validation

The explicit e-commerce projection now accepts a reusable optional `CanonicalEcommerceOrder` extension. The strict `stickerpress.order.v1` intake contract is unchanged: expanding the output model does not permit missing approval/artwork evidence in Andy's submissions. Source proof status does not approve an artifact or clear a production hold. Document publication and target job/submission/association paths remain unimplemented here.

Extended template fields are optional across the combined draft; core target product/quantity/dimension requirements remain. Source-specific constraints belong to each intake adapter. No XML parser/import workflow, source URL fetching, customer synchronization, pricing calculation, live template installation or submission was added. High End Work exports, routes, default selections and target registration remain unchanged. Runtime installation and Lift import-field acceptance still require the review described in ECOMMERCE_TEMPLATE.md.

Reproduce the synthetic combined example with `node --import tsx/esm scripts/lift-ecommerce-combined-preview.ts`. The four-line example illustrates both roll modes plus cut/approval metadata. Its workflow values, pricing and requested date are examples only; the wrapper is explicitly `review_only`, `fixture_only` and `submission_allowed: false`.


## Field origins and PDF dimension clarification

- `order_type_name` was in Andy's source payload. It is now omitted from the e-commerce output, with source evidence retained. This does not alter Lift route/order-type configuration.
- `source_status` maps the WooCommerce XML `Order_Status` (the supplied example says Processing); it is not a field from Andy's order.
- `market` and `priority` were supplied by Andy (`web` and `standard`). They remain optional output fields pending a decision to remove them; they are not invented production defaults.
- `production.orientation` maps the XML `attribute_orientation`, empty in all 16 source lines. Its business meaning is not established by that example, and it must not be equated with unwind direction. It remains optional pending a decision on its use.
- `artwork.page_in` and `artwork.trim_in` came from Andy's per-line artwork metadata. The local inspector compares page against the PDF MediaBox and trim against TrimBox. These are declared file measurements, not a replacement for order dimensions.
- `dimensions.final_height/final_width` describe ordered finished size. `trim_in` should agree with those within the separately reviewed metadata policy, but retaining both supports source/PDF validation. In Andy's first example, final/trim is 1.85 by 1.85 inches and page is 2.1 by 2.1 inches, allowing 0.125-inch bleed on each side.
- `live_height/live_width` are separate values from High End Work. The source contracts reviewed here do not define a derivation from PDF page or trim, so they remain null unless mapped. Neither PDF box is used to fill them automatically.
- `approval.proof_status` now groups the shop workflow status with approval information. It remains distinct from the upstream approval actor/time/hash; moving it does not approve an artifact or satisfy any intake/production gate.


## Single exported artwork checksum

The latest draft removes `approval.artwork_sha256` and `production.application_type`. `artwork.checksum` is the single exported file hash for the line. If source approval supplies an artwork hash, the projector requires it to match that checksum and rejects a mismatch before constructing the export. The original source approval/hash remains in canonical receipt evidence for audit and validation; Sticker Press input requirements are unchanged. Approval provider, actor category, timestamp and proof status remain available in the output. This is output simplification, not permission to approve changed artwork.

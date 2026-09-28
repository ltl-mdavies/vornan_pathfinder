# Lift E-commerce Orders — Draft output template

Created a distinct reusable Draft with ID `template-lift-ecommerce-orders`, cloned from the repository's **Lift High End Work** definition. The [template record](lift-ecommerce-orders.template.json) contains the body, headers, canonical mappings and filename pattern in Pathfinder's existing OutputTemplate format. The [four-line preview](lift-preview.sample.json) exercises the expanded projection using Andy's sanitized fixture.

This is a local draft artifact. It has not been inserted into the live Lift ERP target, selected by any route or activated. The current deployed High End Work configuration was not fetched; the generator can accept an exported, reviewed template to preserve its custom mappings. No target read, normalization, bootstrap or save automatically inserts this draft. Existing High End Work defaults, empty-template fallback and the separate ThinkDifferentPrint template remain unchanged.

## Expanded coverage

The draft retains the base customer, contacts, source trace, order, shipping address, product, quantity, dimensions, production, artwork and note fields. It removes Momentara example values in favor of mapped tokens and preserves environment credential references and matching body/header EXT_ID. Like the existing Lift route, it marks `product_id` as the required target product identifier; source SKU/store variation never substitutes for it.

| Group | Added coverage |
| --- | --- |
| Source and order | Schema, integration, store, creation timestamp, order type, market, priority |
| Shipping policy | Supplier mode, blind shipping, sender name, missing-date policy, prepaid-label presence/precedence and published prepaid-label URL |
| Line identity | External line ID, store product and variation ID, separate from target product ID |
| Material/finish | Source material code, finish and shape, alongside mapped target material/laminate/cut type |
| Dimensions/artwork | Inch unit, PDF format, page count, bytes, page and trim dimensions, with existing final dimensions/bleed/file/checksum |
| Cut | Type, method, embedded flag, layer and spot names |
| Approval | Provider, approved-by category, timestamp and exact artwork hash |
| Area | Value, square-inch unit and bounding-box-times-quantity basis |
| Preview | Format, reference-only purpose and optional published preview URL |

All added canonical registry fields are optional globally. Template requirements apply to this draft only; existing customer orders gain no new required fields. The JSON canonical extension already carries the source evidence, with optional published-document fields added separately. Future input adapters must populate these fields; adding registry entries does not implement new spreadsheet ingestion rules.

Source download URLs, their expiry metadata and original prepaid/preview access URLs remain protected receipt evidence. The draft uses the existing artwork delivery field plus separate `document_delivery` fields for published label/preview links. A reviewed publication process must populate those fields. The exporter derives prepaid-label presence from the source label reference, so a supplied-but-unpublished label stays distinguishable from no prepaid label. The projection does not fetch, publish, validate access to, or authorize a document. It does not transform PDFs or confer Proof/production approval.

## Execution boundary

The legacy mapper handles top-level order mappings only. Merely installing this JSON record is not enough to export the added nested fields. A dedicated `projectLiftEcommercePayload` function applies the explicit field list, retains numeric/boolean/null types, verifies order/line identity, and only accepts the new template ID. It preserves the base target product/material values and overlays distinct source evidence. The local JSON Lift preview explicitly opts into this function.

The shared `generateLiftPayload`, generic order mapper and live preview/submit routes are unchanged. A later reviewed runtime integration must select this projection for this template, enforce its requirements, bind verified target/customer/catalog configuration, retain/serve approved documents and carry the final payload through existing submit-integrity and reconciliation. Draft status alone is not a security gate; there is no route assigned to it in this change.

The expanded JSON paths are proposed import fields, not a claim that Lift currently accepts them. In particular `order.order_type_name` preserves Andy's source value; it is not evidence of the Lift order-type configuration. Validate target import definitions, customer/order-type association, material/finish/cut translations, document delivery, ground/blind-shipping/return-address policy and dates before any sanctioned target test. Do not activate a route by copying this sample.

## Reproduction and review

```sh
# Clone the repository seed into a local Draft record:
node --import tsx/esm scripts/lift-ecommerce-template.ts > /tmp/lift-ecommerce-orders.template.json

# Alternatively clone a reviewed exported High End Work OutputTemplate record:
node --import tsx/esm scripts/lift-ecommerce-template.ts /path/to/high-end-work.template.json > /tmp/lift-ecommerce-orders.template.json

# Rebuild the sanitized four-line payload review:
node --import tsx/esm scripts/json-intake-lift-preview.ts > /tmp/lift-ecommerce-preview.json
```

Validation: 664 API tests, 15 Lift adapter tests and 29 template tests passed; all workspace type checks and API Lambda packaging passed. Final focused checks also passed after adding the derived prepaid-label presence flag. New cases check cloning without mutation, registry coverage/uniqueness, custom base mappings, explicit opt-in, unchanged core export behavior, four-line nested values, source/target separation, published/source URL separation and mismatched-line rejection. The legacy seed function body was compared against the prior commit and is unchanged apart from its exported signature/default timestamp expression. No production migration, target/config write, push, merge, deployment or external submission occurred.

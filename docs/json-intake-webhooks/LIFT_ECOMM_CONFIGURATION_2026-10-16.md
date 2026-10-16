# Lift Ecomm Orders configuration — October 16, 2026

Marcus authorized a separate Lift Ecomm Orders template using Jason's agreed JSON, the existing Larger Than Life / Lift / Company 91 connection, and product 374549 (Sticker Press Sticker) for every Andy line. Jason reports that his import interface is ready for testing.

## Saved configuration

| Record | Identity | State |
| --- | --- | --- |
| Shared Lift target | `lift-standard-graphics` | Existing settings retained |
| New template | `template-lift-ecommerce-orders` / **Lift Ecomm Orders** | Draft |
| New customer route | `174094` / `route-ltl-lift-91-ecomm-orders` | Draft |
| Product mapping | `mapping-stickerpress-sticker-374549` | Mapped to product `374549` |
| Internal product key | `STICKERPRESS_STICKER` | Single key for all Sticker Press lines |

The new route references `env-lift-prod`, the existing connection used by Momentara's High End Work route, and Company 91. Existing credential references were reused without changing credentials. The target's environments, legacy Lift settings and all existing output templates were compared before/after and remained identical. Both customers' existing High End Work route records, Silicone Pasture's workspace defaults, and its existing import methods remained identical. The existing Silicone Pasture High End Work route still references QA1; it was not repurposed.

The update used one conditional DynamoDB transaction: append the template to the current target, insert the new customer route, and insert its product mapping. The target and reference route were conditioned on their original data; both new records required absence. No API, web, Lambda or infrastructure deployment occurred. No Lift order or callback was sent.

## Mapping and validation

The template contains all 146 body fields in `handoff-2026-09-29/jason-lift-ecommerce-orders.example.json`. It was cloned from the actual current High End Work template. Its PO mapping explicitly uses `order.po_number`; the original High End Work contract-to-PO mapping remains unchanged.

`apps/api/src/json-intake/stickerpress-lift-configuration.ts` prepares the configuration and provides an explicit test-receipt preview binding. It maps all lines to the one product independently of source SKU, variation, shape and optional material code. It preserves source product text as description, source line ID, customer SKU, quantity, dimensions, cut evidence, approvals and optional prices. `finish` maps to `production.laminate`; exact material/laminate strings pass through. Original artwork checksums remain unchanged. Source download URLs are excluded pending publication of retained originals.

The binding is restricted to customer 174094, integration `stickerpress-sandbox`, store `ltlco`, environment `test`, the new route, and product 374549. It is a local preview helper, not a deployed receipt-to-job integration. Saving the product map alone does not make the existing generic import resolver apply it to arbitrary source keys.

Validation completed:

- API TypeScript check passed.
- 11 focused template/configuration tests passed, including preservation of existing configuration, PO independence, customer/route isolation, and single-product mapping with absent material code.
- Actual receipt `SPM-D2611133` rendered three lines using the saved mapping and passed Lift payload preview validation.
- Consistent DynamoDB reads verified all three records and unchanged existing settings.
- Refreshed Pathfinder UI shows both templates, the new customer route with one identifier-ready mapping, and **151 of 151 fields mapped** in Lift Ecomm Orders (146 body + 5 headers).

Private before/after records, the conditional transaction, generated template, actual-order preview and verification report are under ignored `outputs/lift-ecomm-template-2026-10-16/`. These may contain customer information and must not be committed.

## Remaining import-test work

Keep template and route in Draft until the receipt-to-job path uses the saved route/template/product binding and publishes retained production PDFs. The current sandbox receipt store is separate from normal Pathfinder jobs. The generic XLSX/Wrike path does not automatically apply the ecommerce projection simply because this template exists.

Next, connect the receipt through the reviewed job/submission path, verify the resolved request uses the agreed ecommerce shape and current connection, perform one controlled Lift import, reconcile its EXT_ID, and capture the actual Lift association. Confirmation and shipping callbacks require their authoritative source wiring; the successful receipt callback is not proof of Lift submission.

## Scoped rollback

Re-read current target, route, product map and references. If still unused Draft configuration, remove only the new template from the current target and only the two new scoped route/product records, conditioned on their exact current values. Check all route/import-method/job references before removal. Preserve any intervening target edits; do not restore the entire historical snapshot. If the route has been used or activated, disable only the new route and review its jobs before any removal. Existing connection settings and High End Work records are not rollback targets.

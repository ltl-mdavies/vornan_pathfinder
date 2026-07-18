# Canonical Order Field Dictionary

This dictionary lists the values currently available to output templates. Output templates can map detected body/header fields to these Canonical Order values, environment values, route values, generated values, or static pasted values.

## Customer

| Field | Meaning | Notes |
| --- | --- | --- |
| `customer.id` | Pathfinder source customer id | Usually `lift:{LiftCustomerID}` for Lift-backed customers. Preserves source workspace identity during sandbox submit. |
| `customer.name` | Submit customer name | In sandbox mode this can be `LTL Demo`; source customer remains available under `source.source_customer`. |
| `customer.lift_customer_id` | Destination Lift customer id | This is the customer id submitted to Lift. Sandbox submit uses `1249`. |

## Source

| Field | Meaning | Notes |
| --- | --- | --- |
| `source.source_system` | Input/source system name | Example: `Manual XLSX Upload`. |
| `source.source_customer` | Original selected customer workspace name | Useful for audit when submit customer differs. |
| `source.source_record_id` | Source order/document id | Usually mapped from customer order number or contract/order id. |
| `source.source_record_url` | Link back to source record | Optional. |
| `source.source_template` | Import method/template name | Optional but useful for audit. |
| `source.submitted_at` | Canonical submit/preview timestamp | Generated during preview/job creation. |

## Order

| Field | Meaning | Notes |
| --- | --- | --- |
| `order.external_order_id` | External order id | Lift body `order.ext_id`; must match Lift header `Ext_ID`. |
| `order.po_number` | Customer PO number | Optional. |
| `order.contract_number` | Contract/reference number | Optional. |
| `order.order_title` | Human-readable order title | Optional. |
| `order.order_note` | Order-level note | Optional. |
| `order.ship_date` | Requested ship date | Optional. |

## Order Shipping

| Field | Meaning |
| --- | --- |
| `order.shipping.method` | Shipping method |
| `order.shipping.account_number` | Shipping account number |
| `order.shipping.attention_to` | Ship-to attention |
| `order.shipping.company` | Ship-to company |
| `order.shipping.address_1` | Ship-to address line 1 |
| `order.shipping.address_2` | Ship-to address line 2 |
| `order.shipping.city` | Ship-to city |
| `order.shipping.state` | Ship-to state |
| `order.shipping.postal_code` | Ship-to postal code |
| `order.shipping.country` | Ship-to country |
| `order.shipping.phone` | Ship-to phone |
| `order.shipping.email` | Ship-to email |
| `order.shipping.instructions` | Shipping instructions |

## Lines

Use `lines[]` fields for repeatable order lines. The template should contain one representative `lines` object; Pathfinder renders one object for each canonical line.

| Field | Meaning | Notes |
| --- | --- | --- |
| `lines[].line_number` | Line sequence number | Generated per line. |
| `lines[].unit_number` | Target product identifier | For Lift route this is the resolved Lift `unit_number`. |
| `lines[].customer_sku` | Customer SKU or generated product key | May hold derived key when customer provides no SKU. |
| `lines[].description` | Line description | Optional. |
| `lines[].product_name` | Product/display name | Optional but useful. |
| `lines[].quantity` | Line quantity | Required. |
| `lines[].line_note` | Line-level note | Optional. |

## Line Artwork

| Field | Meaning |
| --- | --- |
| `lines[].artwork.file_name` | Artwork filename |
| `lines[].artwork.file_url` | Artwork URL |
| `lines[].artwork.checksum` | Artwork checksum |

## Line Dimensions

| Field | Meaning |
| --- | --- |
| `lines[].dimensions.final_width` | Final width |
| `lines[].dimensions.final_height` | Final height |
| `lines[].dimensions.live_width` | Live width |
| `lines[].dimensions.live_height` | Live height |
| `lines[].dimensions.bleed` | Bleed |

## Line Production

| Field | Meaning |
| --- | --- |
| `lines[].production.material` | Material |
| `lines[].production.laminate` | Laminate |
| `lines[].production.coating` | Coating |
| `lines[].production.premask` | Premask |
| `lines[].production.ink` | Ink |
| `lines[].production.cut_type` | Cut type |
| `lines[].production.hem` | Hem flag/value |
| `lines[].production.grommets` | Grommet flag/value |

## Line Shipping Override

Line shipping fields are optional overrides when a line ships somewhere different from the order-level ship-to.

| Field | Meaning |
| --- | --- |
| `lines[].shipping.method` | Line shipping method |
| `lines[].shipping.account_number` | Line shipping account number |
| `lines[].shipping.attention_to` | Line ship-to attention |
| `lines[].shipping.company` | Line ship-to company |
| `lines[].shipping.address_1` | Line address 1 |
| `lines[].shipping.address_2` | Line address 2 |
| `lines[].shipping.city` | Line city |
| `lines[].shipping.state` | Line state |
| `lines[].shipping.postal_code` | Line postal code |
| `lines[].shipping.country` | Line country |
| `lines[].shipping.phone` | Line phone |
| `lines[].shipping.email` | Line email |
| `lines[].shipping.instructions` | Line instructions |

## Environment Values

| Field | Meaning |
| --- | --- |
| `environment.credentials.User` | Import/API username |
| `environment.credentials.Password` | Import/API password, masked in responses |
| `environment.credentials.token` | Bearer token or target token |
| `environment.credentials.api_key` | API key |
| `environment.headers.Company` | Lift Company header, currently `91` for Larger Than Life |
| `environment.endpoint_url` | Active endpoint URL |

## Output Route Values

| Field | Meaning |
| --- | --- |
| `route.company_id` | Output route company id |
| `route.destination_account_id` | Route destination account id |
| `route.destination_account_name` | Route destination account name |

## Generated Values

| Field | Meaning |
| --- | --- |
| `generated.submitted_at` | Render/submit timestamp |
| `generated.pathfinder_job_id` | Pathfinder processing job id |
| `generated.pathfinder_canonical_order_id` | Pathfinder canonical order id |
| `generated.filename` | Rendered output filename |

## Static Values

Use static values only when the value should literally stay the same for every rendered order.

Good static examples:

- `source.platform = "Pathfinder"`
- `Content-Type = "application/json"`

Avoid static values for customer ids, order ids, job ids, unit numbers, quantities, or endpoint credentials.

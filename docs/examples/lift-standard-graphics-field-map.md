# Lift Standard Graphics Order JSON Field Map

This companion note describes the sample payload in `lift-standard-graphics-order.sample.json`. The file is intended for Lift interface mapping review, not as a final confirmed Lift API contract.

Lift submission has two parts:

1. HTTP request headers and target configuration used by the Lift import endpoint.
2. JSON request body containing the order header, shipping, and line data.

Credentials and environment URLs should not be placed in the JSON body. They belong in the Lift target admin panel.

## Lift Request Configuration

These values should be configured in the Pathfinder Lift target admin panel.

| Setting | Required | Source / Behavior |
| --- | --- | --- |
| `prod_endpoint_url` | Yes | `http://prod-lifterp/lifterp/ords/lifterp/lift/erp/api/create_order` |
| `qa1_endpoint_url` | Yes | Provided as `http://devcompute/lifterp-qa1/lifterp/liftqa1/erp/api/create_orde`; confirm whether the final path should be `create_order`. |
| `active_environment` | Yes | `PROD` or `QA1`. |
| `company_id` | Yes | `91` for the LTL/Lift company receiving orders. |
| `import_username` | Yes | Lift import username. Store in target config. |
| `import_password` | Yes | Lift import password. Store as a secret, never in visible JSON/exported templates. |
| `ext_id_strategy` | Yes | Choose which source order field populates `order.ext_id`; the `Ext_ID` header must then use the exact same value. |

## Lift HTTP Headers

The Lift adapter should send the following headers when submitting an order:

| Header | Example | Notes |
| --- | --- | --- |
| `Content-Type` | `application/json` | Static. |
| `Ext_ID` | `AS360-30904511` | Per-order value. Must exactly match `order.ext_id` in the JSON body. |
| `User` | `LIFT_IMPORT_USERNAME` | From Lift target admin panel. |
| `Password` | `LIFT_IMPORT_PASSWORD` | From secure Lift target admin panel secret storage. |
| `Company ID` | `91` | From Lift target admin panel. |

Recommended request construction:

```text
POST {active Lift endpoint URL}
Content-Type: application/json
Ext_ID: {order.ext_id}
User: {import_username}
Password: {import_password secret}
Company ID: {company_id}

{Lift order JSON body}
```

## Payload Sections

| Section | Purpose |
| --- | --- |
| `customer` | Customer identity used by Pathfinder and Lift. |
| `contacts[]` | Order/customer contact details available for Lift-side mapping. |
| `source` | Immutable Pathfinder/source metadata for traceability. |
| `order` | Order-level header, PO, requested ship date, notes, and default shipping. |
| `lines[]` | Production line items to create in Lift Standard Graphics. |

## Header Fields

| JSON Path | Required | Notes |
| --- | --- | --- |
| `customer.lift_customer_id` | Yes | Lift-specific customer/account identifier. This is the value Lift should use to attach the order to the correct Lift customer. |
| `customer.customer_name` | Recommended | Human-readable customer name for review/debugging. Lift may ignore this if `lift_customer_id` is authoritative. |
| `customer.crm_id` | Optional | Customer CRM/reference ID when provided by the source or customer setup. |
| `contacts[].first_name` | Optional | Contact first name. |
| `contacts[].last_name` | Optional | Contact last name. |
| `contacts[].title` | Optional | Contact title/role. |
| `contacts[].email` | Optional | Contact email. |
| `contacts[].mobile_phone` | Optional | Contact mobile phone. |
| `contacts[].office_phone` | Optional | Contact office phone. |
| `contacts[].home_phone` | Optional | Contact home phone. |
| `contacts[].slack` | Optional | Contact Slack handle or identifier. |
| `contacts[].fax` | Optional | Contact fax number. |
| `source.platform` | Yes | Always `Pathfinder`. |
| `source.pathfinder_customer_id` | Yes | Internal Pathfinder customer/configuration ID for audit and replay. This is not intended to be mapped as the Lift customer ID. |
| `source.source_system` | Yes | Manual Upload, Wrike, Excel Upload, API, etc. |
| `source.source_record_id` | Yes | External source order/task ID. |
| `source.pathfinder_job_id` | Yes | Processing job ID for audit/replay. |
| `order.ext_id` | Yes | Customer/source order identifier sent to Lift. Must exactly match the `Ext_ID` request header. Recommended source is Pathfinder's canonical `order.external_order_id`, with configured fallbacks such as `order.contract_number` or `order.po_number`. |
| `order.po_number` | Customer policy | Customer PO. |
| `order.contract_number` | Optional | Campaign, contract, or reference number. |
| `order.order_title` | Optional | Human-readable order title. |
| `order.requested_ship_date` | Customer policy | ISO date, `YYYY-MM-DD`. |
| `order.due_date` | Customer policy | Due date requested for the order, distinct from requested ship date when needed. |
| `order.order_attachment` | Optional | Link/reference to the imported source file that generated the order. |
| `order.shipping` | Customer policy | Default ship-to inherited by lines unless line shipping is supplied. |
| `order.shipping.acct_billing_zip` | Optional | Billing ZIP/postal code associated with the shipping account. |
| `order.shipping.acct_billing_country` | Optional | Billing country associated with the shipping account. |

## Line Fields

| JSON Path | Required | Notes |
| --- | --- | --- |
| `lines[].line_number` | Yes | 1-based line number. |
| `lines[].unit_number` | Yes | Product/unit identifier sent to Lift. Pathfinder product mapping should resolve to this value before payload generation. |
| `lines[].customer_sku` | Recommended | Original customer SKU or product code. |
| `lines[].description` | Recommended | Product description. |
| `lines[].product_id` | Optional | Product/catalog identifier separate from unit number, customer SKU, and display name. |
| `lines[].product_name` | Recommended | Product display name. Often same as `description`, but available separately if Lift maps name and description differently. |
| `lines[].quantity` | Yes | Positive integer. |
| `lines[].artwork.file_name` | Customer policy | Artwork filename. |
| `lines[].artwork.file_url` | Customer policy | Artwork URL/reference. |
| `lines[].dimensions.final_height` | Yes | Inches. |
| `lines[].dimensions.final_width` | Yes | Inches. |
| `lines[].production.material` | Customer policy | Material/substrate. |
| `lines[].production.laminate` | Customer policy | Laminate value if applicable. |
| `lines[].production.coating` | Customer policy | Example default: `N`. |
| `lines[].production.premask` | Customer policy | Example default: `N`. |
| `lines[].production.ink` | Customer policy | Example: `4CP/0`. |
| `lines[].production.cut_type` | Customer policy | Example: `Square Cut`. |
| `lines[].shipping` | Optional | Line-level ship-to override. `null` means use `order.shipping`. |
| `lines[].line_note` | Optional | Line-specific note. |

## Questions For Lift Mapping Review

1. Confirm the QA1 endpoint path: is it `create_orde` or `create_order`?
2. Confirm the exact spelling/casing of the `Company ID` header.
3. Confirm whether `Ext_ID` / `order.ext_id` is Lift's idempotency/duplicate-prevention key.
4. What exact Lift field name should receive `customer.lift_customer_id` if it is also required in the body?
5. Does Lift require separate order header and line payloads, or one nested JSON document?
6. Confirm that `unit_number` is the authoritative Lift product identifier, or provide the preferred Lift product key name.
7. Are artwork URLs accepted directly, or must files be uploaded separately?
8. Which production fields are required by Lift Standard Graphics for order creation?
9. Are line-level shipping overrides supported?
10. What success/error response shape should the Pathfinder adapter normalize?

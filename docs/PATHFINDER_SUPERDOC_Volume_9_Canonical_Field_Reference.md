
# PATHFINDER SUPERDOC
## Volume IX — Canonical Order Schema Reference & Field Dictionary
**Version:** 1.0 Draft

---

# 1. Purpose

This document serves as the authoritative field-by-field reference for the Pathfinder Canonical Order Schema.

Where previous volumes describe architecture and behavior, this volume defines every object, field, data type, validation rule, ownership, and intended usage.

The Canonical Order is the contract between every input adapter and every destination adapter.

---

# ADR-017 — Canonical Contract Ownership

**Status:** Accepted

The Canonical Order Schema is owned by Pathfinder.

Neither source systems nor destination systems may dictate the internal structure of the Canonical Order.

Changes require versioning and architectural review.

---

# 2. Canonical Schema (v1)

```json
{
  "customer": {},
  "source": {},
  "target": {},
  "order": {},
  "lines": []
}
```

---

# 3. customer Object

| Field | Type | Required | Description |
|------|------|:-------:|-------------|
| customer_id | string | ✓ | Internal Pathfinder customer identifier |
| customer_name | string | ✓ | Display name used throughout the platform |

Rules:

- Assigned by Pathfinder.
- Immutable during processing.

---

# 4. source Object

| Field | Type | Required | Description |
|------|------|:-------:|-------------|
| source_system | string | ✓ | Originating system (Wrike, Portal, API, etc.) |
| source_customer | string | | Customer name in source system |
| source_record_id | string | ✓ | External identifier |
| source_record_url | string | | Optional deep link |
| source_template | string | ✓ | Template used for translation |
| submitted_at | datetime | ✓ | Intake timestamp |

Rules:

- Never modified after intake.
- Preserved for traceability.

---

# 5. target Object

| Field | Type | Required | Description |
|------|------|:-------:|-------------|
| target_system | string | ✓ | Destination adapter |

Examples:

- Lift Graphics
- Lift Labels
- ThinkDifferentPrint
- Shopify

---

# 6. order Object

Primary order-level information.

Fields:

| Field | Type | Required |
|------|------|:-------:|
| external_order_id | string | ✓ |
| po_number | string | |
| contract_number | string | |
| order_title | string | |
| order_note | string | |
| ship_date | date | |
| shipping | object | |

Rules:

- external_order_id should uniquely identify the source order.
- ship_date represents requested shipment.

---

# 7. shipping Object

| Field | Type |
|------|------|
| method | string |
| account_number | string |
| attention_to | string |
| company | string |
| address_1 | string |
| address_2 | string |
| city | string |
| state | string |
| postal_code | string |
| country | string |
| phone | string |
| email | string |
| instructions | string |

Order-level shipping applies to all lines unless overridden.

---

# 8. lines Collection

Each line represents one producible item.

Each line contains:

- line_number
- unit_number
- description
- quantity
- artwork
- dimensions
- production
- shipping (optional)
- line_note

---

# 9. unit_number

The canonical product identifier.

Reason:

Existing Lift integrations already resolve products using Unit Number.

Every customer mapping ultimately resolves to Unit Number.

Destination adapters may further translate if required.

---

# 10. artwork Object

| Field | Type |
|------|------|
| file_name | string |
| file_url | string |

Future versions may include:

- checksum
- page_count
- approval_status
- thumbnail

---

# 11. dimensions Object

| Field | Type |
|------|------|
| final_height | decimal |
| final_width | decimal |
| live_height | decimal |
| live_width | decimal |
| bleed | decimal |

Rules:

- Final dimensions represent finished production size.
- Live dimensions are optional.
- Bleed is expressed in inches.

---

# 12. production Object

| Field |
|------|
| material |
| laminate |
| coating |
| premask |
| ink |
| cut_type |

Future additions:

- grommets
- hem
- eyelets
- mounting
- substrate_thickness
- print_mode

---

# 13. Line Shipping

Optional.

If populated it overrides order.shipping for that line only.

Otherwise order.shipping is inherited.

---

# 14. Versioning Strategy

Canonical Schema Version

Major version:
Breaking changes.

Minor version:
Backward compatible additions.

Patch:
Documentation or validation clarification.

Historical processing jobs retain the schema version used during translation.

---

# ADR-018 — Backward Compatibility

Canonical schema changes should favor additive evolution.

Existing connectors should continue functioning without modification whenever possible.

Breaking changes require a new major schema version.

---

# 15. Design Goals

The Canonical Order should remain:

- Small
- Stable
- Readable
- Extensible
- Destination agnostic
- Customer agnostic

If a proposed field only serves one destination or one customer, it should be implemented in an adapter rather than the Canonical Schema.

---
End of Volume IX

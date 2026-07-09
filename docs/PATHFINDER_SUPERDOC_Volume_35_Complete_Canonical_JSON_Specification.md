
# PATHFINDER SUPERDOC
## Volume XXXV — Complete Canonical JSON Specification
**Version:** 1.0 Draft

---

# 1. Purpose

This document is the definitive specification for the Pathfinder Canonical Order JSON. It supplements the architectural volumes by defining every object, field, datatype, validation rule, default behavior, and ownership.

This document should be considered the primary contract between all Pathfinder connectors and destination adapters.

---

# 2. Canonical Object

```text
CanonicalOrder
├── customer
├── source
├── target
├── order
│   └── shipping
└── lines[]
    ├── artwork
    ├── dimensions
    ├── production
    └── shipping (optional)
```

---

# 3. Full Canonical Example

```json
{
  "customer": {
    "customer_id": "1249",
    "customer_name": "Momentara"
  },
  "source": {
    "source_system": "Wrike",
    "source_customer": "Momentara",
    "source_record_id": "AS360-30904511",
    "source_record_url": null,
    "source_template": "Momentara OOH Order Form",
    "submitted_at": "2026-06-18T14:32:00-04:00"
  },
  "target": {
    "target_system": "Lift Graphics"
  },
  "order": {
    "external_order_id": "AS360-30904511",
    "po_number": "1122334455",
    "contract_number": "1122334455",
    "order_title": "Campaign",
    "order_note": null,
    "ship_date": "2026-06-23",
    "shipping": {
      "method": "UPS Ground",
      "account_number": null,
      "attention_to": null,
      "company": "Example Company",
      "address_1": "123 Main St",
      "address_2": null,
      "city": "Cincinnati",
      "state": "OH",
      "postal_code": "45202",
      "country": "US",
      "phone": null,
      "email": null,
      "instructions": null
    }
  },
  "lines": [
    {
      "line_number": 1,
      "unit_number": "2SHEET_46x60_48PT",
      "description": "2 Sheet Poster",
      "quantity": 1,
      "artwork": {
        "file_name": "art.pdf",
        "file_url": "https://example.com/art.pdf"
      },
      "dimensions": {
        "final_height": 46.2,
        "final_width": 60.2,
        "live_height": 43,
        "live_width": 57,
        "bleed": 0.125
      },
      "production": {
        "material": "15pt Styrene",
        "laminate": "8520",
        "coating": "N",
        "premask": "N",
        "ink": "4CP/0",
        "cut_type": "Square Cut"
      },
      "shipping": null,
      "line_note": null
    }
  ]
}
```

---

# 4. Field Dictionary

## customer.customer_id

Type: string

Required: Yes

Owner: Pathfinder

Description: Internal customer identifier used to resolve templates, mappings, routes, validation profiles, and destinations.

---

## customer.customer_name

Type: string

Required: Yes

Human-readable customer name.

---

## source.*

Purpose: Immutable metadata describing the origin of the order.

These fields are never modified after intake.

---

## target.target_system

Defines the intended destination adapter.

Examples:

- Lift Graphics
- Lift Labels
- ThinkDifferentPrint

---

## order.external_order_id

Unique identifier supplied by the originating system.

Required.

Must remain unique per customer.

---

## order.po_number

Optional customer purchase order.

Validation controlled by customer profile.

---

## order.contract_number

Optional external campaign or contract identifier.

---

## order.ship_date

Requested shipment date.

ISO-8601 preferred.

---

## order.shipping

Default shipping object inherited by all order lines unless overridden.

---

## lines[].unit_number

Canonical product identifier.

Required.

Resolved through customer product mappings.

This value intentionally aligns with Lift Unit Numbers.

---

## lines[].quantity

Positive integer.

Must be greater than zero.

---

## lines[].artwork

References production artwork.

Pathfinder stores references rather than embedding binary data.

---

## lines[].dimensions

All dimensional values are stored in inches.

Required:

- final_width
- final_height

Optional:

- live_width
- live_height
- bleed

---

## lines[].production

Production attributes used by destination adapters.

Unknown values should generate validation warnings or failures depending on customer policy.

---

# 5. Validation Matrix

Required Objects

✓ customer

✓ source

✓ target

✓ order

✓ lines

Required Line Fields

✓ unit_number

✓ quantity

✓ dimensions.final_width

✓ dimensions.final_height

---

# ADR-057 — Canonical Contract Preservation

Changes to this document require:

- Architecture review
- Version increment
- Connector compatibility review
- Destination adapter compatibility review

This document is the authoritative Canonical JSON contract.

---
End of Volume XXXV

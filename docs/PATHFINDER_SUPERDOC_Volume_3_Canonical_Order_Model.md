
# PATHFINDER SUPERDOC
## Volume III — Canonical Order Model & Data Architecture
**Version:** 1.0 Draft

---

# 1. Purpose

The Canonical Order Model (COM) is the single most important component within Pathfinder.

Every supported input system—regardless of technology, terminology, or data structure—must first become a Canonical Order before any validation, business rules, routing, or output generation occurs.

Likewise, every destination adapter receives a Canonical Order and is responsible for translating it into the destination system's required format.

This architecture eliminates pairwise integrations.

Instead of building:

```
Wrike -> Lift
Wrike -> Shopify
Excel -> Lift
Excel -> Shopify
Monday -> Lift
Monday -> Shopify
```

Pathfinder requires only:

```
Any Input
    ↓
Canonical Order
    ↓
Any Output
```

The Canonical Order therefore becomes the platform contract that every connector must obey.

---

# ADR-004 — Canonical Order Stability

**Status:** Accepted

## Decision

The Canonical Order Schema shall change only when required to support capabilities common across multiple integrations.

Destination-specific fields shall never be added to the Canonical Order.

## Rationale

The Canonical Order is the platform contract.

Frequent schema changes increase maintenance costs across every connector.

Destination-specific concerns belong inside output adapters.

---

# 2. Design Principles

The Canonical Order shall be:

- Human readable
- JSON based
- Versionable
- Self-describing
- Platform independent
- Future proof

It shall not contain Lift-specific, Wrike-specific, or UI-specific concepts.

---

# 3. Canonical Object Hierarchy

```
Canonical Order
├── Customer
├── Source
├── Target
├── Order
│   ├── Shipping
│   └── Metadata
└── Lines
    ├── Artwork
    ├── Dimensions
    ├── Production
    └── Shipping (optional)
```

---

# 4. Customer Object

Purpose:

Represents the customer inside Pathfinder.

```json
{
  "customer": {
    "customer_id": "1249",
    "customer_name": "Momentara"
  }
}
```

## customer_id

Internal Pathfinder identifier used to load:

- Templates
- Product mappings
- Routes
- Connectors
- Business rules

Required: Yes

## customer_name

Human readable customer name.

Required: Yes

---

# 5. Source Object

Purpose:

Captures immutable information about where the order originated.

```json
{
  "source": {
    "source_system": "Wrike",
    "source_customer": "Momentara",
    "source_record_id": "AS360-30904511",
    "source_record_url": null,
    "source_template": "Momentara OOH Order Form",
    "submitted_at": "2026-06-18T14:32:00-04:00"
  }
}
```

Field definitions:

- source_system
- source_customer
- source_record_id
- source_record_url
- source_template
- submitted_at

These values are immutable after intake and provide full traceability back to the originating system.

---

# 6. Guiding Rule

Every connector translates **into** the Canonical Order.

Every destination translates **from** the Canonical Order.

No connector may bypass the Canonical Order.

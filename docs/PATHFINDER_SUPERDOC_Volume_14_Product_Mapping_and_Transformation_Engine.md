
# PATHFINDER SUPERDOC
## Volume XIV — Product Mapping Engine, Transformation Rules & Business Logic
**Version:** 1.0 Draft

---

# 1. Purpose

This volume defines how Pathfinder transforms customer-specific order data into production-ready Canonical Orders through deterministic mappings, lookup tables, enrichment rules, and business logic.

The Mapping Engine is responsible for translating data—not interpreting business intent. Every transformation must be explainable, repeatable, and auditable.

---

# ADR-025 — Deterministic Transformation

**Status:** Accepted

Every transformation performed by Pathfinder shall be deterministic.

Given the same input, template version, mapping tables, and business rules, Pathfinder must always generate the same Canonical Order.

---

# 2. Transformation Pipeline

```
Raw Source
    ↓
Template Mapping
    ↓
Field Transformations
    ↓
Lookup Resolution
    ↓
Default Values
    ↓
Business Rules
    ↓
Canonical Order
```

Each stage emits a transformation event.

---

# 3. Transformation Types

Supported transformation types include:

- Direct field mapping
- Constant values
- String manipulation
- Date parsing
- Numeric conversion
- Unit conversion
- Lookup table
- Conditional expressions
- Concatenation
- Split values
- Multi-column composition

Example:

Customer Column:

```
Width = 46
Height = 60
```

Canonical:

```
dimensions.final_width
dimensions.final_height
```

---

# 4. Lookup Tables

Lookup tables normalize customer terminology.

Examples:

Material

```
20PT STY
20 pt Styrene
20PT Styrene

↓

20pt Styrene
```

Cut Type

```
Square
Sq Cut
Square Cut

↓

Square Cut
```

---

# 5. Product Mapping Strategy

Current production strategy:

Customer SKU

↓

Pathfinder Unit Number

↓

Lift Unit Number

Product mappings are customer-specific.

No assumptions should be made from product descriptions.

---

# 6. Default Value Engine

Templates may define default values.

Examples:

Default Shipping Method

UPS Ground

Default Ink

4CP/0

Default Coating

N

Default Premask

N

Defaults execute after mapping and before validation.

---

# 7. Conditional Rules

Examples

IF

Material = Banner

THEN

Default Hem = Yes

IF

Customer = Momentara

AND

Ship Method Empty

THEN

UPS Ground

Rules are evaluated in order.

---

# 8. Enrichment

Enrichment augments the Canonical Order without changing source intent.

Examples:

- Customer defaults
- Shipping defaults
- Standard notes
- Internal references
- Routing metadata

Enrichment should never overwrite explicit customer data unless configured.

---

# 9. Mapping Diagnostics

The engine should expose diagnostics.

Examples:

Mapped Fields

Unmapped Fields

Defaulted Fields

Lookup Failures

Unknown Values

Deprecated Values

These diagnostics appear during Translation Preview.

---

# 10. Mapping Health

Recommended metrics:

- Mapping Coverage
- Unknown Products
- Unknown Materials
- Unknown Cut Types
- Lookup Misses
- Default Usage %

These metrics help identify onboarding improvements.

---

# ADR-026 — Explicit Over Implicit

When both a customer value and a configured default exist, the explicit customer value takes precedence unless a customer-specific business rule overrides it.

---

# 11. Future Enhancements

Potential capabilities:

- AI-assisted mapping suggestions
- Fuzzy product matching
- Historical mapping recommendations
- Confidence scoring
- Automatic lookup creation (approval required)

AI recommendations must never bypass deterministic validation.

---

# 12. Engineering Notes

The Mapping Engine should be implemented as an isolated package with no dependency on:

- Connectors
- Destination Adapters
- User Interface

Its only responsibility is transforming data into a valid Canonical Order.

---
End of Volume XIV

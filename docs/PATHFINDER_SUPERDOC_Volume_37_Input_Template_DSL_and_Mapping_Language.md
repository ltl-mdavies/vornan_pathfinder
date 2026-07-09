
# PATHFINDER SUPERDOC
## Volume XXXVII — Input Template DSL & Mapping Language Specification
**Version:** 1.0 Draft

---

# 1. Purpose

This document defines the Domain Specific Language (DSL) used by Pathfinder Input Templates. The DSL allows administrators to describe how customer-specific source data is translated into the Pathfinder Canonical Order without writing application code.

The DSL is intended to become the configuration language for every supported intake method including spreadsheets, CSV, JSON payloads, XML documents, APIs, and future connectors.

---

# ADR-060 — Templates Are Code-Free

**Status:** Accepted

Input Templates are executable configuration.

No customer-specific parsing logic shall be implemented in application code when the behavior can be represented by the template language.

---

# 2. Template Structure

Each template contains:

- Metadata
- Source Definition
- Parsing Rules
- Field Mappings
- Transformations
- Lookups
- Defaults
- Validation Overrides
- Publication Metadata

Suggested structure:

```yaml
template:
  name: Momentara OOH
  version: 1.0
  customer: Momentara
source:
  type: excel
mapping:
  ...
```

---

# 3. Source Definition

Supported source types:

- excel
- csv
- json
- xml
- api
- email
- manual-upload

Source metadata includes:

- worksheet
- header_row
- first_data_row
- end_condition
- encoding
- locale

---

# 4. Field Mapping Syntax

Simple mapping:

```
OPS SKU
    →
lines.unit_number
```

Nested mapping:

```
Ship Date
    →
order.ship_date
```

Array mapping:

```
Each Row
    →
lines[]
```

---

# 5. Transformation Functions

Built-in functions:

- trim()
- upper()
- lower()
- title()
- concat()
- split()
- replace()
- date()
- number()
- decimal()
- boolean()

Example

```
concat(Customer," - ",Campaign)
```

---

# 6. Lookup Functions

Lookups normalize customer terminology.

Example

```
lookup(material_lookup, Stock)
```

Returns

```
20pt Styrene
```

Unknown values may:

- warn
- fail
- default

depending on customer policy.

---

# 7. Default Values

Defaults execute after mapping.

Example

```
production.coating

default:

"N"
```

Defaults never overwrite explicit customer values unless configured by a business rule.

---

# 8. Conditional Expressions

Example

```
IF material == "Banner"

THEN

production.hem = true
```

Supported operators:

- ==
- !=
- >
- <
- >=
- <=
- AND
- OR

---

# 9. Template Testing

The editor should support:

- Sample upload
- Live translation
- Canonical preview
- Validation preview
- Destination preview

No destination submission occurs during testing.

---

# 10. Publication

Draft
↓

Validated
↓

Published
↓

Archived

Published templates are immutable.

---

# ADR-061 — Template Determinism

A published template must produce identical Canonical Orders when executed against identical source data.

Template execution shall be deterministic.

---

# 11. Certification

A production template must demonstrate:

- Successful parsing
- Complete required mappings
- Valid Canonical Order
- Zero unexpected transformations
- Successful destination payload generation

---

# 12. Future Extensions

Planned DSL capabilities:

- Regular expressions
- Custom reusable functions
- Named mapping fragments
- AI-generated mapping suggestions
- Cross-sheet references
- External lookup providers

All future additions must remain backward compatible.

---
End of Volume XXXVII

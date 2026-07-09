
# PATHFINDER SUPERDOC
## Volume XXXI — Canonical Order Translation Examples, Sample Payloads & Certification Suite
**Version:** 1.0 Draft

---

# 1. Purpose

This volume provides concrete implementation examples that should accompany every Pathfinder connector and destination adapter. It serves as both developer documentation and a regression certification suite.

Rather than describing architecture, this document demonstrates expected behavior using real-world examples.

---

# 2. Translation Philosophy

Every connector should be able to answer three questions:

1. What did the customer send?
2. What Canonical Order did Pathfinder create?
3. What destination payload was generated?

Certification requires all three artifacts.

---

# 3. Reference Translation Package

Every connector implementation should include:

- Sample source document
- Parsed field map
- Generated Canonical Order
- Validation report
- Destination payload
- Expected destination response

These assets become regression fixtures.

---

# 4. Example Translation Matrix

| Source Field | Canonical Field | Lift Output |
|--------------|-----------------|-------------|
| OPS SKU | lines.unit_number | unit_number |
| Print Qty | lines.quantity | quantity |
| Final Width | lines.dimensions.final_width | final_width |
| Final Height | lines.dimensions.final_height | final_height |
| Ship Date | order.ship_date | ship_date |

---

# 5. Translation Certification

Each template must pass the following tests:

## Header Parsing

- Correct worksheet selected
- Header row detected
- Required columns found

## Line Parsing

- Correct line count
- Quantities parsed
- Empty rows ignored

## Canonical Translation

- Required objects created
- Unit Numbers resolved
- Shipping generated
- Artwork references captured

## Destination Generation

- Payload valid
- Required fields present
- Customer resolved
- Submission accepted

---

# 6. Regression Library

Every production customer should maintain a regression library containing:

- Small order
- Large order
- Multiple ship-to order
- Missing artwork
- Invalid SKU
- Duplicate order
- Cancelled order
- Future enhancement examples

Regression tests execute automatically during deployment.

---

# 7. Certification Checklist

Connector

- Authentication
- Discovery
- Attachments
- Polling
- Error handling

Template

- Translation
- Defaults
- Transformations

Validation

- Pass
- Warning
- Failure

Destination

- Payload generation
- Submission
- Response handling

---

# ADR-049 — Example Driven Development

**Status:** Accepted

Every new connector and every new destination adapter must ship with executable reference examples.

Examples are treated as part of the implementation and become permanent regression assets.

---

# 8. Success Criteria

A developer unfamiliar with a connector should be able to:

1. Open the reference example.
2. Compare source, canonical, and destination artifacts.
3. Execute automated regression tests.
4. Verify identical output.

If these steps cannot be completed, the connector documentation is considered incomplete.

---
End of Volume XXXI

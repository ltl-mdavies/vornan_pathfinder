
# PATHFINDER SUPERDOC
## Volume XXXVI — Lift Destination Adapter Specification
**Version:** 1.0 Draft

---

# 1. Purpose

This document defines the Lift Standard Graphics Destination Adapter. It is the reference implementation for all future destination adapters and converts a validated Pathfinder Canonical Order into a Lift-compatible order payload.

---

# 2. Responsibilities

The Lift Adapter SHALL:

- Accept only validated Canonical Orders.
- Generate Lift Standard Graphics JSON.
- Resolve customer and Unit Numbers.
- Submit orders to Lift.
- Capture responses.
- Return normalized submission results.

The adapter SHALL NOT:

- Parse customer files.
- Execute validation.
- Modify the Canonical Order.
- Perform customer-specific logic.

---

# ADR-058 — Destination Isolation

**Status:** Accepted

Destination adapters consume Canonical Orders and produce destination payloads. They must remain isolated from connectors and template logic.

---

# 3. Inputs

Required:

- Canonical Order
- Published Output Template
- Destination configuration
- Authentication credentials

---

# 4. Output Contract

Primary structure:

```
customer
source
order
lines
```

Each line includes:

- unit_number
- description
- quantity
- artwork
- dimensions
- production
- optional shipping
- line_note

---

# 5. Product Resolution

The adapter resolves products using:

```
Canonical unit_number
        ↓
Lift Unit Number
        ↓
Lift Product
```

If no product is found, submission stops and returns a structured failure.

---

# 6. Submission Workflow

```
Canonical Order
      ↓
Generate Lift Payload
      ↓
Authenticate
      ↓
Submit
      ↓
Receive Response
      ↓
Persist Payload + Response
      ↓
Return Normalized Result
```

---

# 7. Response Normalization

Destination responses are normalized into:

- SUCCESS
- WARNING
- FAILED

Returned metadata:

- destination_order_id
- destination_reference
- response_time_ms
- submitted_at
- raw_response

---

# 8. Retry Policy

Automatic retry only for transient failures:

- Timeout
- Network interruption
- HTTP 429
- HTTP 503

Permanent failures:

- Unknown Unit Number
- Invalid Customer
- Invalid Payload

Permanent failures require operator intervention.

---

# 9. Logging

Every submission records:

- Processing Job
- Canonical Order Version
- Output Template Version
- Payload
- Response
- Duration
- Outcome

---

# 10. Certification

The Lift adapter is certified when it successfully:

- Creates a Lift Graphics order.
- Maps Unit Numbers correctly.
- Uploads artwork references.
- Preserves shipping information.
- Returns normalized responses.
- Supports replay without duplicate orders.

---

# ADR-059 — Reference Destination

The Lift Standard Graphics Adapter is the reference destination implementation. All future destination adapters should follow the same lifecycle, logging model, response normalization, and retry behavior.

---
End of Volume XXXVI

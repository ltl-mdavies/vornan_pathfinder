
# PATHFINDER SUPERDOC
## Volume XXXIX — Destination Adapter SDK & Certification Guide
**Version:** 1.0 Draft

---

# 1. Purpose

This volume defines the standard architecture for every Pathfinder destination adapter. Destination adapters consume validated Canonical Orders and transform them into destination-specific payloads while preserving the integrity of the Canonical Order.

---

# ADR-064 — Destination Adapter Purity

**Status:** Accepted

Destination adapters shall never modify Canonical Orders.

They are responsible only for:

- Payload generation
- Authentication
- Submission
- Response normalization
- Retry behavior
- Logging

---

# 2. Destination Adapter Interface

Required methods:

```
initialize()
authenticate()
generatePayload(canonicalOrder)
validatePayload(payload)
submit(payload)
normalizeResponse(response)
healthCheck()
```

Optional methods:

```
cancel()
update()
fetchStatus()
```

---

# 3. Processing Lifecycle

```
Canonical Order
      ↓
Generate Payload
      ↓
Validate Payload
      ↓
Authenticate
      ↓
Submit
      ↓
Receive Response
      ↓
Normalize Result
      ↓
Persist Submission
```

---

# 4. Payload Generation

Payload generation must be deterministic.

Inputs:

- Canonical Order
- Published Output Template
- Destination Configuration

Outputs:

- Destination Payload

No external lookups should modify the Canonical Order.

---

# 5. Response Normalization

Every adapter returns:

- SUCCESS
- WARNING
- FAILED

Metadata:

- destination_order_id
- destination_reference
- response_time_ms
- submitted_at
- raw_response

This allows the Administration Portal to present a consistent experience regardless of destination.

---

# 6. Retry Strategy

Transient Failures:

- Timeout
- 429
- 503
- Temporary network interruption

Permanent Failures:

- Invalid customer
- Invalid payload
- Unknown product
- Authentication rejected

Permanent failures enter the Retry Queue.

---

# 7. Adapter Certification

Every destination adapter must demonstrate:

- Payload generation
- Authentication
- Successful submission
- Response normalization
- Retry behavior
- Logging
- Audit generation

---

# 8. Destination Configuration

Each adapter stores:

- Name
- Version
- Authentication Type
- Endpoint
- Retry Policy
- Timeout
- Health Status

Configuration is versioned and immutable once published.

---

# ADR-065 — Adapter Replaceability

Destination adapters must be independently deployable and replaceable.

Replacing an adapter must not require modifications to:

- Connectors
- Processing Engine
- Validation Engine
- Canonical Order

---

# 9. Reference Adapters

Reference implementations:

- Lift Standard Graphics
- Lift Labels (future)
- Generic REST
- Shopify (future)

All future adapters should follow the same lifecycle and certification process.

---

# 10. Success Criteria

A destination adapter is production-ready when:

- It consumes Canonical Orders exclusively.
- It passes certification.
- It supports replay safely.
- It emits standardized responses.
- It requires no customer-specific logic.

---
End of Volume XXXIX


# PATHFINDER SUPERDOC
## Volume VIII — Lift Connector, Destination Adapters & MVP Implementation
**Version:** 1.0 Draft

---

# 1. Purpose

This volume specifies the first production destination adapter (Lift Standard Graphics) and defines the implementation strategy for the Pathfinder MVP.

The Lift connector serves as the reference implementation for all future destination adapters.

---

# ADR-015 — Destination Adapter Independence

**Status:** Accepted

Every destination adapter shall consume the Canonical Order and generate its own destination-specific payload.

No destination adapter may modify the Canonical Order.

---

# 2. Lift Standard Graphics Adapter

## Responsibilities

- Accept Canonical Order.
- Resolve customer and Unit Numbers.
- Generate Lift Standard Graphics JSON.
- Submit order through the Lift integration endpoint.
- Capture response.
- Return submission status.

The Lift adapter contains no customer-specific parsing logic.

---

# 3. Lift Output Contract

The Lift payload should remain intentionally simple.

Primary sections:

```
customer
source
order
lines
```

Each line contains:

- unit_number
- quantity
- description
- artwork
- dimensions
- production
- shipping (optional)
- line_note

Unit Number is the canonical product identifier used for Lift product resolution.

---

# 4. Destination Adapter Lifecycle

```
Canonical Order
      ↓
Generate Payload
      ↓
Authenticate
      ↓
Submit
      ↓
Receive Response
      ↓
Persist Response
      ↓
Return Result
```

---

# 5. Submission Responses

Every destination adapter should normalize responses into:

- SUCCESS
- WARNING
- FAILED

Returned metadata should include:

- destination_order_id
- response_time_ms
- raw_response
- submission_timestamp

---

# 6. Connector Health

Each connector and destination adapter exposes:

- Enabled
- Healthy
- Last Success
- Last Failure
- Consecutive Failures
- Average Runtime

Health is surfaced on the Administration Dashboard.

---

# 7. MVP Scope

## Included

- Customer Management
- Manual Customer Creation
- Manual Product Mapping
- Excel Upload
- Wrike Polling Connector
- Canonical Translation
- Validation Engine
- Lift Graphics Output Adapter
- Processing Queue
- Retry Queue
- Audit Log
- Customer Upload Portal
- Administration Portal

## Deferred

- AI Mapping
- Multiple Destinations
- Email Intake
- SFTP
- Shopify
- EFI
- OCR
- Automatic Template Detection
- Customer API Keys
- Webhook Callbacks

---

# 8. Recommended Development Phases

## Phase 1

Platform Foundation

- Authentication
- Database
- Customer Administration
- Templates
- Canonical Order
- Upload Portal

## Phase 2

Translation

- Excel Parser
- Mapping Engine
- Validation
- Product Resolution

## Phase 3

Lift Integration

- Lift Adapter
- Submission
- Logging
- Retry

## Phase 4

Wrike Connector

- Authentication
- Scheduled Polling
- Attachment Download
- Automatic Processing

## Phase 5

Operational Features

- Dashboard
- Metrics
- Retry Console
- Notifications

---

# 9. Coding Standards

- Configuration over code.
- Dependency injection where appropriate.
- Strong typing.
- Immutable Canonical Order objects.
- Structured logging.
- Unit tests for every transformation.
- Integration tests for every connector.

---

# 10. Repository Structure

```
/apps
  /admin
  /portal

/packages
  /canonical
  /connectors
  /adapters
  /validation
  /routing
  /templates
  /product-resolution
  /shared

/infrastructure

/docs

/tests
```

---

# ADR-016 — Reference Implementation

The Lift Standard Graphics adapter is the reference destination adapter.

Future adapters should mirror its structure and lifecycle to ensure consistency across the Pathfinder platform.

---

# 11. Long-Term Vision

Pathfinder becomes the integration backbone for the Vornan ecosystem.

External Systems

↓

Pathfinder

↓

Canonical Order

↓

Business Rules

↓

Destination Adapters

↓

Production Systems

Every new integration should be implemented by adding configuration and adapters rather than changing the core processing engine.

---
End of Volume VIII

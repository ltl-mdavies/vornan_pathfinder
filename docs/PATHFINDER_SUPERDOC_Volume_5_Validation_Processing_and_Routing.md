
# PATHFINDER SUPERDOC
## Volume V — Validation Engine, Processing Engine & Routing
**Version:** 1.0 Draft

---

# 1. Purpose

This volume defines the runtime behavior of Pathfinder after an order has been translated into the Canonical Order Schema.

The Processing Engine is responsible for orchestrating every step required to transform an incoming order into one or more successfully submitted destination orders while maintaining complete auditability and deterministic behavior.

---

# ADR-007 — Stateless Processing

**Status:** Accepted

Each processing stage shall receive a Canonical Order, perform a single responsibility, emit a result, and persist its outcome.

Processing stages must not depend on transient application state.

---

# 2. Processing Pipeline

```
Receive Order
    ↓
Archive Raw Payload
    ↓
Translate to Canonical
    ↓
Validate
    ↓
Resolve Products
    ↓
Apply Business Rules
    ↓
Generate Destination Payload(s)
    ↓
Submit
    ↓
Receive Response
    ↓
Update Status
    ↓
Audit & Notify
```

Every stage writes a processing event.

---

# 3. Processing Job

Every inbound order creates a Processing Job.

Suggested fields:

- job_id
- customer_id
- connector_id
- source_record_id
- canonical_order_id
- status
- priority
- created_at
- completed_at
- worker
- retry_count

Jobs are immutable except for status and runtime metadata.

---

# 4. Validation Engine

Validation occurs only against the Canonical Order.

Categories:

## Customer

- Customer exists
- Customer active
- Connector authorized

## Order

- External Order ID
- PO Number (optional by customer)
- Ship Date
- Shipping Address

## Line

- Unit Number
- Quantity > 0
- Material
- Dimensions
- Artwork

## Business

- Duplicate external order
- Duplicate PO
- Required customer references
- Route exists

Validation Result Types:

PASS

WARNING

FAIL

Warnings may continue automatically based on customer profile.

Failures stop processing.

---

# 5. Validation Messages

Each message contains:

- severity
- code
- object
- field
- message
- suggested_action

Example:

```
Severity: FAIL
Code: VAL-102
Field: lines[3].unit_number
Message: Unit Number not found.
Suggested Action: Create product mapping or correct source SKU.
```

---

# 6. Product Resolution

Purpose:

Resolve incoming Unit Numbers against configured customer mappings.

Workflow:

```
Incoming Unit Number
        ↓
Customer Mapping
        ↓
Lift Unit Number
        ↓
Resolved
```

Future enhancements:

- Alias support
- Retired mappings
- AI recommendations
- Similar product suggestions

---

# 7. Business Rules Engine

Business Rules execute after validation.

Examples:

- Default shipping method
- Default laminate
- Auto-populate coating
- Customer-specific notes
- Split oversized quantities
- Default destination

Rules must not modify source metadata.

Rules produce an enriched Canonical Order.

---

# 8. Routing Engine

Routing determines where an order is delivered.

A route consists of:

- Customer
- Destination
- Output Template
- Connector
- Retry Policy

Examples:

Momentara
→ Lift Graphics

Internal Sales Portal
→ Lift Labels

Distributor
→ Lift Graphics + Ecommerce

One Canonical Order may generate multiple destination payloads.

---

# 9. Submission Engine

Responsibilities:

- Generate destination payload
- Authenticate
- Submit
- Capture request
- Capture response
- Update Processing Job

Submission history must be retained.

---

# 10. Order States

Recommended lifecycle:

RECEIVED

RAW_ARCHIVED

CANONICAL_CREATED

VALIDATED

PRODUCTS_RESOLVED

READY

SUBMITTING

SUBMITTED

COMPLETED

FAILED

CANCELLED

ARCHIVED

Every transition produces an audit record.

---

# 11. Retry Behavior

Failures are classified as:

Transient

Examples:

- Timeout
- Network
- 503
- Rate limit

Permanent

Examples:

- Missing mapping
- Invalid payload
- Unknown customer

Transient failures may retry automatically.

Permanent failures require operator intervention.

---

# 12. Error Resolution Console

Operators may:

- View raw payload
- View canonical order
- View destination payload
- Edit mappings
- Correct metadata
- Revalidate
- Resubmit
- Cancel job

All operator actions are audited.

---

# 13. Notifications

Events capable of notification:

- Order received
- Validation failed
- Submitted
- Submission failed
- Retry exhausted
- Completed

Notification channels:

- Email
- Teams
- Slack
- Webhook
- Future SMS

Notifications are customer configurable.

---

# ADR-008 — Raw Payload Preservation

**Status:** Accepted

Every original submission shall be archived without modification.

The raw payload is the system of record for forensic analysis and troubleshooting.

Canonical Orders are derived artifacts.

---

# ADR-009 — Deterministic Processing

**Status:** Accepted

Reprocessing the same raw payload with the same template version and mapping configuration must produce the same Canonical Order.

This guarantees repeatability and simplifies debugging.

---
End of Volume V

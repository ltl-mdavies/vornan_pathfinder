
# PATHFINDER SUPERDOC
## Volume XXV — REST API Specification & Integration Contracts
**Version:** 1.0 Draft

---

# 1. Purpose

This volume defines the public API surface for Pathfinder. The API is intentionally resource-oriented and technology-agnostic so that customer systems, internal applications, and future connectors interact with Pathfinder through a stable contract.

The API exposes Pathfinder resources rather than destination-specific implementation details.

---

# ADR-041 — API First

**Status:** Accepted

Every major capability in Pathfinder should be available through the REST API before it is implemented in the Administration Portal or Customer Portal.

The web applications consume the same APIs available to external integrations.

---

# 2. Authentication

Supported methods:

- OAuth 2.0 (preferred)
- API Keys
- JWT (internal web apps)

Future:

- SAML
- OpenID Connect
- Customer SSO

---

# 3. Resource Overview

```
/customers
/connectors
/input-templates
/output-templates
/product-mappings
/routes
/orders
/processing-jobs
/attachments
/users
```

---

# 4. Orders API

## POST /orders

Creates a new processing job.

Supported request types:

- Canonical JSON
- Multipart upload
- Spreadsheet upload
- Future ZIP package

Response

```
{
  "job_id": "...",
  "status": "RECEIVED"
}
```

---

## GET /orders/{jobId}

Returns:

- Processing status
- Canonical summary
- Validation summary
- Destination summary

---

## GET /orders

Supports filtering:

- customer
- status
- source
- destination
- date range

Pagination required.

---

# 5. Processing Jobs API

## GET /processing-jobs

Displays operational queue.

## POST /processing-jobs/{jobId}/retry

Creates a new processing attempt.

## POST /processing-jobs/{jobId}/cancel

Cancels a waiting job.

---

# 6. Customers API

Operations

- List
- Create
- Update
- Disable
- Archive

Customer detail should include:

- Connectors
- Routes
- Templates
- Validation Profile
- Product Mapping

---

# 7. Product Mapping API

Endpoints

GET

POST

PATCH

DELETE

Bulk Import

Bulk Export

Validation

Suggested bulk upload format:

CSV

Customer SKU

↓

Unit Number

↓

Description

---

# 8. Template APIs

Input Templates

- List
- Create
- Publish
- Archive
- Test

Output Templates

- List
- Register
- Test

Publishing creates immutable versions.

---

# 9. Connector APIs

Operations

- Register
- Enable
- Disable
- Test
- Poll
- Health

Connector execution should also be invokable through background jobs.

---

# 10. Attachments

POST /attachments

Upload artwork or supporting documents.

GET /attachments/{id}

Download.

DELETE

Customer policy dependent.

---

# 11. Error Format

Standard response

```
{
  "success": false,
  "error": {
    "code": "VAL-102",
    "message": "Unit Number not found.",
    "details": {},
    "suggested_action": "Create or update product mapping."
  }
}
```

---

# ADR-042 — Stable Error Codes

Human-readable messages may evolve.

Error codes must remain stable.

Applications should integrate against codes rather than text.

---

# 12. Versioning

URI remains stable.

Schema versions are negotiated through headers.

Major changes require explicit version increments.

---

# 13. Webhooks (Future)

Outbound notifications

- Processing Completed
- Validation Failed
- Destination Submitted
- Destination Failed

Delivery should support retry with exponential backoff.

---

# 14. API Design Principles

- Stateless
- Idempotent where practical
- JSON-first
- Pagination by default
- Explicit filtering
- Structured errors
- Backward compatible evolution

---

# 15. Success Criteria

Every capability exposed by the Administration Portal and Customer Portal should be achievable through documented REST APIs.

The UI is a consumer of the API—not a privileged implementation.

---
End of Volume XXV

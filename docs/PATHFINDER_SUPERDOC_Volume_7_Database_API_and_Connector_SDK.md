
# PATHFINDER SUPERDOC
## Volume VII — Database Architecture, API Specification & Connector SDK
**Version:** 1.0 Draft

---

# 1. Purpose

This volume defines the persistent data model, public API philosophy, and connector framework that enables Pathfinder to support unlimited integrations without modifying the core processing engine.

---

# ADR-012 — Database as Operational Source of Truth

Status: Accepted

The Pathfinder database is the operational source of truth for customers, templates, mappings, processing jobs, logs and configuration.

Raw submissions and canonical orders are stored separately.

---

# 2. Logical Database Domains

## Configuration

- customers
- connectors
- connector_credentials
- routes
- input_templates
- output_templates
- validation_profiles
- notification_profiles

## Product Resolution

- product_mappings
- customer_products
- mapping_history

## Processing

- orders
- order_lines
- processing_jobs
- job_events
- submissions
- retries

## Storage

- attachments
- canonical_documents
- raw_documents

## Security

- users
- roles
- permissions
- api_keys

---

# 3. Suggested Entity Relationships

```
Customer
   │
   ├── Connectors
   ├── Input Templates
   ├── Routes
   ├── Validation Profile
   ├── Product Mapping
   └── Orders

Orders
   ├── Lines
   ├── Attachments
   ├── Processing Jobs
   ├── Audit Events
   └── Destination Submissions
```

---

# 4. Canonical Document Storage

Every processed order stores three artifacts:

1. Raw Submission
2. Canonical Order
3. Destination Payload(s)

This enables deterministic replay and auditing.

---

# 5. REST API Philosophy

All APIs are resource-oriented.

Example resources:

- /customers
- /orders
- /processing-jobs
- /templates
- /routes
- /connectors
- /product-mappings

Example actions:

GET

POST

PATCH

DELETE

No endpoint should expose destination-specific implementation details.

---

# 6. Connector SDK

Every connector implements the same interface.

Required methods:

- authenticate()
- discover()
- fetch()
- downloadAttachments()
- acknowledge()
- healthCheck()

Connectors never perform:

- validation
- routing
- destination payload generation

---

# 7. Output Adapter SDK

Required methods:

- generatePayload()
- authenticate()
- submit()
- interpretResponse()
- updateStatus()

Output adapters receive a Canonical Order and produce one destination payload.

---

# 8. Versioning

Templates, mappings and APIs are versioned independently.

Changes must not invalidate historical processing jobs.

---

# ADR-013 — Immutable Canonical Documents

Status: Accepted

Once a Canonical Order has been generated for a processing attempt it shall remain immutable.

Corrections create a new processing attempt rather than modifying history.

---

# 9. Security

Authentication:

- OAuth
- API Keys
- Basic Authentication (legacy)
- Future SSO

Authorization:

Role-based access control.

Connector credentials are encrypted at rest.

---

# 10. Observability

Every subsystem emits:

- structured logs
- processing metrics
- execution duration
- validation counts
- submission outcomes

Future integrations with CloudWatch, OpenTelemetry and Grafana should be supported.

---

# 11. Initial AWS Reference Architecture

- CloudFront
- S3
- API Gateway
- Lambda
- EventBridge
- SQS
- DynamoDB or PostgreSQL
- Secrets Manager
- CloudWatch

Future deployments should support containerized workers.

---

# ADR-014 — Adapter Isolation

Status: Accepted

Input connectors and output adapters shall be independently deployable.

A failure in one connector must not impact processing of unrelated customers or destinations.

---

End of Volume VII

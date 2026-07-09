
# PATHFINDER SUPERDOC
## Volume XXIV — Database Schema, Entity Definitions & Data Relationships
**Version:** 1.0 Draft

---

# 1. Purpose

This volume defines the logical data model for Pathfinder. It describes the entities that make up the platform, their relationships, ownership, lifecycle, and indexing strategy. It intentionally describes the logical schema rather than a specific SQL implementation so the storage engine may evolve without changing the platform architecture.

---

# ADR-039 — Data Ownership

**Status:** Accepted

Each domain object has a single system of record.

Examples:

- Customers are owned by Pathfinder.
- Canonical Orders are owned by Pathfinder.
- Source Orders remain owned by the source system.
- Destination Orders remain owned by the destination system.

Pathfinder stores references to external records but does not become their system of record.

---

# 2. Logical Domains

Configuration

- customers
- connectors
- routes
- input_templates
- output_templates
- validation_profiles
- notification_profiles

Processing

- processing_jobs
- canonical_orders
- canonical_order_lines
- submissions
- retries
- audit_events

Reference

- product_mappings
- lookup_tables
- transformation_rules

Security

- users
- roles
- permissions
- api_keys

Storage

- attachments
- raw_documents
- generated_payloads

---

# 3. Entity Relationship Overview

```
Customer
   ├── Connectors
   ├── Templates
   ├── Validation Profiles
   ├── Routes
   ├── Product Mappings
   └── Processing Jobs

Processing Job
   ├── Raw Document
   ├── Canonical Order
   ├── Audit Events
   ├── Submission(s)
   └── Attachments

Canonical Order
   └── Order Lines
```

---

# 4. customers

Purpose

Represents an organization configured to use Pathfinder.

Suggested Columns

- customer_id (PK)
- customer_name
- status
- onboarding_status
- default_destination
- created_at
- updated_at

Relationships

- One customer → many connectors
- One customer → many templates
- One customer → many mappings
- One customer → many processing jobs

---

# 5. connectors

Represents one intake connection.

Suggested Columns

- connector_id
- customer_id
- connector_type
- schedule
- enabled
- health
- configuration_json

---

# 6. input_templates

Stores versioned parsing templates.

Suggested Columns

- template_id
- customer_id
- version
- file_type
- worksheet
- mapping_definition_json
- status

Templates are immutable once published.

---

# 7. product_mappings

Purpose

Maps customer product identifiers to Pathfinder Unit Numbers.

Suggested Columns

- mapping_id
- customer_id
- customer_sku
- unit_number
- description
- active
- last_used_at

Indexes

(customer_id, customer_sku)

---

# 8. processing_jobs

Represents one execution of the processing pipeline.

Suggested Columns

- job_id
- customer_id
- connector_id
- status
- priority
- retry_count
- started_at
- completed_at

Indexes

(status)

(customer_id, status)

(created_at)

---

# 9. canonical_orders

Represents the immutable Canonical Order generated for a processing attempt.

Suggested Columns

- canonical_order_id
- job_id
- schema_version
- json_document
- created_at

Canonical Orders are immutable.

---

# 10. canonical_order_lines

Suggested Columns

- line_id
- canonical_order_id
- line_number
- unit_number
- quantity
- description

Future line-level analytics may reference this table without parsing JSON.

---

# 11. audit_events

Every meaningful action creates one immutable audit event.

Suggested Columns

- event_id
- job_id
- timestamp
- actor
- event_type
- details_json

---

# 12. attachments

Stores uploaded and downloaded files.

Suggested Columns

- attachment_id
- job_id
- filename
- mime_type
- storage_uri
- checksum
- uploaded_at

Attachments should reference object storage rather than storing binary data in the database.

---

# 13. generated_payloads

Stores destination-specific payloads.

Purpose

Support replay, diagnostics, and auditing.

Columns

- payload_id
- job_id
- destination
- payload_json
- response_json

---

# ADR-040 — Immutable Audit Trail

All audit records, canonical orders, destination payloads and raw submissions are append-only.

Historical processing must always remain reconstructable.

---

# 14. Indexing Strategy

Recommended indexes

processing_jobs

- status
- customer_id
- created_at

product_mappings

- customer_id + customer_sku
- unit_number

audit_events

- job_id
- timestamp

canonical_orders

- job_id

---

# 15. Data Retention

Recommended policy

Processing Jobs:
7 years

Audit Events:
7 years

Canonical Orders:
7 years

Raw Documents:
Customer configurable

Attachments:
Customer configurable

Metrics:
Indefinite aggregate retention

---

End of Volume XXIV

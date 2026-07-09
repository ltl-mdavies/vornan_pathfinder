# Pathfinder Master Engineering Specification

**Status:** Draft authoritative consolidation  
**Source corpus:** `docs/PATHFINDER_SUPERDOC_*` Volumes 1-50  
**Primary MVP:** Momentara / Wrike and Excel attachments -> Lift Standard Graphics  
**Primary contract:** Canonical Order Model

---

## 1. Purpose

Pathfinder is a universal order translation and routing platform. It eliminates duplicate order entry by allowing customers to submit print orders from many source systems and formats, translating those submissions into one shared Canonical Order, validating and resolving them once, and routing them into one or more destination systems.

This document consolidates the Pathfinder SUPERDOC volumes into a single authoritative engineering specification. It preserves the architectural decisions, implementation guidance, operational philosophy, schemas, APIs, lifecycle rules, UI requirements, and future expansion strategy while removing repeated material and normalizing terminology.

Pathfinder is not a one-off Wrike integration. The Wrike/Momentara/Lift implementation is the reference implementation for a reusable integration platform serving the broader Vornan/LTL ecosystem.

---

## 2. Architectural North Star

Pathfinder is built around one architectural rule:

> Every source submission is translated into the Canonical Order before validation, routing, or destination submission. Every destination adapter translates from the Canonical Order.

All reusable platform behavior occurs against the Canonical Order:

- validation
- product resolution
- routing
- auditing
- observability
- replay
- business rules
- operations workflows
- customer support workflows

Source-specific retrieval behavior belongs in connectors. Source-specific translation behavior belongs in input templates and the Translation Engine. Destination-specific behavior belongs in destination adapters and output templates. Customer-specific behavior belongs in versioned configuration.

### 2.1 Non-Negotiable Principles

- Canonical Order first.
- Configuration over code.
- Deterministic processing.
- Immutable audit history.
- Customer-agnostic architecture.
- Destination-agnostic architecture.
- Connector isolation.
- Destination adapter isolation.
- Product mapping through Lift Unit Numbers exposed as canonical `unit_number`.
- Version every configurable object.
- Replay rather than mutate.
- Preserve complete operational visibility.
- Build reusable platform capabilities instead of one-off customer integrations.

### 2.2 Design Bias When Decisions Are Ambiguous

When an implementation decision is ambiguous, prefer the option that:

- increases platform reuse,
- reduces coupling,
- keeps the processing engine small,
- moves customer-specific behavior into configuration,
- moves destination-specific behavior into adapters,
- preserves Canonical Order integrity,
- improves replayability and operational diagnosis.

---

## 3. Normalized Terminology

| Term | Meaning |
| --- | --- |
| Connector | Source-facing integration that discovers or receives raw source submissions and creates Processing Jobs. Connectors do not parse business data into canonical fields. |
| Input Template | Versioned executable configuration that maps source data into the Canonical Order. |
| Canonical Order | Pathfinder-owned internal order representation and platform contract. |
| Validation Profile | Versioned customer configuration that defines required fields, warnings, failure behavior, and customer-specific validation policy. |
| Product Mapping | Customer-specific mapping from source product identifiers to canonical `unit_number` values. |
| Unit Number | Canonical product identifier. It intentionally aligns with Lift Unit Numbers for the MVP. |
| Route | Versioned rule selecting destination adapter, output template, retry policy, and notification profile for a Canonical Order. |
| Output Template | Versioned destination payload mapping used by destination adapters. |
| Destination Adapter | Destination-facing integration that consumes validated Canonical Orders and submits destination-specific payloads. |
| Processing Job | One execution attempt through the pipeline using a captured configuration snapshot. |
| Replay | A new processing attempt created from archived raw input or an existing canonical attempt. Replay never edits historical records. |
| Configuration Registry | Authoritative catalog of active and historical configuration versions. |
| Audit Event | Immutable record of a meaningful action, state transition, configuration change, submission, or operator intervention. |

### 3.1 State Naming Standard

Later lifecycle docs define the canonical state language. Implementations may expose uppercase enum values, but the conceptual states are:

`Discovered -> Received -> Raw Archived -> Canonical Created -> Validated -> Resolved -> Ready -> Submitted -> Completed -> Archived`

Failure branches may move to `Failed`, `Waiting`, `Retry`, or `Cancelled`.

Older labels such as `PRODUCTS_RESOLVED` map to `Resolved`; `SUBMITTING` is an implementation substate of `Submitted` and should not replace the canonical lifecycle.

---

## 4. System Context

Pathfinder supports multiple intake channels and multiple destinations through a stable core pipeline.

```text
Source System or File
    |
    v
Connector / Upload API
    |
    v
Raw Payload Archive
    |
    v
Input Template + Translation Engine
    |
    v
Canonical Order
    |
    +--> Validation Engine
    +--> Product Mapping / Transformation Engine
    +--> Business Rules / Enrichment
    +--> Routing Engine
    |
    v
Destination Adapter(s)
    |
    v
Destination System(s)
```

The core processing engine orchestrates stages. It should not know the details of Wrike, Excel, Lift, Shopify, or any other specific source or destination beyond versioned contracts and adapter interfaces.

---

## 5. MVP Scope

The first production implementation supports:

- Source systems: Wrike and Excel attachments.
- Customer: Momentara.
- Destination: Lift Standard Graphics.

Momentara is the reference customer implementation. Wrike is the reference connector. Lift Standard Graphics is the reference destination adapter.

### 5.1 Included in MVP

- Canonical Order models.
- Logical database schema and persistence.
- Processing job lifecycle.
- Input templates for Momentara order files.
- Deterministic translation and validation.
- Product mapping from Momentara source identifiers to `unit_number`.
- Routing to Lift Standard Graphics.
- Lift Standard Graphics destination adapter.
- Wrike connector.
- Operational visibility in the Administration Portal.
- Customer Portal manual upload and order history after core services are stable.
- Audit trail, retries, replay, and structured errors.

### 5.2 Deferred Beyond MVP

- Additional destinations beyond Lift Standard Graphics.
- Customer self-service configuration editing.
- AI-driven auto-changes.
- Destination-to-source status synchronization.
- Advanced artwork workflows.
- Customer SSO.
- Marketplace/plugin distribution.
- Additional canonical object families beyond orders.

---

## 6. Canonical Order Contract

The Canonical Order is the core platform contract. It is owned by Pathfinder, not by any source or destination system. It changes only to support broadly reusable platform capabilities.

Destination-specific fields must not be added to the Canonical Order. Source-specific fields should remain in raw payload metadata, source metadata, audit events, or extension metadata, not in the canonical core.

### 6.1 Canonical Object Hierarchy

```text
CanonicalOrder
|-- customer
|-- source
|-- target
|-- order
|   `-- shipping
`-- lines[]
    |-- artwork
    |-- dimensions
    |-- production
    `-- shipping (optional override)
```

### 6.2 Canonical JSON Example

```json
{
  "customer": {
    "customer_id": "1249",
    "customer_name": "Momentara"
  },
  "source": {
    "source_system": "Wrike",
    "source_customer": "Momentara",
    "source_record_id": "AS360-30904511",
    "source_record_url": null,
    "source_template": "Momentara OOH Order Form",
    "submitted_at": "2026-06-18T14:32:00-04:00"
  },
  "target": {
    "target_system": "Lift Graphics"
  },
  "order": {
    "external_order_id": "AS360-30904511",
    "po_number": "1122334455",
    "contract_number": "1122334455",
    "order_title": "Campaign",
    "order_note": null,
    "ship_date": "2026-06-23",
    "shipping": {
      "method": "UPS Ground",
      "account_number": null,
      "attention_to": null,
      "company": "Example Company",
      "address_1": "123 Main St",
      "address_2": null,
      "city": "Cincinnati",
      "state": "OH",
      "postal_code": "45202",
      "country": "US",
      "phone": null,
      "email": null,
      "instructions": null
    }
  },
  "lines": [
    {
      "line_number": 1,
      "unit_number": "2SHEET_46x60_48PT",
      "description": "2 Sheet Poster",
      "quantity": 1,
      "artwork": {
        "file_name": "art.pdf",
        "file_url": "https://example.com/art.pdf"
      },
      "dimensions": {
        "final_height": 46.2,
        "final_width": 60.2,
        "live_height": 43,
        "live_width": 57,
        "bleed": 0.125
      },
      "production": {
        "material": "15pt Styrene",
        "laminate": "8520",
        "coating": "N",
        "premask": "N",
        "ink": "4CP/0",
        "cut_type": "Square Cut"
      },
      "shipping": null,
      "line_note": null
    }
  ]
}
```

### 6.3 Required Canonical Fields

| Path | Required | Notes |
| --- | --- | --- |
| `customer.customer_id` | Yes | Pathfinder customer identifier. |
| `customer.customer_name` | Yes | Human-readable customer name. |
| `source.source_system` | Yes | Originating source system. |
| `source.source_record_id` | Yes | External source record identifier. |
| `target.target_system` | Yes | Intended destination family or adapter target. |
| `order.external_order_id` | Yes | Unique per customer. |
| `order.ship_date` | Policy-based | ISO-8601 date preferred. |
| `order.shipping` | Policy-based | Default shipping object inherited by lines. |
| `lines[]` | Yes | At least one line. |
| `lines[].unit_number` | Yes | Canonical product identifier. |
| `lines[].quantity` | Yes | Positive integer. |
| `lines[].dimensions.final_width` | Yes | Inches. |
| `lines[].dimensions.final_height` | Yes | Inches. |

### 6.4 Canonical Evolution

Canonical schema changes require architecture review, version increment, connector compatibility review, and destination adapter compatibility review. Evolution should be additive whenever possible. Breaking changes require a new major schema version.

Potential future canonical sections, deferred until broadly reusable, include billing, pricing, taxes, approvals, contacts, fulfillment, and production metadata.

---

## 7. Configuration Model

Pathfinder is metadata driven. Customer-specific behavior should be represented as versioned metadata whenever practical.

Configuration domains:

- customers
- connectors
- input templates
- output templates
- product mappings
- validation profiles
- business rules
- routes
- notification profiles
- lookup tables
- destination adapters

Every configurable object contains:

- `id`
- `version`
- `status` (`Draft`, `Published`, `Archived`)
- `created_by`
- `created_at`
- `published_by`
- `published_at`

Published versions are immutable. Changes create new versions.

### 7.1 Configuration Lifecycle

```text
Draft
  |
  v
Validation
  |
  v
Testing
  |
  v
Published
  |
  v
Archived
```

Only published configuration participates in production processing.

### 7.2 Processing Snapshot

When a Processing Job begins, Pathfinder resolves and stores the exact versions of:

1. Customer
2. Connector
3. Input Template
4. Validation Profile
5. Product Mapping
6. Route
7. Output Template
8. Destination Adapter

This snapshot is mandatory. Future configuration changes must not affect historical attempts or replay behavior.

### 7.3 Dependency Rules

- Input Template depends on Customer.
- Connector depends on Customer.
- Validation Profile depends on Customer.
- Route depends on Customer and Destination Adapter.
- Output Template depends on Destination Adapter.
- Product Mapping depends on Customer and canonical `unit_number` values.

Dependency violations block publication.

---

## 8. Input Template DSL and Translation

Input Templates are executable configuration, not application code. No customer-specific parsing logic should be implemented in application code when it can be represented by the template language.

Each input template contains:

- metadata
- source definition
- parsing rules
- field mappings
- transformations
- lookup references
- defaults
- validation overrides
- publication metadata

### 8.1 Supported Source Types

- `excel`
- `csv`
- `json`
- `xml`
- `api`
- `email`
- `manual-upload`

### 8.2 Source Metadata

Templates may define:

- worksheet
- header row
- first data row
- end condition
- encoding
- locale

### 8.3 Mapping and Transformation

Supported transformation types:

- direct field mapping
- constant values
- string manipulation
- date parsing
- numeric conversion
- unit conversion
- lookup table
- conditional expressions
- concatenation
- split values
- multi-column composition

Built-in functions include `trim`, `upper`, `lower`, `title`, `concat`, `split`, `replace`, `date`, `number`, `decimal`, and `boolean`.

Defaults execute after mapping and before validation. Defaults never overwrite explicit customer values unless a published business rule allows it.

### 8.4 Template Determinism

A published template must produce identical Canonical Orders when executed against identical source data with the same configuration snapshot.

The template test experience must support sample upload, live translation, canonical preview, validation preview, and destination preview. Testing must not submit to a destination.

---

## 9. Product Mapping and Transformation

The current production mapping strategy is:

```text
Customer SKU
    |
    v
Pathfinder unit_number
    |
    v
Lift Unit Number
    |
    v
Lift Product
```

Product mappings are customer-specific. No assumptions should be made from product descriptions.

Mapping diagnostics should expose:

- mapped fields
- unmapped fields
- defaulted fields
- lookup failures
- unknown values
- deprecated values

Mapping health metrics should include:

- mapping coverage
- unknown products
- unknown materials
- unknown cut types
- lookup misses
- default usage percentage

AI-assisted mapping suggestions may be introduced later, but they must remain advisory, reviewable, and validated before becoming persistent configuration.

---

## 10. Validation Engine

Validation occurs against the Canonical Order, never directly against source-specific formats or destination payloads.

Validation categories:

- Customer: active customer, authorized connector, configured profiles.
- Order: external order ID, PO policy, ship date, shipping address.
- Line: unit number, quantity, material, dimensions, artwork.
- Business: duplicate external order, duplicate PO, required customer references, route exists.

Validation result types:

- `PASS`
- `WARNING`
- `FAIL`

Warnings may continue automatically based on customer profile. Failures stop processing and move the job into an operationally visible failure state.

### 10.1 Validation Message Contract

Each message contains:

- severity
- code
- object
- field
- message
- suggested_action

Example:

```text
Severity: FAIL
Code: VAL-102
Field: lines[3].unit_number
Message: Unit Number not found.
Suggested Action: Create product mapping or correct source SKU.
```

Error codes must be stable. User-facing messages may evolve.

---

## 11. Processing Lifecycle

Every inbound order creates a Processing Job. Jobs are immutable except for status and runtime metadata. Every stage persists its result and emits audit events.

```text
Discovered
  |
  v
Received
  |
  v
Raw Archived
  |
  v
Canonical Created
  |
  v
Validated
  |
  v
Resolved
  |
  v
Ready
  |
  v
Submitted
  |
  v
Completed
  |
  v
Archived
```

Failure branches may occur from any processing state and transition to `Failed` or `Waiting`, followed by `Retry` or `Cancelled`.

### 11.1 Allowed State Transitions

| Current | Allowed Next |
| --- | --- |
| Discovered | Received |
| Received | Raw Archived |
| Raw Archived | Canonical Created |
| Canonical Created | Validated, Failed |
| Validated | Resolved, Failed |
| Resolved | Ready |
| Ready | Submitted |
| Submitted | Completed, Failed |
| Failed | Waiting, Retry |
| Waiting | Ready, Cancelled |
| Completed | Archived |

Every transition must emit an audit event. No stage may skip or invent states.

### 11.2 Processing Pipeline

```text
Receive Order
  |
  v
Archive Raw Payload
  |
  v
Translate to Canonical
  |
  v
Validate
  |
  v
Resolve Products
  |
  v
Apply Business Rules
  |
  v
Generate Destination Payload(s)
  |
  v
Submit
  |
  v
Receive Response
  |
  v
Update Status
  |
  v
Audit and Notify
```

### 11.3 Replay Behavior

Replay begins with the archived raw payload or linked original attempt and always creates:

- new Processing Job,
- new Canonical Order,
- new Audit Events,
- new Destination Payload,
- new Submission record.

Historical attempts remain unchanged. Corrections never mutate historical Canonical Orders.

---

## 12. Routing and Submission

Routing determines where an order is delivered. A route contains:

- customer
- destination adapter
- output template
- connector constraints if applicable
- retry policy
- notification profile

One Canonical Order may generate multiple destination payloads.

The Submission Engine is responsible for:

- generating destination payloads,
- authenticating with destinations,
- submitting payloads,
- capturing request and response,
- normalizing destination response,
- updating Processing Job state,
- retaining submission history.

Transient failures may retry automatically. Permanent failures require operator intervention.

Transient examples:

- timeout
- network interruption
- HTTP 429
- HTTP 503

Permanent examples:

- unknown Unit Number
- invalid customer
- invalid payload
- authentication rejected

---

## 13. Connector SDK

Connectors retrieve information only. They must not parse customer-specific business data, generate Canonical Orders, execute validation, generate destination payloads, or submit directly to destinations.

Every connector must:

- authenticate,
- discover new records,
- retrieve metadata,
- download attachments,
- archive raw submissions,
- create Processing Jobs,
- optionally acknowledge the source after successful intake.

### 13.1 Required Connector Methods

```text
authenticate()
healthCheck()
discover()
fetch(recordId)
downloadAttachments(recordId)
acknowledge(recordId)
disconnect()
```

Optional methods:

```text
subscribe()
unsubscribe()
renewAuthentication()
refreshMetadata()
```

### 13.2 Connector Lifecycle

```text
Initialize
  |
  v
Authenticate
  |
  v
Health Check
  |
  v
Discover
  |
  v
Fetch
  |
  v
Download Attachments
  |
  v
Create Processing Job
  |
  v
Acknowledge (optional)
```

Wrike is the reference connector. Future connectors must follow the same lifecycle, configuration model, logging strategy, and certification process.

---

## 14. Destination Adapter SDK

Destination adapters consume validated Canonical Orders and generate destination-specific payloads. They must never modify Canonical Orders.

Destination adapters are responsible only for:

- payload generation,
- authentication,
- submission,
- response normalization,
- retry behavior,
- logging.

### 14.1 Required Adapter Methods

```text
initialize()
authenticate()
generatePayload(canonicalOrder)
validatePayload(payload)
submit(payload)
normalizeResponse(response)
healthCheck()
```

Optional methods:

```text
cancel()
update()
fetchStatus()
```

### 14.2 Normalized Response

Every adapter returns:

- `SUCCESS`
- `WARNING`
- `FAILED`

Metadata:

- destination_order_id
- destination_reference
- response_time_ms
- submitted_at
- raw_response

### 14.3 Lift Standard Graphics Adapter

The Lift Standard Graphics Adapter is the reference destination implementation.

It shall:

- accept only validated Canonical Orders,
- generate Lift Standard Graphics JSON,
- resolve customer and Unit Numbers,
- submit orders to Lift,
- capture responses,
- return normalized submission results.

It shall not:

- parse customer files,
- execute validation,
- modify the Canonical Order,
- perform customer-specific logic.

Lift adapter certification requires successful order creation, correct Unit Number mapping, product name/description preservation, artwork reference preservation, shipping preservation, normalized responses, and replay without duplicate orders.

Lift target configuration must be managed through the Administration Portal, not hard-coded into the adapter or embedded in the order JSON body. Required target settings include:

- `PROD` endpoint URL: `http://prod-lifterp/lifterp/ords/lifterp/lift/erp/api/create_order`
- `QA1` endpoint URL: `http://devcompute/lifterp-qa1/lifterp/liftqa1/erp/api/create_orde` pending confirmation of the final path.
- Active environment: `PROD` or `QA1`.
- Company ID: `91` for the LTL/Lift company receiving orders.
- Lift import username.
- Lift import password stored as a secret.
- `Ext_ID` resolution strategy, defaulting the Lift payload's `order.ext_id` from the canonical `order.external_order_id`, with optional fallbacks such as canonical `order.contract_number` or `order.po_number`.

The Lift adapter submits using HTTP headers:

```text
Content-Type: application/json
Ext_ID: {order.ext_id}
User: {configured Lift import username}
Password: {configured Lift import password secret}
Company ID: {configured Lift company ID}
```

The `Ext_ID` request header must exactly match the `order.ext_id` value in the JSON body. The Lift adapter must validate this equality before submission and fail fast if the values differ.

Credentials must never be stored in generated payload records, exported templates, or visible audit details. Audit records may store credential secret references and non-sensitive header values such as endpoint, company ID, and resolved `Ext_ID`.

---

## 15. Logical Data Model

The Pathfinder database is the operational source of truth for customers, templates, mappings, processing jobs, logs, and configuration. Raw submissions and Canonical Orders are stored separately.

### 15.1 Logical Domains

Configuration:

- customers
- connectors
- routes
- input_templates
- output_templates
- validation_profiles
- notification_profiles

Processing:

- processing_jobs
- canonical_orders
- canonical_order_lines
- submissions
- retries
- audit_events

Reference:

- product_mappings
- lookup_tables
- transformation_rules

Security:

- users
- roles
- permissions
- api_keys

Storage:

- attachments
- raw_documents
- generated_payloads

### 15.2 Entity Relationships

```text
Customer
  |-- Connectors
  |-- Templates
  |-- Validation Profiles
  |-- Routes
  |-- Product Mappings
  `-- Processing Jobs

Processing Job
  |-- Raw Document
  |-- Canonical Order
  |-- Audit Events
  |-- Submission(s)
  `-- Attachments

Canonical Order
  `-- Order Lines
```

### 15.3 Core Entities

`customers` represent organizations configured to use Pathfinder.

`connectors` represent intake connections and their versioned configuration.

`input_templates` store immutable published parsing and mapping templates.

`product_mappings` map customer product identifiers to canonical `unit_number` values.

`processing_jobs` represent execution attempts through the pipeline.

`canonical_orders` store immutable Canonical Order JSON documents for a processing attempt.

`canonical_order_lines` provide line-level queryability for analytics without requiring JSON parsing.

`audit_events` record every meaningful action as immutable append-only history.

`attachments` reference object storage locations and checksums rather than storing binary data in the database.

`generated_payloads` store destination-specific payloads and responses for replay, diagnostics, and auditing.

### 15.4 Retention

Recommended retention:

- Processing Jobs: 7 years.
- Audit Events: 7 years.
- Canonical Orders: 7 years.
- Raw Documents: customer configurable.
- Attachments: customer configurable.
- Aggregate metrics: indefinite.

---

## 16. REST API Contract

Pathfinder is API-first. Every major capability should be available through REST APIs before it appears in the Administration Portal or Customer Portal. Web apps consume the same APIs available to external integrations.

### 16.1 Authentication

Supported:

- OAuth 2.0 preferred.
- API keys.
- JWT for internal web apps.

Future:

- SAML.
- OpenID Connect.
- Customer SSO.

### 16.2 Resource Overview

```text
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

### 16.3 Orders API

`POST /orders` creates a Processing Job from Canonical JSON, multipart upload, spreadsheet upload, or future ZIP package.

Example response:

```json
{
  "job_id": "...",
  "status": "RECEIVED"
}
```

`GET /orders/{jobId}` returns processing status, canonical summary, validation summary, and destination summary.

`GET /orders` supports filters by customer, status, source, destination, and date range. Pagination is required.

### 16.4 Processing Jobs API

- `GET /processing-jobs`
- `POST /processing-jobs/{jobId}/retry`
- `POST /processing-jobs/{jobId}/cancel`

Retry creates a new processing attempt.

### 16.5 Standard Error Format

```json
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

APIs are stateless, JSON-first, paginated by default, explicitly filterable, and backward compatible.

---

## 17. Workers and Background Jobs

Pathfinder is asynchronous by default. Intake should return quickly and enqueue long-running work.

Worker categories:

- connector poll worker
- translation worker
- validation worker
- submission worker
- notification worker
- maintenance worker

Workers must be idempotent. Duplicate execution must not create duplicate destination orders. Destination adapters should use external identifiers or idempotency keys where required.

Processing locks must prevent two workers from mutating runtime status for the same job simultaneously while preserving immutable audit history.

---

## 18. Administration Portal

The Administration Portal is for internal operational users. It owns configuration management, operational diagnosis, recovery workflows, and platform governance.

Primary modules:

- Dashboard
- Orders / Processing Queue
- Customers
- Templates
- Product Mapping
- Routes
- Connectors
- Validation Profiles
- Audit
- Users and Roles

Every administration screen should support:

- search,
- filtering,
- export,
- pagination,
- detail view,
- audit history.

### 18.1 Three-Panel Debug View

The primary engineering/debug interface exposes:

1. Raw Source
2. Canonical Order
3. Destination Payload

Operators must be able to determine what was received, what Pathfinder understood, what was sent, what failed, and how to recover without direct database access.

---

## 19. Customer Portal

The Customer Portal is intentionally simpler than the Administration Portal. Customers consume Pathfinder; they do not edit mappings, routes, validation profiles, or connectors.

Primary capabilities:

- home dashboard,
- submit order wizard,
- manual upload,
- template detection,
- translation preview,
- validation preview,
- order submission,
- order history,
- order detail,
- notifications,
- profile and documentation.

The Customer Portal should explain what Pathfinder is doing without requiring customers to understand the internal implementation.

---

## 20. Security Architecture

Security defaults are mandatory. Every user, connector, worker, and destination adapter operates with the minimum permissions required.

Security domains:

- authentication,
- authorization,
- connector credentials,
- API security,
- document and attachment security,
- audit requirements,
- compliance controls.

Connector credentials must be encrypted at rest. API access must support scoped permissions, stable identity, rate limiting, and auditability. Documents and attachments should be stored in object storage with controlled access, checksums, and customer-specific retention policies.

Future security work includes customer SSO, API key rotation, MFA for administrators, attachment virus scanning, and enhanced artwork approval workflows.

---

## 21. Observability and Analytics

Observability is a first-class platform capability. Every subsystem emits structured operational data sufficient to understand what happened, why it happened, how long it took, and what recovery path is available.

Core metrics:

- processing volume,
- processing duration,
- success rate,
- failure rate,
- retry rate,
- connector poll health,
- destination submission latency,
- validation failures by code,
- unknown product rate,
- mapping coverage,
- configuration quality,
- customer health.

Dashboards:

- Executive Dashboard: customer volume, automation impact, reliability, business outcomes.
- Operations Dashboard: live queue, failures, retry status, connector/destination health.
- Engineering Dashboard: latency, errors by subsystem, regression signals, worker performance.

Telemetry should be exportable to BI and monitoring tools such as Grafana, Power BI, Tableau, OpenTelemetry, and CloudWatch without modifying Pathfinder internals.

---

## 22. Testing and Certification

Testing is a platform capability, not a post-implementation activity.

Testing layers:

- unit tests for deterministic functions,
- integration tests for service boundaries,
- end-to-end tests for source-to-destination flows,
- golden canonical order tests,
- connector certification,
- destination adapter certification,
- performance tests,
- regression suite before every release.

Every new connector and destination adapter must ship with executable reference examples that become permanent regression assets.

Published example Canonical Orders are reference outputs. Changes require architectural approval.

### 22.1 Certification Gates

A connector is production-ready when it authenticates, discovers, fetches records, downloads attachments, creates Processing Jobs, logs structured events, passes retries, and contains no customer-specific parsing logic.

A destination adapter is production-ready when it consumes Canonical Orders exclusively, generates deterministic payloads, authenticates, submits successfully, normalizes responses, logs and audits submissions, supports safe replay, and contains no customer-specific logic.

A customer configuration is production-ready when sample orders translate into valid Canonical Orders, mappings resolve, validation behaves as configured, routes resolve, destination payloads pass adapter validation, and operations can support the workflow.

---

## 23. Deployment and DevOps

Pathfinder is cloud-native. Infrastructure is reproducible, automated, environment-independent, and defined as code.

Environment strategy:

- local development,
- development,
- staging,
- production.

Deployment expectations:

- CI/CD validates builds and tests before promotion.
- Infrastructure is managed through IaC.
- Production releases are immutable.
- Configuration changes may happen independently from application releases.
- Monitoring and alerting are part of the release.
- Disaster recovery includes backups, configuration restore, and replayable processing history.

The recommended implementation shape is a monorepo with shared packages for Canonical Order models, connectors, adapters, validation, routing, and UI components.

---

## 24. Operations and Onboarding

Operability is a feature. A capability is incomplete until Operations can monitor, diagnose, and support it.

Customer onboarding phases:

1. Discovery
2. Connector setup
3. Template development
4. Product mapping
5. Validation
6. Destination certification
7. Production approval

Operational readiness requires:

- active customer configuration,
- connector health,
- published templates,
- mapping coverage,
- published routes,
- certified destination adapter,
- regression suite passing,
- support playbook,
- rollback plan,
- dashboard visibility,
- notification configuration.

Incident classes:

- connector failure,
- mapping failure,
- validation failure,
- submission failure,
- destination outage,
- infrastructure failure.

Failures must be recoverable through visible operational workflows: revalidate, retry, replay, cancel, update mappings, and promote corrected configuration versions.

---

## 25. Development Approach

Implementation should proceed incrementally in this order:

1. Canonical Order models
2. Database schema
3. Processing engine
4. Template engine
5. Validation engine
6. Product mapping
7. Routing engine
8. Lift destination adapter
9. Wrike connector
10. Administration Portal
11. Customer Portal

Avoid implementing user interfaces before the underlying services are stable.

### 25.1 Engineering Standards

- Start from stable contracts.
- Keep the core engine small.
- Prefer simple deterministic functions.
- Isolate connectors and adapters.
- Use structured logging.
- Use stable error codes.
- Treat docs as code.
- Require architecture impact review for feature proposals.
- Update the specification when implementation and documentation diverge.

### 25.2 Definition of Complete

A feature is complete only when:

- implementation matches the specification,
- tests pass,
- operational visibility exists,
- errors are structured,
- audit events are emitted,
- documentation is updated,
- associated user stories and acceptance criteria pass.

---

## 26. Extensibility, AI, and Future Platform Direction

Pathfinder should evolve through extension points rather than changes to the core orchestration pipeline.

Extension points:

- connectors,
- input templates,
- lookup providers,
- validation profiles,
- business rules,
- routes,
- output templates,
- destination adapters,
- notification channels,
- analytics exporters.

Extensions should remain backward compatible with published Canonical Order versions whenever practical. Breaking changes require new major plugin or adapter versions.

### 26.1 AI Strategy

AI may recommend actions, mappings, classifications, or corrections. AI must never silently modify Canonical Orders, product mappings, routing decisions, destination payloads, or persistent configuration.

Persistent AI-generated configuration changes require explicit human approval.

Appropriate AI opportunity areas:

- onboarding assistance,
- mapping suggestions,
- validation explanations,
- operations triage,
- anomaly detection,
- documentation assistance.

### 26.2 Beyond Orders

Orders are the first domain, not the only domain. Future canonical object families may include quotes, artwork, proofs, shipments, invoices, and other business objects.

Future domains should share infrastructure but maintain independent schemas. This preserves reuse without forcing every domain into the order schema.

---

## 27. Open Design Questions

Deferred topics:

- customer SSO and OAuth provider strategy,
- API key rotation policy,
- administrator MFA requirements,
- attachment versioning,
- virus scanning,
- thumbnail generation,
- artwork approval workflows,
- destination-to-source synchronization,
- Lift production status updates,
- shipment tracking,
- proof approval notifications,
- invoice notifications,
- canonical expansion for billing, pricing, taxes, approvals, contacts, fulfillment, and advanced production metadata.

These topics should be addressed only after MVP foundations are stable or when required by a broadly reusable platform capability.

---

## 28. Architecture Decision Register

| ADR | Decision | Preserved Resolution |
| --- | --- | --- |
| ADR-001 | Canonical Order Schema | Canonical Order is the shared internal schema and primary platform contract. |
| ADR-002 | Configuration over Code | Customer-specific behavior belongs in templates, mappings, routes, and connector configuration. |
| ADR-003 | Canonical-first Processing | Every source submission must become a Canonical Order before validation, routing, or output. |
| ADR-004 | Canonical Order Stability | Schema changes only support broadly reusable capabilities; destination-specific fields stay out. |
| ADR-005 | Customer Configuration Model | New onboarding is configuration and template work, not processing-engine code. |
| ADR-006 | Canonical Product Identifier | `unit_number` is the canonical product identifier. |
| ADR-007 | Stateless Processing | Each stage receives input, performs one responsibility, emits a result, and persists outcome. |
| ADR-008 | Raw Payload Preservation | Original submissions are archived unchanged. |
| ADR-009 | Deterministic Processing | Same raw input plus same configuration snapshot produces same Canonical Order. |
| ADR-010 | Configuration Ownership | Admin users configure; customers consume. |
| ADR-011 | Operational Transparency | Operators can see received source, canonical interpretation, sent payload, failures, and recovery path. |
| ADR-012 | Database as Operational Source of Truth | Database owns operational state, configuration, jobs, logs, and metadata. |
| ADR-013 | Immutable Canonical Documents | Generated Canonical Orders are immutable per attempt. |
| ADR-014 | Adapter Isolation | Connectors and adapters are independently deployable and isolated. |
| ADR-015 | Destination Adapter Independence | Adapters consume Canonical Orders and never modify them. |
| ADR-016 | Reference Implementation | Lift Standard Graphics is the reference adapter. |
| ADR-017 | Canonical Contract Ownership | Pathfinder owns the Canonical Order Schema. |
| ADR-018 | Backward Compatibility | Schema evolution should be additive; breaking changes require major versioning. |
| ADR-019 | Monorepo | Use a single repository with shared packages. |
| ADR-020 | Stable Core | New functionality belongs in connectors, templates, routes, profiles, and adapters when possible. |
| ADR-021 | AI as an Assistant | AI recommends but does not silently alter Canonical Orders. |
| ADR-022 | Customer Isolation | One customer's failures must not affect others. |
| ADR-023 | Three-Panel Debug View | Raw Source, Canonical Order, and Destination Payload are shown together for debugging. |
| ADR-024 | Build Platform Before Integrations | Reusable platform foundations precede broad customer-specific integrations. |
| ADR-025 | Deterministic Transformation | Transformations must be repeatable for identical inputs and configuration. |
| ADR-026 | Explicit Over Implicit | Customer-provided values beat defaults unless a rule explicitly overrides them. |
| ADR-027 | Operability is a Feature | Features are incomplete until observable and supportable. |
| ADR-028 | Canonical Change Control | Canonical changes require review, docs, versioning, and compatibility checks. |
| ADR-029 | Architecture Before Features | Feature proposals must identify architectural, canonical, connector, adapter, and operational impact. |
| ADR-030 | Documentation as Code | Architecture changes require documentation updates. |
| ADR-031 | Platform Before Project | Every decision should improve future customer and destination reuse. |
| ADR-032 | Simplicity Wins | Prefer maintainable, stable, low-complexity designs. |
| ADR-033 | Transparency Over Automation | Automated decisions must remain explainable. |
| ADR-034 | Reference Customer | Momentara is the reference customer implementation. |
| ADR-035 | Screen Consistency | Admin screens share search, filtering, export, pagination, detail, and audit patterns. |
| ADR-036 | Simplicity First | Customer Portal exposes fewer technical details than Admin Portal. |
| ADR-037 | Immutable Job History | Corrections create new events and attempts, not rewritten history. |
| ADR-038 | Queue Visibility | Every job belongs to exactly one visible operational state. |
| ADR-039 | Data Ownership | Each domain object has one system of record. |
| ADR-040 | Immutable Audit Trail | Audit records, canonical orders, payloads, and raw submissions are append-only. |
| ADR-041 | API First | Major capabilities are exposed through REST before UI. |
| ADR-042 | Stable Error Codes | Integrations depend on error codes, not message text. |
| ADR-043 | Asynchronous by Default | Long-running work executes in background jobs. |
| ADR-044 | Idempotent Workers | Workers are safe to execute more than once. |
| ADR-045 | UI Consistency | Shared components are preferred over screen-specific customization. |
| ADR-046 | Build Against the Specification | Implementation and specification divergence must be resolved. |
| ADR-047 | Shared Platform Services | Reusable services should be shared across future modules. |
| ADR-048 | Repeatable Onboarding | Every customer follows the same onboarding playbook. |
| ADR-049 | Example Driven Development | Connectors and adapters ship executable reference examples. |
| ADR-050 | Explicit State Transitions | Orders move only through predefined audited transitions. |
| ADR-051 | Replay Instead of Edit | Corrections create linked new attempts. |
| ADR-052 | Metadata Driven Platform | Customer-specific behavior is versioned metadata whenever practical. |
| ADR-053 | Processing Snapshot | Jobs store exact configuration versions used. |
| ADR-054 | Configuration Transparency | Operators know active versions and versions used by each job. |
| ADR-055 | Least Privilege | Users, connectors, workers, and adapters use minimum required permissions. |
| ADR-056 | Security by Default | New features default to secure behavior. |
| ADR-057 | Canonical Contract Preservation | Canonical JSON changes require review and compatibility checks. |
| ADR-058 | Destination Isolation | Destination adapters are isolated from connectors and template logic. |
| ADR-059 | Reference Destination | Future adapters follow Lift lifecycle, logging, response, and retry patterns. |
| ADR-060 | Templates Are Code-Free | Input Templates represent customer parsing without app code. |
| ADR-061 | Template Determinism | Published templates produce identical outputs for identical source data. |
| ADR-062 | Connector Purity | Connectors retrieve and package raw information only. |
| ADR-063 | Connector Replaceability | Connectors are replaceable without affecting core systems. |
| ADR-064 | Destination Adapter Purity | Adapters generate payloads, submit, normalize, retry, and log only. |
| ADR-065 | Adapter Replaceability | Adapters are independently deployable and replaceable. |
| ADR-066 | Build From Stable Contracts | Implementation begins with canonical, configuration, and API contracts. |
| ADR-067 | Documentation Is Part of the Product | SUPERDOC/spec updates are part of delivery. |
| ADR-068 | Testing Is a Platform Capability | Major subsystems expose deterministic testable interfaces. |
| ADR-069 | Golden Canonical Orders | Reference canonical outputs require approval to change. |
| ADR-070 | Regression Before Release | Production deploys require passing regression suite. |
| ADR-071 | Operational Acceptance | Production rollout requires operational support readiness. |
| ADR-072 | Cloud Native Deployment | Infrastructure is reproducible, automated, and IaC-managed. |
| ADR-073 | Immutable Releases | Production artifacts are reproducible and immutable. |
| ADR-074 | Observability by Design | Subsystems emit structured operational data. |
| ADR-075 | Measure Configuration Quality | Templates, mappings, and validation profiles have quality metrics. |
| ADR-076 | Platform Telemetry | Telemetry is exportable to external BI/monitoring tools. |
| ADR-077 | AI Augments, Never Overrides | AI recommendations are traceable and never silently applied. |
| ADR-078 | Human Approval for Persistent Changes | AI-generated persistent config changes require approval. |
| ADR-079 | Core Engine Stability | Core processing remains small; new features use extension points. |
| ADR-080 | Backward-Compatible Extensions | Extensions preserve compatibility or version major breaks. |
| ADR-081 | Orders Are the First Domain, Not the Only Domain | Pipeline is reusable beyond orders. |
| ADR-082 | Shared Infrastructure | Future business objects share infrastructure but keep schemas independent. |
| ADR-083 | Business Scenarios Drive Development | Features trace to user stories and acceptance criteria. |
| ADR-084 | Acceptance Before Completion | Associated acceptance criteria must pass before completion. |

---

## 29. Source Volume Cross-Reference

| Master Spec Topic | Primary Source Volumes |
| --- | --- |
| Vision and platform philosophy | Volumes 1, 17, 49 |
| System architecture | Volumes 2, 7, 10, 17 |
| Canonical Order | Volumes 3, 9, 35 |
| Customer configuration and templates | Volumes 4, 33, 37 |
| Validation, processing, routing | Volumes 5, 23, 26, 32 |
| Admin and Customer Portal | Volumes 6, 12, 18, 21, 22, 27 |
| Lift and destination adapters | Volumes 8, 36, 39 |
| Product mapping and transformation | Volume 14 |
| Operations and governance | Volumes 15, 30, 42, 44 |
| Engineering standards and build order | Volumes 13, 16, 28, 40, 41 |
| APIs and database | Volumes 24, 25 |
| Security and deployment | Volumes 34, 43 |
| AI, extensibility, future modules | Volumes 11, 29, 45, 46, 47 |
| User stories and acceptance | Volume 48 |
| ADRs and maintenance | Volumes 20, 50 |

---

## 30. Final Implementation Guidance

Build the stable platform first. Momentara should prove the architecture, not bend it.

The early implementation should make it easy to answer these questions for every order:

- What did Pathfinder receive?
- Which configuration versions were used?
- What Canonical Order was produced?
- Which validations passed, warned, or failed?
- Which product mappings resolved?
- Which route was selected?
- What destination payload was generated?
- What response came back?
- What should an operator do next?

When those questions are reliably answerable, Pathfinder is on the right architectural path.

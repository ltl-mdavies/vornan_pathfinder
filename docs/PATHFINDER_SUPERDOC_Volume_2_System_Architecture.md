
# PATHFINDER SUPERDOC
## Volume II — System Architecture
Version 1.0 Draft

# 1. Architectural Overview

Pathfinder is a universal order translation platform that sits between external customer systems and internal production systems.

Its responsibility is to receive orders, normalize them into a Canonical Order, validate and enrich them, and deliver them to one or more destination systems.

Pathfinder never contains customer-specific logic inside the processing engine. All customer-specific behavior is defined through configuration (templates, mappings, routes, and connectors).

Core pipeline:

```
Customer System
    ↓
Connector
    ↓
Input Adapter
    ↓
Input Template
    ↓
Canonical Order
    ↓
Validation
    ↓
Product Resolution
    ↓
Business Rules
    ↓
Output Adapter
    ↓
Target Template
    ↓
Target System
```

# 2. Core Components

## Connector Layer

Responsible for communicating with external systems.

Supported connector types:

- Scheduled API GET
- Webhook/API POST
- Email mailbox
- Manual upload
- Customer portal
- CSV
- Excel
- Google Drive
- SFTP

Responsibilities:

- Authentication
- Retrieval
- Metadata capture
- Attachment download
- Raw payload archival

Connectors MUST NOT perform field mapping.

---

## Intake Engine

Receives the raw payload.

Stores:

- Original payload
- Source metadata
- Attachments
- Processing timestamp

Assigns a Processing Job ID.

No translation occurs here.

---

## Template Engine

Templates define how incoming data maps into the Canonical Order.

Template responsibilities:

- Header row
- Data start row
- Sheet selection
- Required columns
- Field mapping
- Data transforms
- Default values
- Validation rules

Customer-specific templates are versioned.

Templates are data, not code.

---

## Canonical Translation Engine

Produces the Pathfinder Canonical Order.

Every input format MUST become the canonical model before any downstream processing.

No destination-specific logic exists here.

---

## Validation Engine

Validation occurs immediately after canonical translation.

Validation categories:

- Customer
- Required fields
- Shipping
- Product
- Dimensions
- Artwork
- Duplicate orders
- Business rules

Results:

- Passed
- Warning
- Failed

Warnings may continue automatically.

Failures require review.

---

## Product Resolution Engine

Purpose:

Resolve incoming product references into Lift Unit Numbers.

Current strategy:

Customer Product Reference
        ↓
Customer Product Mapping
        ↓
Lift Unit Number

Future strategies may include:

- AI-assisted matching
- Fuzzy matching
- Catalog lookup
- Dimensional lookup

The output of this engine is always a resolved Unit Number.

---

## Routing Engine

Determines destination systems.

Example routes:

Momentara
→ Lift Graphics

Customer A
→ Lift Labels

Customer B
→ ThinkDifferentPrint

Customer C
→ Lift + Shopify

Routing decisions are configuration driven.

---

## Output Engine

Transforms Canonical Order into destination-specific payload.

Examples:

Canonical
→ Lift JSON

Canonical
→ Shopify API

Canonical
→ EFI XML

No validation occurs here.

Validation is complete before output generation.

---

## Processing Queue

Every order exists in exactly one state.

States:

Received

Parsed

Canonical

Validated

Mapped

Ready

Submitting

Succeeded

Failed

Archived

Queues expose operational visibility.

---

## Retry Queue

Failures are never discarded.

Stored:

- Original payload
- Canonical payload
- API request
- API response
- Exception
- Retry count

Operators may:

- Edit
- Revalidate
- Remap
- Resubmit

---

## Audit Log

Every significant action produces an immutable audit event.

Example:

09:41 Received

09:41 Parsed

09:42 Canonical Created

09:42 Validation Passed

09:43 Submitted to Lift

09:43 Lift Order Created

---

# 3. Customer Configuration Model

Each customer contains:

Identity
- Customer ID
- Name
- Status

Input
- Connectors
- Templates
- Schedules

Processing
- Product mappings
- Validation profile
- Default shipping

Output
- Destination systems
- Output templates

Notifications
- Success
- Failure
- Daily reports

---

# 4. Internal Administration

Primary modules:

Dashboard

Customers

Connectors

Input Templates

Output Templates

Routes

Product Mapping

Jobs

Order Queue

Retry Queue

Audit Log

Settings

Users

Roles

---

# 5. Customer Portal

Purpose:

Allow customers without API capability to submit structured orders.

Workflow:

Login

↓

Select Customer Profile

↓

Drag & Drop File

↓

Template Detection

↓

Preview

↓

Validation

↓

Submit

↓

Tracking

Portal capabilities:

- Upload Excel
- Upload CSV
- Upload ZIP artwork
- View validation
- Correct metadata
- Submit
- View submission history

---

# ADR-002

Title:
Configuration over Code

Decision:

All customer-specific behavior shall be implemented through templates, mappings, routes, and connector configuration.

Rationale:

Adding a new customer should not require changes to the processing engine.

Consequences:

Pros:
- Faster onboarding
- Reduced regression risk
- Easier maintenance

Cons:
- More sophisticated configuration subsystem required

Status:
Accepted

---

# ADR-003

Title:
Canonical-first Processing

Decision:

Every connector must translate into the Canonical Order before validation or routing.

No connector may generate Lift payloads directly.

Rationale:

Centralized validation, routing, logging, and business rules are only possible if every order shares the same internal representation.

Status:
Accepted

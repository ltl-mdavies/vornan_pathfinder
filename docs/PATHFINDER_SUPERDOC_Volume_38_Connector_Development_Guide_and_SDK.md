
# PATHFINDER SUPERDOC
## Volume XXXVIII — Connector Development Guide & SDK Certification
**Version:** 1.0 Draft

---

# 1. Purpose

This volume defines the engineering standards for implementing new Pathfinder connectors. A connector is responsible for discovering source orders and delivering raw submissions into the Pathfinder processing pipeline. Connectors never perform translation, validation, routing, or destination-specific processing.

---

# ADR-062 — Connector Purity

**Status:** Accepted

Connectors retrieve information only.

They must never:
- Parse customer-specific business data.
- Generate Canonical Orders.
- Execute validation.
- Generate destination payloads.
- Submit directly to destination systems.

---

# 2. Connector Responsibilities

Every connector SHALL:

- Authenticate
- Discover new records
- Retrieve metadata
- Download attachments
- Archive the raw submission
- Create a Processing Job
- Optionally acknowledge the source system after successful intake

---

# 3. Connector Interface

All connectors implement the same contract.

Required methods:

```
authenticate()

healthCheck()

discover()

fetch(recordId)

downloadAttachments(recordId)

acknowledge(recordId)

disconnect()
```

Optional methods:

```
subscribe()

unsubscribe()

renewAuthentication()

refreshMetadata()
```

---

# 4. Connector Lifecycle

```
Initialize
    ↓
Authenticate
    ↓
Health Check
    ↓
Discover
    ↓
Fetch
    ↓
Download Attachments
    ↓
Create Processing Job
    ↓
Acknowledge (optional)
```

Failures should generate structured connector events.

---

# 5. Supported Connector Types

Current

- Wrike
- Manual Upload
- Excel Upload
- CSV Upload

Planned

- Monday.com
- HubSpot
- Salesforce
- NetSuite
- Google Drive
- Dropbox
- Box
- SFTP
- Generic REST
- Generic GraphQL

---

# 6. Connector Configuration

Each connector stores:

- Name
- Type
- Customer
- Authentication Method
- Poll Schedule
- Trigger Conditions
- Attachment Rules
- Retry Policy
- Enabled State

Configuration is versioned.

---

# 7. Health Model

Every connector exposes:

- Status
- Last Successful Poll
- Last Failed Poll
- Consecutive Failures
- Authentication State
- Average Poll Time

Health data appears on the Administration Dashboard.

---

# 8. Error Categories

Authentication

Connectivity

Rate Limiting

Source Data

Attachments

Unexpected Response

Infrastructure

Each category should map to standard Pathfinder error codes.

---

# 9. Certification Checklist

Before production a connector must demonstrate:

- Successful authentication
- Successful discovery
- Retrieval of sample orders
- Retrieval of attachments
- Retry handling
- Structured logging
- Audit generation
- Processing job creation

No customer-specific parsing should occur.

---

# 10. Reference Connector

Wrike serves as the reference connector.

Future connectors should follow the same lifecycle, configuration model, logging strategy, and certification process.

---

# ADR-063 — Connector Replaceability

A connector should be replaceable without affecting:

- Canonical Order
- Validation Engine
- Routing Engine
- Destination Adapters

The only contract between a connector and Pathfinder is the Processing Job creation interface.

---

# 11. Success Criteria

A new connector is complete when:

- It passes certification.
- It creates valid Processing Jobs.
- It requires no modifications to the core processing engine.
- It is configurable through the Administration Portal.
- It produces deterministic intake behavior.

---
End of Volume XXXVIII


# PATHFINDER SUPERDOC
## Volume XII — UI Specifications, Screen Definitions & Workflow Diagrams
**Version:** 1.0 Draft

# 1. Purpose

This volume defines the functional behavior of every major Pathfinder screen. These specifications are intended to drive frontend implementation and maintain consistency across future features.

---

# 2. Administration Navigation

```
Dashboard
Orders
  Active Queue
  History
  Retry Queue

Customers
  Profiles
  Connectors
  Product Mappings
  Routes
  Notifications

Templates
  Input
  Output

Validation Profiles

Jobs

Audit

Users

Settings
```

---

# 3. Dashboard

Objectives

- Surface operational health.
- Highlight failures.
- Provide one-click recovery actions.

Widgets

- Orders Today
- Orders In Progress
- Validation Failures
- Destination Health
- Connector Health
- Average Processing Time
- Queue Depth
- Recent Errors

---

# 4. Customer Detail

Tabs

- Overview
- Connectors
- Templates
- Product Mapping
- Routes
- Validation
- Notifications
- Test Files
- Activity

Actions

- Disable Customer
- Test Connector
- Upload Sample
- Run Translation Test

---

# 5. Translation Test Screen

Purpose

Allow administrators to test new templates before enabling production.

Workflow

Upload File
↓

Choose Template
↓

Generate Canonical Order
↓

Display Validation
↓

Display Destination Payload
↓

Approve

No destination submission occurs unless explicitly requested.

---

# 6. Product Mapping Screen

Columns

- Customer SKU
- Unit Number
- Description
- Status
- Last Used
- Updated By

Actions

- Add
- Edit
- Bulk Import
- Bulk Export
- Detect Missing
- Test Mapping

---

# 7. Processing Job Detail

Sections

- Source Metadata
- Raw Submission
- Canonical Order
- Validation
- Destination Payload
- Response
- Attachments
- Timeline

Operator Actions

- Revalidate
- Retry
- Cancel
- Download JSON
- Download Attachments

---

# 8. Customer Portal

Landing Page

- Upload Order
- Recent Orders
- Download Templates
- Documentation

Upload Wizard

1. Select Customer Profile
2. Upload Spreadsheet
3. Upload Artwork
4. Preview Translation
5. Submit

---

# 9. Canonical Preview

The Canonical Preview becomes Pathfinder's primary debugging tool.

Panels

Left

Incoming Source

Center

Canonical Order

Right

Destination Payload

Users should be able to compare all three simultaneously.

---

# 10. Workflow Diagrams

## Manual Upload

Customer
↓

Upload
↓

Template Detection
↓

Canonical Translation
↓

Validation
↓

Product Resolution
↓

Destination Payload
↓

Lift

## Automated Connector

Schedule
↓

Connector
↓

Retrieve Orders
↓

Canonical Translation
↓

Validation
↓

Routing
↓

Submission
↓

Audit

---

# ADR-023 — Three-Panel Debug View

Status: Accepted

The primary engineering/debug interface shall expose:

1. Raw Source
2. Canonical Order
3. Destination Payload

This dramatically simplifies troubleshooting and connector development.

---

# 11. UX Principles

- Configuration before customization.
- Show processing state everywhere.
- Every failure should explain itself.
- Never hide transformed data.
- Every order should be traceable from source to destination.

---
End of Volume XII


# PATHFINDER SUPERDOC
## Volume XXI — Functional Product Specification (Part 1)
### Administration Portal
**Version:** 1.0 Draft

---

# 1. Purpose

This document specifies the Administration Portal in functional detail. It is intended to serve as the implementation blueprint for frontend and backend development.

Every screen described herein should be implementable without requiring additional UX decisions.

---

# 2. Design Philosophy

The Administration Portal is the operational control center for Pathfinder.

Every screen should answer one of four questions:

1. What is configured?
2. What is processing?
3. What failed?
4. What action should the operator take?

The UI should emphasize visibility, diagnostics, and rapid recovery over visual complexity.

---

# 3. Primary Navigation

```
Dashboard

Orders
  Active Queue
  History
  Failed / Retry

Customers

Templates
  Input
  Output

Product Mapping

Routes

Connectors

Validation Profiles

Jobs

Audit

Users

Settings
```

The navigation should remain fixed on the left side of the application.

---

# 4. Dashboard

## Purpose

Provide a real-time operational overview.

## KPI Cards

- Orders Today
- Orders Processing
- Successful Orders
- Failed Orders
- Retry Queue Count
- Active Customers
- Active Connectors
- Average Processing Time

Each KPI links to the underlying filtered view.

## Health Panels

Connector Health

Columns:

- Connector
- Status
- Last Success
- Last Failure
- Next Poll
- Consecutive Failures

Destination Health

Columns:

- Destination
- Availability
- Avg Response
- Success %
- Last Failure

## Activity Feed

Displays the most recent processing events.

Columns

- Time
- Customer
- Order
- Event
- Status

---

# 5. Orders Module

## Active Queue

Displays every order currently being processed.

Columns

- Job ID
- Customer
- Source
- Destination
- External Order ID
- Current Stage
- Runtime
- Priority

Toolbar

- Refresh
- Export
- Filter
- Search
- Retry Selected
- Cancel Selected

Clicking a row opens Order Detail.

---

## Order Detail

### Header

Processing Job

Customer

Status

Created

Duration

Assigned Worker

### Tabs

Overview

Displays

- Source metadata
- Customer
- Route
- Destination

Raw Source

Displays

- Uploaded file
- JSON
- Metadata

Canonical Order

Displays formatted JSON.

Supports copy and download.

Validation

Displays

- Passes
- Warnings
- Failures

Destination Payload

Displays payload generated for Lift or other adapter.

Submission

Displays

- Request
- Response
- Destination Order ID
- Response Time

Timeline

Chronological event history.

Attachments

Displays uploaded artwork and source files.

Operator Notes

Freeform notes.

---

# 6. Customers Module

Customer List

Columns

- Customer ID
- Name
- Status
- Connectors
- Active Routes
- Last Order
- Health

Toolbar

- New Customer
- Import
- Export
- Search

---

## Customer Detail

Sections

Overview

General Information

Connectors

Input Templates

Output Templates

Routes

Validation Profile

Product Mapping

Notifications

Documents

Activity

Every configuration section should support version history.

---

# 7. Templates Module

## Input Templates

Columns

- Name
- Customer
- Version
- File Type
- Last Modified
- Status

Actions

- Create
- Duplicate
- Test
- Publish
- Archive

---

## Template Editor

Layout

Left

Source Columns

Center

Field Mapping Canvas

Right

Canonical Preview

Bottom

Validation Messages

Capabilities

- Drag-and-drop field mapping
- Transformation editor
- Lookup assignment
- Default value assignment
- Sample data preview

---

# 8. Product Mapping Module

Purpose

Manage customer SKU to Unit Number mappings.

Columns

- Customer SKU
- Unit Number
- Description
- Active
- Last Used
- Last Updated

Toolbar

- Add
- Import CSV
- Export
- Detect Missing
- Validate

Detail Drawer

- Customer SKU
- Unit Number
- Description
- Aliases
- Notes
- History

---

# 9. Routes Module

Displays configured routing rules.

Columns

- Customer
- Source
- Destination
- Output Template
- Enabled

Route Detail

- Trigger
- Validation Profile
- Retry Policy
- Notifications
- Destination Adapter

---

# 10. Connectors Module

Each connector card displays

- Type
- Status
- Authentication
- Last Poll
- Next Poll
- Health

Actions

- Test Connection
- Disable
- Force Poll
- View Logs

---

# 11. Validation Profiles

Displays configurable rule sets.

Rule Categories

- Required Fields
- Shipping
- Product
- Artwork
- Dimensions
- Business Rules

Rules may be enabled, disabled, or configured per customer.

---

# 12. Audit Module

Searchable immutable event log.

Filters

- Customer
- User
- Job
- Connector
- Date
- Severity

Export supported.

---

# 13. Users & Roles

Roles

- Administrator
- Operations
- Customer Success
- Developer
- Read Only

Capabilities are permission-driven.

No permissions should be hardcoded into the UI.

---

# ADR-035 — Screen Consistency

Every administration screen shall implement:

- Search
- Filtering
- Export
- Pagination
- Detail View
- Audit History

This ensures a consistent operator experience across the platform.

---

End of Volume XXI

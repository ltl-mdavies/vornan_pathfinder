
# PATHFINDER SUPERDOC
## Volume VI — Administration Portal, Customer Portal & User Experience Specification
**Version:** 1.0 Draft

---

# 1. Purpose

The Pathfinder user interface exists to configure, monitor, troubleshoot and operate the Pathfinder platform.

The UI is intentionally divided into two experiences:

1. Internal Administration Portal
2. Customer Portal

Internal users manage integrations.

Customers submit and monitor orders.

No customer should ever need access to administrative configuration.

---

# ADR-010 — Configuration Ownership

**Status:** Accepted

Administrative users configure Pathfinder.

Customers consume Pathfinder.

Customer users shall never edit mappings, routes, validation profiles or connectors.

---

# 2. Administration Portal

## Objectives

The Administration Portal is the operational console for Pathfinder.

Every feature should answer one of four questions:

- What is configured?
- What is running?
- What failed?
- How do I fix it?

---

# 3. Primary Navigation

```
Dashboard

Orders
  Queue
  History
  Retry Queue

Customers

Connectors

Input Templates

Output Templates

Product Mapping

Routes

Validation Profiles

Jobs

Audit Log

Settings

Users & Roles
```

---

# 4. Dashboard

The dashboard is the operational landing page.

Widgets:

- Orders Received Today
- Orders Processing
- Successful Orders
- Failed Orders
- Retry Queue
- Active Connectors
- Scheduled Jobs
- Processing Time
- Validation Errors by Type
- Destination Health

Quick Actions:

- Retry Failed
- Upload Test File
- Create Customer
- Test Connector

---

# 5. Orders

## Queue

Displays all in-flight processing jobs.

Columns:

- Status
- Customer
- Source
- Destination
- External Order ID
- Submitted
- Duration

Actions:

- View
- Cancel
- Retry
- Download Canonical JSON

---

## Order Detail

Sections:

Source

Canonical Order

Validation Results

Destination Payload

Submission Response

Attachments

Audit Timeline

Operator Notes

---

# 6. Customers

Each customer contains:

Identity

Connectors

Input Templates

Routes

Validation

Notifications

Product Mapping

Documents

Test Files

Health Status

---

# 7. Input Template Editor

Features:

- Upload Sample File
- Auto Detect Columns
- Drag-and-drop Mapping
- Preview Canonical Output
- Test Parser
- Save Version
- Compare Versions

Future:

AI-assisted mapping recommendations.

---

# 8. Product Mapping

Capabilities:

- Search
- Bulk Import
- Bulk Export
- Missing Unit Numbers
- Duplicate Detection
- Retired Products

Mapping Detail:

Customer SKU

↓

Unit Number

↓

Description

↓

Status

---

# 9. Connectors

Supported connector types:

Wrike

REST API

Webhook

Email

Portal Upload

CSV Watch

Google Drive

SFTP

Each connector displays:

Authentication

Health

Schedule

Last Success

Last Failure

Recent Activity

---

# 10. Retry Queue

Displays permanently failed jobs.

Operator actions:

Edit Canonical Order

Update Product Mapping

Correct Shipping

Revalidate

Resubmit

Archive

Every retry creates a new processing attempt while preserving the original audit history.

---

# 11. Audit Log

Audit events are immutable.

Examples:

Customer Created

Template Published

Mapping Updated

Order Submitted

Retry Requested

Connector Disabled

User Login

---

# 12. Customer Portal

Purpose:

Provide customers with a simple submission experience regardless of technical capability.

---

## Customer Dashboard

Widgets:

Recent Orders

Pending Orders

Validation Errors

Completed Orders

Download Templates

---

## Manual Upload

Workflow:

Select Customer Profile

↓

Drag & Drop File

↓

Upload Artwork (optional)

↓

Template Detection

↓

Preview

↓

Validation

↓

Submit

↓

Confirmation

Supported files:

- Excel
- CSV
- ZIP
- PDF attachments

---

## Order Preview

Displays:

Order Header

Shipping

Order Lines

Artwork

Validation Messages

Customers may correct limited metadata before submission.

---

## Order History

Columns:

Submission Date

Source

Reference Number

Status

Destination

Tracking

Actions:

View

Download

Resubmit (optional by policy)

---

# 13. Permissions

Roles:

Administrator

Operations

Customer Success

Developer

Read Only

Customer

Permissions are role based.

No customer role receives administrative privileges.

---

# ADR-011 — Operational Transparency

Status: Accepted

Every order processed by Pathfinder shall expose sufficient information for an operator to determine:

- What was received.
- What Pathfinder understood.
- What was sent.
- What failed.
- How to recover.

Troubleshooting should never require direct database access.

---
End of Volume VI

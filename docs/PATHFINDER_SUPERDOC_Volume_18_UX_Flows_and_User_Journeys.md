
# PATHFINDER SUPERDOC
## Volume XVIII — UX Flows, Wireframes & End-to-End User Journeys
**Version:** 1.0 Draft

---

# 1. Purpose

This volume documents the expected user experience for both administrators and customers by defining end-to-end workflows rather than individual screens.

The objective is to ensure the Pathfinder UI reflects the underlying processing architecture and exposes every important state transition.

---

# 2. Primary Personas

## Platform Administrator

Responsible for:

- Configuring customers
- Building templates
- Managing connectors
- Monitoring processing
- Resolving failures

## Customer User

Responsible for:

- Submitting orders
- Uploading artwork
- Monitoring order status
- Correcting validation issues

## Operations User

Responsible for:

- Reviewing failed jobs
- Updating mappings
- Retrying submissions
- Monitoring destination health

---

# 3. Customer Onboarding Journey

```
Create Customer
      ↓
Configure Connector
      ↓
Upload Sample Files
      ↓
Build Input Template
      ↓
Configure Product Mapping
      ↓
Configure Validation
      ↓
Configure Route
      ↓
Run Translation Tests
      ↓
Pilot Orders
      ↓
Production
```

Every stage should expose progress and completion status.

---

# 4. Manual Upload Journey

```
Customer Login
      ↓
Select Customer Profile
      ↓
Drag & Drop Spreadsheet
      ↓
Upload Artwork
      ↓
Template Detection
      ↓
Canonical Preview
      ↓
Validation
      ↓
Submit
      ↓
Confirmation
```

---

# 5. Automated Connector Journey

```
Scheduled Job
      ↓
Authenticate
      ↓
Discover Orders
      ↓
Download Attachments
      ↓
Create Processing Job
      ↓
Canonical Translation
      ↓
Validation
      ↓
Routing
      ↓
Destination Submission
      ↓
Audit
```

---

# 6. Failure Recovery Journey

```
Validation Failure
      ↓
Retry Queue
      ↓
Operator Review
      ↓
Correct Mapping
      ↓
Revalidate
      ↓
Resubmit
      ↓
Completed
```

---

# 7. Recommended Dashboard Layout

Top Row

- Orders Today
- Success Rate
- Queue Depth
- Failed Jobs

Middle Row

- Connector Health
- Destination Health
- Average Processing Time

Bottom Row

- Recent Activity
- Retry Queue
- Notifications

---

# 8. Three-Panel Translation View

```
+----------------+----------------+----------------+
| Source         | Canonical      | Destination    |
|                |                |                |
| Original File  | JSON Preview   | Lift Payload   |
| Raw Metadata   | Validation     | API Response   |
+----------------+----------------+----------------+
```

This becomes the primary engineering and support interface.

---

# 9. UX Principles

- Never hide transformed values.
- Every status change should be visible.
- Every validation message should explain how to resolve the issue.
- Operators should never need direct database access.
- Customers should only see information relevant to their own orders.

---

# ADR-033 — Transparency Over Automation

Status: Accepted

Automation should reduce work, not reduce visibility.

Every automated decision must remain explainable through the user interface, logs, or audit history.

---

# 10. Completion Criteria

The Pathfinder user experience is considered complete when:

- New customers can be onboarded without engineering assistance.
- Operators can diagnose failures without developer tools.
- Customers can submit and track orders with minimal training.
- Every processing step is observable from intake through destination submission.

---
End of Volume XVIII

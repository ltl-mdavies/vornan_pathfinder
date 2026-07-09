
# PATHFINDER SUPERDOC
## Volume XXII — Functional Product Specification (Part 2)
### Customer Portal
**Version:** 1.0 Draft

---

# 1. Purpose

The Customer Portal provides a streamlined interface for customers to submit, validate, monitor, and track print orders through Pathfinder without requiring knowledge of the underlying integrations.

The portal should emphasize simplicity while exposing enough transparency that customers understand exactly what Pathfinder received and what will be sent to the destination system.

---

# 2. Design Goals

- Five-minute onboarding for a new customer user.
- Minimal clicks from upload to submission.
- Immediate validation feedback.
- Visibility into processing status.
- No exposure of administrative configuration.

---

# 3. Primary Navigation

```
Home

Submit Order

My Orders

Templates

Documentation

Profile

Support
```

---

# 4. Home Dashboard

Widgets

- Orders Submitted Today
- Orders In Progress
- Orders Awaiting Attention
- Recently Completed
- Recent Notifications

Quick Actions

- Submit New Order
- Download Template
- View Recent Orders

---

# 5. Submit Order Wizard

## Step 1 — Select Customer Profile

If the authenticated user belongs to multiple organizations, prompt for the desired customer profile.

Display:

- Customer Name
- Default Destination
- Supported Intake Types

---

## Step 2 — Upload Files

Supported Inputs

- Excel (.xlsx)
- CSV
- ZIP Artwork Package
- PDF Artwork
- Additional Attachments

Capabilities

- Drag-and-drop
- Multi-file upload
- Progress indicators
- Duplicate detection

---

## Step 3 — Template Detection

Pathfinder attempts to identify the correct Input Template.

Display

- Detected Template
- Confidence
- Template Version

Allow manual override when multiple templates match.

---

## Step 4 — Translation Preview

Three panels

```
Source Summary

↓

Canonical Order Summary

↓

Destination Summary
```

Display

- Order Header
- Ship Date
- Order Lines
- Artwork Count
- Destination

No raw JSON is shown to customer users.

---

## Step 5 — Validation

Validation messages grouped by severity.

PASS

WARNING

ERROR

Each message includes:

- Description
- Affected field
- Suggested resolution

Blocking errors prevent submission.

Warnings allow submission if customer policy permits.

---

## Step 6 — Submit

Confirmation page displays:

- Processing Job ID
- External Order ID
- Submission Timestamp
- Destination
- Estimated Processing Status

---

# 6. My Orders

Columns

- Submitted
- External Order ID
- Status
- Destination
- Ship Date
- Tracking (future)

Filters

- Date
- Status
- Destination

Search

- PO
- Contract
- External Order ID

---

# 7. Order Detail

Tabs

Overview

Order Lines

Validation

Attachments

Processing Timeline

Messages

The timeline should display:

Received

Translated

Validated

Submitted

Completed

or

Failed

---

# 8. Templates

Displays downloadable customer-approved templates.

Columns

- Template Name
- Version
- Last Updated
- Download

Future:

Interactive template builder (admin-approved).

---

# 9. Documentation

Contains:

- Submission Guide
- Accepted File Formats
- Frequently Asked Questions
- Product Mapping Guide
- Contact Information

---

# 10. Profile

User can manage:

- Name
- Email
- Notification Preferences

Future

- API Keys
- Webhooks
- Saved Upload Profiles

---

# 11. Notifications

Customers may receive:

- Order Accepted
- Validation Failed
- Order Submitted
- Destination Failure
- Completed

Channels

- Email
- In-app

Future

- SMS
- Teams
- Slack

---

# 12. Error Recovery

If submission fails before destination delivery:

Customer sees:

- Failure reason
- Recommended action
- Contact support

Customers cannot edit Canonical Orders directly.

Administrative intervention may be required depending on customer policy.

---

# ADR-036 — Simplicity First

The Customer Portal should intentionally expose fewer technical details than the Administration Portal.

Customers should understand what Pathfinder is doing without needing to understand how Pathfinder is implemented.

---

# 13. Accessibility

Requirements

- Keyboard navigation
- Screen reader compatibility
- Responsive layout
- High contrast support
- Clear validation messaging

---

# 14. Success Criteria

A first-time customer should be able to:

1. Download a template.
2. Upload an order.
3. Understand validation results.
4. Submit successfully.
5. Track processing.
6. Receive confirmation.

No product-specific training should be required.

---
End of Volume XXII

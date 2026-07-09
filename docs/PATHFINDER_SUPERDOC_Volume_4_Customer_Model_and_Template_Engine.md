
# PATHFINDER SUPERDOC
## Volume IV — Customer Model, Template Engine & Mapping Architecture
**Version:** 1.0 Draft

---

# 1. Purpose

This volume defines how Pathfinder supports unlimited customer-specific integrations without requiring
changes to the core processing engine.

The primary architectural principle is that every customer is configured—not programmed.

Customer-specific behavior is expressed through configuration objects, templates, mappings, routes,
and connectors.

No customer-specific parsing, business logic, or destination behavior should exist in the core engine.

---

# ADR-005 — Configuration Over Code

**Status:** Accepted

## Decision

New customer onboarding shall be accomplished by creating configuration records and templates rather
than modifying application code.

## Consequences

### Benefits

- Rapid onboarding
- Lower regression risk
- Easier maintenance
- Scalable implementation model

### Tradeoffs

- Requires a sophisticated administration experience.
- Template validation becomes a critical subsystem.

---

# 2. Customer Object

Each Pathfinder customer represents one organization that may submit orders through one or more
intake methods.

Suggested fields:

| Field | Description |
|------|-------------|
| customer_id | Internal Pathfinder identifier |
| customer_name | Display name |
| status | Active / Disabled |
| default_target | Default destination system |
| onboarding_status | Draft / Testing / Production |
| notes | Administrative notes |

Customers own:

- Input Connectors
- Input Templates
- Product Mapping Tables
- Output Routes
- Validation Profiles
- Notification Rules

---

# 3. Input Connectors

A customer may have multiple connectors.

Examples:

- Wrike Polling Connector
- REST API
- Email Inbox
- Manual Upload
- Customer Portal
- Google Drive Watch
- SFTP Folder

Each connector defines:

- Authentication
- Poll schedule
- Trigger conditions
- Attachment behavior
- Customer assignment

Connectors never perform field mapping.

---

# 4. Input Templates

Input Templates define how customer data is translated into the Pathfinder Canonical Order.

Templates are versioned.

Templates are reusable.

Templates are data.

Never code.

## Typical Properties

- Template Name
- Version
- Customer
- File Type
- Worksheet
- Header Row
- First Data Row
- Last Data Rule
- Encoding
- Date Formats
- Required Columns

---

# 5. Field Mapping

Each incoming field maps to one Canonical Order field.

Example

| Customer Column | Canonical Field |
|-----------------|----------------|
| OPS SKU | lines.unit_number |
| Print Qty | lines.quantity |
| Stock | lines.production.material |
| Final Size Width | lines.dimensions.final_width |
| Final Size Height | lines.dimensions.final_height |
| Ship Date | order.ship_date |

Field mappings support:

- Constant values
- Column lookups
- Calculated expressions
- String transforms
- Unit conversions
- Date formatting

---

# 6. Product Mapping

Product Mapping converts customer product identifiers into the canonical product identifier used by
Pathfinder.

Current strategy:

Customer SKU
        ↓
Pathfinder unit_number
        ↓
Lift Unit Number

Because Lift already supports externally assigned Unit Numbers, Pathfinder adopts the Lift Unit Number
as the canonical product identifier.

This avoids introducing unnecessary translation layers.

Suggested Product Mapping fields:

- Customer
- Customer SKU
- Unit Number
- Description
- Status
- Last Updated

---

# ADR-006 — Canonical Product Identifier

**Status:** Accepted

Pathfinder shall use `unit_number` as the canonical product identifier.

Reason:

Existing Lift integrations already use Unit Numbers as externally assignable identifiers.

Introducing an intermediate identifier would increase complexity while providing little architectural value.

---

# 7. Validation Profiles

Each customer may enable or disable validation rules.

Examples:

- Artwork Required
- Ship Date Required
- Material Required
- Dimensions Required
- Duplicate PO Check
- Duplicate External Order Check

Validation Profiles are assigned at the customer level.

---

# 8. Routes

Routes determine where validated orders are delivered.

Examples:

Momentara
→ Lift Graphics

Customer B
→ Lift Labels

Customer C
→ Lift Graphics
→ Shopify

Routes define:

- Destination
- Output Template
- Submission Method
- Retry Policy
- Notifications

---

# 9. Administration UI

Recommended Pages

## Customers

- Customer List
- Customer Detail
- Connectors
- Templates
- Product Mapping
- Routes
- Validation
- Notifications

## Templates

- Template List
- Version History
- Mapping Editor
- Test Parser
- Sample Files

## Product Mapping

- Search
- Bulk Import
- Bulk Export
- Mapping Health
- Missing Unit Numbers

---

# 10. Customer Onboarding Workflow

1. Create Customer
2. Configure Connector
3. Upload Sample Orders
4. Build Input Template
5. Configure Product Mapping
6. Configure Route
7. Configure Validation
8. Test Translation
9. Review Canonical Order
10. Test Output Adapter
11. Production Approval
12. Enable Connector

Completion of these steps should allow a new customer integration without requiring modifications to the
Pathfinder processing engine.

---
End of Volume IV

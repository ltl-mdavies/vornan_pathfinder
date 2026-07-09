
# PATHFINDER SUPERDOC
## Volume XIX — Reference Implementation: Momentara / Wrike → Lift
**Version:** 1.0 Draft

---

# 1. Purpose

This document defines the first production implementation of Pathfinder using the Momentara integration as the reference architecture.

The objective is not to create a one-off integration, but to validate every major subsystem of Pathfinder using a real customer workflow.

---

# 2. Business Scenario

Customer: Momentara

Source System:
- Wrike

Input Format:
- Excel workbook attached to a Wrike task

Destination:
- Lift Standard Graphics

Expected Result:

A Wrike task marked **Ordered** automatically creates a Lift Standard Graphics order without manual data entry.

---

# 3. Source Workflow

1. Momentara prepares their standard Excel order workbook.
2. Workbook is attached to a Wrike "Placard Order" task.
3. Task status changes to **Ordered**.
4. Pathfinder detects the status change.
5. Workbook is downloaded.
6. Workbook is translated into a Canonical Order.
7. Validation executes.
8. Product mappings resolve Unit Numbers.
9. Lift payload is generated.
10. Order is submitted to Lift.
11. Processing results are logged.
12. Wrike may optionally receive a confirmation update.

---

# 4. Required Customer Configuration

Customer Profile

- Customer Name
- Customer ID
- Active Status

Connector

- Wrike API Credentials
- Poll Schedule
- Trigger Status = Ordered

Input Template

- Momentara OOH Order Form
- Header Row
- Data Start Row
- Worksheet Name
- Column Mappings

Product Mapping

OPS SKU
    ↓
Unit Number

Route

Momentara
    ↓
Lift Graphics

Validation Profile

- Ship Date
- Quantity
- Unit Number
- Artwork
- Dimensions

---

# 5. Wrike Connector Responsibilities

The Wrike connector performs only:

- Authentication
- Task discovery
- Attachment download
- Metadata retrieval
- Acknowledgement

The connector performs no parsing or business logic.

---

# 6. Translation Responsibilities

The Translation Engine converts workbook fields into the Canonical Order.

Example mappings:

OPS SKU
→ lines.unit_number

Print Qty
→ lines.quantity

Stock
→ lines.production.material

Final Width
→ lines.dimensions.final_width

Final Height
→ lines.dimensions.final_height

Ship Date
→ order.ship_date

---

# 7. Lift Responsibilities

The Lift adapter:

- Accepts Canonical Order
- Generates Lift JSON
- Resolves customer and Unit Numbers
- Creates Lift order
- Returns submission response

---

# 8. Operational Success Criteria

The integration is considered successful when:

- No manual re-entry is required.
- Every line resolves to a valid Unit Number.
- Validation failures are actionable.
- Orders are fully auditable.
- Operators can retry failed submissions.

---

# 9. Lessons for Future Customers

The Momentara implementation establishes reusable patterns for:

- Wrike integrations
- Spreadsheet-based ordering
- Product mapping
- Customer onboarding
- Validation profiles
- Destination routing

Future customers should primarily require:

- A connector
- An input template
- Product mappings
- A route

No changes to the Pathfinder processing engine should be required.

---

# ADR-034 — Reference Customer

**Status:** Accepted

Momentara shall be treated as the reference customer implementation.

Future customer integrations should reuse the architecture, connector lifecycle, onboarding workflow, and operational model established by this implementation wherever practical.

---

End of Volume XIX

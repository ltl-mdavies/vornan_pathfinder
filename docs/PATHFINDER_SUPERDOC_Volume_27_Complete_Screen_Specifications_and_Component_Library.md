
# PATHFINDER SUPERDOC
## Volume XXVII — Complete Screen Specifications & Component Library
**Version:** 1.0 Draft

---

# 1. Purpose

This volume defines every major Pathfinder screen as an implementation specification. Unlike previous UI volumes, this document breaks the interface into reusable components and specifies behavior, state management, and interactions suitable for direct implementation.

---

# 2. Design System

Pathfinder should be built around a shared component library.

Core components:

- AppShell
- NavigationRail
- TopBar
- Breadcrumbs
- KPI Card
- Status Pill
- Data Grid
- Detail Drawer
- JSON Viewer
- Timeline
- Stepper
- Upload Zone
- Validation Panel
- Side Inspector
- Split View
- Modal Dialog
- Confirm Dialog
- Toast Notification

All pages should compose these components rather than creating page-specific implementations.

---

# 3. AppShell

Persistent Layout

```
+---------------------------------------------------------+
| Top Navigation                                           |
+------------+--------------------------------------------+
| Navigation |                                            |
|            | Main Content                               |
|            |                                            |
|            |                                            |
+------------+--------------------------------------------+
| Status Bar                                             |
+---------------------------------------------------------+
```

Features

- Responsive
- Keyboard shortcuts
- Theme support
- Global search
- Notifications
- User menu

---

# 4. Data Grid Component

Every data grid supports:

- Sorting
- Multi-column filtering
- Column visibility
- Saved layouts
- Bulk selection
- CSV export
- Keyboard navigation
- Infinite scroll (future)

Required columns remain pinned.

---

# 5. Detail Drawer

Purpose

Avoid unnecessary page navigation.

Displays:

- Metadata
- Actions
- Related records
- History
- Audit

Should open from any grid row.

---

# 6. JSON Viewer

Purpose

Inspect Canonical Orders and destination payloads.

Capabilities

- Syntax highlighting
- Collapse/expand
- Copy
- Download
- Search
- Difference comparison (future)

---

# 7. Validation Panel

Groups messages by severity.

Sections

PASS

WARNING

ERROR

Each message includes:

- Code
- Description
- Field
- Suggested resolution

Errors should support deep-linking to the affected object.

---

# 8. Upload Component

Capabilities

- Drag & drop
- Multi-file upload
- Progress
- Validation
- Retry
- Cancel

Supported files determined by customer template.

---

# 9. Timeline Component

Shows immutable chronological events.

Each event contains:

- Timestamp
- Actor
- Event
- Duration
- Metadata

Supports filtering.

---

# 10. Global Search

Searches:

- Customers
- Orders
- Jobs
- Unit Numbers
- Templates
- Connectors

Results grouped by entity type.

---

# 11. Status Pill

Standard states

- Draft
- Active
- Disabled
- Received
- Processing
- Waiting
- Completed
- Failed
- Archived

Status colors should be consistent across the platform.

---

# 12. Split View

Primary engineering screen.

```
Source

↓

Canonical

↓

Destination
```

Resizable panels.

Each panel independently scrollable.

---

# 13. Component Guidelines

Components should be:

- Stateless where practical
- Fully typed
- Reusable
- Independently tested
- Independently documented

No business logic belongs inside presentation components.

---

# ADR-045 — UI Consistency

**Status:** Accepted

Every screen should be assembled from the shared component library.

Visual consistency is preferred over screen-specific customization.

---

# 14. Accessibility

All components must support:

- Keyboard navigation
- Screen readers
- High contrast
- Focus management
- ARIA labels

Accessibility is a release requirement.

---

# 15. Success Criteria

A developer should be able to build any Pathfinder screen using the shared component library without creating new foundational UI controls.

---
End of Volume XXVII

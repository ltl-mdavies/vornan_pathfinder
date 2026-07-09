
# PATHFINDER SUPERDOC
## Volume XXXIII — Configuration Model, Metadata Registry & Version Management
**Version:** 1.0 Draft

---

# 1. Purpose

This volume defines how Pathfinder stores, versions, and manages all configurable platform metadata. The objective is to ensure that new customers, connectors, templates, routes, validation profiles, and destination adapters can be introduced through configuration rather than code changes.

---

# ADR-052 — Metadata Driven Platform

**Status:** Accepted

All customer-specific behavior shall be represented as versioned metadata whenever practical.

The processing engine consumes metadata but does not own it.

---

# 2. Configuration Domains

Configuration is divided into independent domains:

- Customers
- Connectors
- Input Templates
- Output Templates
- Product Mappings
- Validation Profiles
- Business Rules
- Routes
- Notification Profiles
- Lookup Tables
- Destination Adapters

Each domain has its own lifecycle and version history.

---

# 3. Versioning Strategy

Every configurable object contains:

- id
- version
- status (Draft / Published / Archived)
- created_by
- created_at
- published_by
- published_at

Published versions are immutable.

Changes create a new version rather than modifying the existing one.

---

# 4. Draft Workflow

Typical lifecycle:

```
Draft
   ↓
Validation
   ↓
Testing
   ↓
Published
   ↓
Archived
```

Only published configurations participate in production processing.

---

# 5. Configuration Registry

The Configuration Registry is the authoritative catalog of active platform configuration.

Responsibilities:

- Resolve latest published versions
- Maintain historical versions
- Prevent incompatible combinations
- Support rollback

---

# 6. Configuration Resolution

When a processing job begins, Pathfinder resolves:

1. Customer
2. Connector
3. Input Template
4. Validation Profile
5. Product Mapping
6. Route
7. Output Template
8. Destination Adapter

Resolved versions are stored with the processing job to guarantee replay consistency.

---

# ADR-053 — Processing Snapshot

**Status:** Accepted

Each processing job stores the exact configuration versions used during execution.

Future configuration changes must not affect historical processing attempts.

---

# 7. Rollback

Rollback is configuration-based.

Operators may promote a previous published version without modifying application code.

Rollback actions generate audit events.

---

# 8. Configuration Validation

Before publication, Pathfinder verifies:

- Required fields
- Referential integrity
- Duplicate identifiers
- Connector compatibility
- Destination compatibility

Invalid configurations cannot be published.

---

# 9. Dependency Matrix

Examples:

Input Template
    depends on Customer

Route
    depends on Customer and Destination

Validation Profile
    depends on Customer

Output Template
    depends on Destination Adapter

Dependency violations block publication.

---

# 10. Administration UX

Every configurable object should expose:

- Current Version
- Published Version
- Draft Version
- Version History
- Compare Versions
- Rollback
- Publish

---

# ADR-054 — Configuration Transparency

**Status:** Accepted

Operators must always know:

- Which version is active.
- Which version was used by a processing job.
- Who published it.
- When it changed.

Configuration history is part of the audit trail.

---

# 11. Success Criteria

Configuration management is successful when:

- New customer onboarding requires configuration rather than code.
- Historical processing remains reproducible.
- Rollback is safe.
- Configuration changes are auditable.
- Published versions remain immutable.

---
End of Volume XXXIII

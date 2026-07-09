
# PATHFINDER SUPERDOC
## Volume XXXII — Canonical Order Lifecycle, State Machine & Sequence Diagrams
**Version:** 1.0 Draft

---

# 1. Purpose

This volume defines the lifecycle of a Canonical Order from initial discovery through archival. It establishes the state machine used throughout Pathfinder and the sequence of interactions between connectors, processing services, destination adapters, and external systems.

---

# 2. Canonical Lifecycle

```
Discovered
    ↓
Received
    ↓
Raw Archived
    ↓
Canonical Created
    ↓
Validated
    ↓
Resolved
    ↓
Ready
    ↓
Submitted
    ↓
Completed
      │
      └──────► Archived
```

Failure branches may occur from any processing state and transition to **Failed** or **Waiting**, followed by **Retry** or **Cancelled**.

---

# ADR-050 — Explicit State Transitions

**Status:** Accepted

A Canonical Order may only move through predefined state transitions.

No processing stage may skip or invent states.

Every transition must emit an audit event.

---

# 3. State Definitions

## Discovered

A connector has identified a potential source order.

## Received

Source payload has been accepted by Pathfinder.

## Raw Archived

Original submission has been persisted without modification.

## Canonical Created

Input template has successfully translated the submission into the Canonical Order.

## Validated

Validation profile executed successfully.

## Resolved

Product mappings and business rules have completed.

## Ready

Order is approved for destination submission.

## Submitted

Destination adapter has transmitted the payload.

## Completed

Destination acknowledged successful creation.

## Failed

Processing cannot continue without intervention.

## Waiting

Processing intentionally paused pending approval, artwork, schedule, or dependency.

## Archived

Lifecycle complete.

---

# 4. Sequence Diagram — Manual Upload

```
Customer
    │
Upload File
    │
    ▼
Upload Service
    │
Create Job
    │
    ▼
Translation
    │
Canonical
    │
    ▼
Validation
    │
    ▼
Product Resolution
    │
    ▼
Destination Adapter
    │
    ▼
Lift
    │
Response
    │
    ▼
Audit
```

---

# 5. Sequence Diagram — Connector

```
Scheduler
    │
    ▼
Connector
    │
Discover
    │
Download
    │
Create Job
    │
    ▼
Processing Pipeline
```

---

# 6. State Transition Rules

| Current | Allowed Next |
|----------|--------------|
| Discovered | Received |
| Received | Raw Archived |
| Raw Archived | Canonical Created |
| Canonical Created | Validated, Failed |
| Validated | Resolved, Failed |
| Resolved | Ready |
| Ready | Submitted |
| Submitted | Completed, Failed |
| Failed | Waiting, Retry |
| Waiting | Ready, Cancelled |
| Completed | Archived |

---

# 7. Replay Behavior

Replay begins with the archived raw payload.

Replay always creates:

- New Processing Job
- New Canonical Order
- New Audit Events
- New Destination Payload

Historical attempts remain unchanged.

---

# ADR-051 — Replay Instead of Edit

**Status:** Accepted

Corrections never mutate historical Canonical Orders.

A corrected submission always generates a new processing attempt linked to the original job.

---

# 8. Operational Visibility

Every state exposes:

- Entered Timestamp
- Duration
- Worker
- Trigger
- Related Audit Events
- Retry Count

Operators must always know:

- Current State
- Previous State
- Next Expected State

---

# 9. Success Criteria

The lifecycle is considered complete when:

- Every order follows the defined state machine.
- Every transition is auditable.
- Failed processing is recoverable.
- Historical attempts remain immutable.
- State transitions are deterministic.

---
End of Volume XXXII

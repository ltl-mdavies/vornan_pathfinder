
# PATHFINDER SUPERDOC
## Volume XXIII — Functional Product Specification (Part 3)
### Processing Engine, Order Queues & Operational Workflows
**Version:** 1.0 Draft

---

# 1. Purpose

This volume specifies the functional behavior of Pathfinder's processing engine from the perspective of operators. It defines every queue, state transition, retry action, and operational workflow required to process orders reliably.

---

# 2. Processing Objectives

The Processing Engine shall:

- Accept work from multiple intake channels.
- Process jobs independently.
- Expose every processing stage.
- Allow safe retries.
- Preserve complete history.
- Never lose an order.

---

# 3. Processing Dashboard

Primary queues:

```
Incoming
Ready
Processing
Waiting
Retry
Completed
Failed
Archived
```

Each queue displays:

- Job ID
- Customer
- Source
- Destination
- Current Stage
- Started
- Runtime
- Assigned Worker

---

# 4. Processing Job Detail

Header

- Job ID
- Status
- Customer
- Connector
- Destination
- Priority

Actions

- Pause
- Resume
- Retry
- Cancel
- Clone
- Export JSON

---

# 5. Processing Timeline

Every state transition generates an immutable event.

Recommended sequence:

```
Received
↓

Raw Archived
↓

Canonical Created
↓

Validation Started
↓

Validation Complete
↓

Product Resolution
↓

Business Rules
↓

Destination Payload
↓

Submitting
↓

Response Received
↓

Completed
```

Failures branch to Retry.

---

# 6. Retry Queue

Purpose

Provide a controlled workspace for recovering failed jobs.

Failure categories:

- Validation
- Mapping
- Connector
- Destination
- Infrastructure

Operator capabilities:

- View diagnostics
- Edit mappings
- Update metadata
- Revalidate
- Regenerate payload
- Retry submission

Original jobs remain immutable.

---

# 7. Waiting Queue

Jobs may intentionally pause while waiting for:

- Manual approval
- Missing artwork
- Customer response
- Scheduled release
- Destination availability

Waiting reasons must be explicitly stored.

---

# 8. Batch Operations

Operators may select multiple jobs and:

- Retry
- Cancel
- Archive
- Export
- Assign priority

Batch operations create individual audit events per job.

---

# 9. Job Search

Searchable fields:

- Job ID
- Customer
- External Order ID
- PO Number
- Unit Number
- Source System
- Destination
- Status

Advanced filters:

- Date Range
- Connector
- Worker
- Runtime
- Validation Outcome

---

# 10. Queue Metrics

Each queue exposes:

- Count
- Average Age
- Oldest Item
- Average Runtime
- Success Rate
- Retry Rate

Metrics are available by customer and destination.

---

# 11. Worker Model

Workers execute one processing stage at a time.

Responsibilities:

- Claim job
- Execute stage
- Persist result
- Emit event
- Release job

Workers must be stateless.

---

# 12. Processing Locks

To prevent duplicate execution:

- One worker owns one stage.
- Locks expire automatically.
- Abandoned locks may be reclaimed.

---

# ADR-037 — Immutable Job History

Status: Accepted

Processing history shall never be edited.

Corrections create new events and new attempts rather than rewriting history.

---

# ADR-038 — Queue Visibility

Status: Accepted

Every job must always belong to exactly one visible operational state.

Hidden processing states are prohibited.

---

# 13. Success Criteria

Operations staff should be able to determine within thirty seconds:

- What the job is doing.
- Why it failed.
- What action is required.
- Whether it can be retried safely.

No database inspection or application logs should be required for normal operational support.

---
End of Volume XXIII


# PATHFINDER SUPERDOC
## Volume XXVI — Background Jobs, Worker Services & Scheduler Specification
**Version:** 1.0 Draft

---

# 1. Purpose

This volume specifies the asynchronous execution architecture used by Pathfinder. It defines how work is scheduled, distributed, executed, retried, monitored, and recovered.

The objective is to ensure Pathfinder remains responsive regardless of connector count, customer count, or processing volume.

---

# ADR-043 — Asynchronous by Default

**Status:** Accepted

Order intake should return quickly and enqueue work for background processing. Long-running translation, validation, submission, and polling operations shall execute asynchronously.

---

# 2. Worker Architecture

Workers execute a single responsibility.

Recommended worker types:

- Connector Poll Worker
- Translation Worker
- Validation Worker
- Product Resolution Worker
- Routing Worker
- Submission Worker
- Notification Worker
- Cleanup Worker

Workers should be independently scalable.

---

# 3. Scheduler

The Scheduler is responsible for creating work—not processing work.

Responsibilities:

- Execute polling schedules
- Release delayed jobs
- Trigger maintenance tasks
- Execute recurring health checks

The Scheduler never performs business logic.

---

# 4. Job Queue Model

Recommended queues:

```
connector-poll
translation
validation
product-resolution
routing
submission
notification
maintenance
```

Queues should support priority levels:

- High
- Normal
- Low

---

# 5. Connector Poll Worker

Responsibilities

- Authenticate
- Discover new source records
- Download metadata
- Download attachments
- Create Processing Job
- Acknowledge source (when applicable)

No parsing occurs here.

---

# 6. Translation Worker

Responsibilities

- Load Input Template
- Parse source document
- Generate Canonical Order
- Persist Canonical Order
- Emit Translation Complete event

---

# 7. Validation Worker

Responsibilities

- Execute Validation Profile
- Produce structured validation messages
- Update Processing Job status

Blocking failures stop downstream processing.

---

# 8. Submission Worker

Responsibilities

- Generate destination payload
- Authenticate destination
- Submit payload
- Record response
- Update processing status

Submission retries follow configured retry policy.

---

# 9. Notification Worker

Supported events:

- Order Accepted
- Validation Failed
- Submitted
- Completed
- Retry Exhausted

Future channels:

- Email
- Teams
- Slack
- SMS
- Webhooks

---

# 10. Maintenance Jobs

Recommended recurring jobs:

- Archive completed jobs
- Purge expired temporary files
- Verify connector health
- Verify destination health
- Refresh metrics
- Backup configuration
- Validate template integrity

---

# 11. Retry Strategy

Transient failures:

- Network timeout
- Rate limiting
- Temporary destination outage

Retry policy:

- Exponential backoff
- Configurable retry count
- Dead-letter queue after exhaustion

Permanent failures bypass automatic retry.

---

# ADR-044 — Idempotent Workers

**Status:** Accepted

Workers must be safe to execute more than once.

Duplicate execution should not create duplicate destination orders.

Where required, destination adapters shall use external identifiers to prevent duplicate submissions.

---

# 12. Monitoring

Every worker reports:

- Queue depth
- Average execution time
- Failure rate
- Success rate
- Current workload

Worker health should appear on the Administration Dashboard.

---

# 13. Scaling Strategy

Scaling should occur independently by queue.

Example:

Heavy connector polling should not delay submission workers.

Additional workers may be added without changing application code.

---

# 14. Success Criteria

The worker architecture is considered successful when:

- Long-running tasks never block users.
- Queue backlogs are visible.
- Failed jobs are recoverable.
- Worker failures are isolated.
- Horizontal scaling is possible with minimal configuration.

---
End of Volume XXVI


# PATHFINDER SUPERDOC
## Volume XVI — Engineering Standards, Coding Conventions & Contributor Guide
**Version:** 1.0 Draft

---

# 1. Purpose

This volume establishes engineering standards for every contributor to Pathfinder. The objective is to ensure architectural consistency regardless of who implements new features.

---

# ADR-029 — Architecture Before Features

**Status:** Accepted

Every feature proposal must first identify:
- Architectural impact
- Canonical schema impact
- Connector impact
- Destination adapter impact
- Operational impact

Implementation begins only after these questions are answered.

---

# 2. General Engineering Principles

- Prefer composition over inheritance.
- Keep services focused on a single responsibility.
- Business logic belongs in services, never UI.
- UI should orchestrate, not calculate.
- Avoid hidden behavior.
- Favor explicit configuration over implicit assumptions.

---

# 3. Project Structure

```
apps/
  admin/
  portal/
  api/

packages/
  canonical/
  connectors/
  adapters/
  validation/
  routing/
  templates/
  mapping/
  shared/

docs/
tests/
infrastructure/
```

Packages should have minimal dependencies on one another.

---

# 4. Coding Standards

## Naming

Use descriptive names.

Good:
- ProductResolutionService
- ValidationProfile
- CanonicalOrder

Avoid abbreviations unless universally understood.

## Functions

Functions should perform one logical task.

Target length:
- 20–50 lines
- Extract helpers when complexity grows.

## Classes

Classes coordinate work.

Heavy business logic should live in dedicated domain services.

---

# 5. Error Handling

Every thrown error should include:

- error code
- human-readable message
- context object
- suggested recovery

Never swallow exceptions.

---

# 6. Logging

Every processing stage emits structured logs.

Minimum fields:

- job_id
- customer_id
- connector
- stage
- duration_ms
- result

Never log secrets or credentials.

---

# 7. Testing Standards

## Unit Tests

Required for:

- Canonical model
- Template transforms
- Validation rules
- Product resolution
- Routing

## Integration Tests

Required for:

- Connectors
- Destination adapters
- Authentication

## Regression Tests

Every production bug should receive a regression test before closure.

---

# 8. Pull Request Checklist

Before merge:

- Tests passing
- Documentation updated
- ADR required? (if architecture changes)
- Backward compatibility verified
- Logging included
- Metrics included

---

# ADR-030 — Documentation as Code

Documentation is considered part of the implementation.

Architecture changes are incomplete until corresponding SUPERDOC sections are updated.

---

# 9. Definition of Production Ready

A feature is production ready only when it includes:

- Code
- Tests
- Documentation
- Logging
- Metrics
- Error handling
- Operational visibility

---

# 10. Future Contributors

Contributors should assume Pathfinder is a long-lived platform.

When in doubt:

- Extend through templates.
- Extend through connectors.
- Extend through destination adapters.

Avoid modifying the core orchestration engine unless there is clear architectural justification.

---
End of Volume XVI

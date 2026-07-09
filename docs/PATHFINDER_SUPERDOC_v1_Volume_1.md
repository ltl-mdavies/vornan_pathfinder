# PATHFINDER SUPERDOC
## Universal Order Translation & Routing Platform
### Software Architecture Specification
**Version:** 1.0-draft  
**Status:** Living Architecture Document

---

# Preface

This document is the authoritative architectural specification for **Pathfinder**.

It is intended to become the primary reference for all future development. The goal is that a new engineer—or Codex session—should be able to read this document and understand not only *how* Pathfinder works, but *why* it was designed this way.

This specification will evolve alongside the platform.

---

# Table of Contents

## Volume 1 — Vision & Product Definition

1. Executive Summary
2. Vision
3. Business Goals
4. Guiding Principles
5. Core Philosophy
6. Terminology

## Future Volumes

- System Architecture
- Canonical Order Model
- Input Adapter Framework
- Output Adapter Framework
- Template Engine
- Validation Engine
- Product Resolution
- Admin Portal
- Customer Portal
- Database Design
- API Specification
- Lift Connector
- Connector SDK
- Deployment
- MVP Roadmap
- Codex Development Guide

---

# 1. Executive Summary

## Purpose

Pathfinder is a universal order translation platform.

Its purpose is to eliminate duplicate order entry by acting as intelligent middleware between customer ordering systems and LTL production systems.

Rather than building one-off integrations, Pathfinder establishes a reusable platform capable of accepting orders from virtually any source, translating them into a canonical order model, validating and enriching the data, and routing them into one or more destination systems.

The first production implementation will connect Wrike-based customer workflows to Lift, but the platform is intentionally designed to support many future integrations without architectural changes.

---

# 2. Vision

The long-term vision is to make Pathfinder the integration backbone for the LTL/Vornan ecosystem.

Every external order should enter through Pathfinder.

Every internal production platform should receive orders from Pathfinder.

Every customer-specific format should be translated through Pathfinder.

Conceptually:

Any Input
    ↓
Pathfinder
    ↓
Canonical Order
    ↓
Validation
    ↓
Routing
    ↓
Any Output

---

# 3. Business Goals

• Eliminate duplicate order entry.
• Reduce implementation effort for future customer integrations.
• Centralize validation and business rules.
• Support multiple intake methods.
• Support multiple destination systems.
• Preserve complete audit history.
• Provide operational visibility through queues, logs, and retry tools.
• Become the single integration layer between customers and production.

---

# 4. Guiding Principles

1. System agnostic.
2. Customer agnostic.
3. Template-driven.
4. Configuration over code.
5. Canonical-first architecture.
6. Reusable adapters.
7. Observable processing.
8. Safe retry behavior.
9. Human review when automation cannot confidently continue.
10. Extensible without modifying the core engine.

---

# 5. Core Philosophy

Every integration consists of only three responsibilities.

INPUT

Translate whatever the customer provides into the Pathfinder Canonical Order.

CANONICAL

Validate, enrich, resolve products, apply business rules, and prepare the order.

OUTPUT

Translate the canonical order into the destination system's required payload.

This principle must remain true regardless of source or destination.

---

# 6. Scope

Initial supported inputs:

- Wrike
- Excel
- CSV
- Manual Upload
- REST API
- Email Attachments

Initial supported output:

- Lift Standard Graphics Orders

Planned outputs:

- ThinkDifferentPrint eCommerce
- Additional Lift order types
- Future ERP/MIS platforms

---

# Architectural North Star

The most important artifact in Pathfinder is **not** a connector.

It is the **Canonical Order Schema**.

Every connector maps into it.

Every destination maps out of it.

If the canonical schema remains stable, Pathfinder will scale by adding adapters—not by redesigning the platform.

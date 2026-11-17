# Pathfinder working rules

## Proportionate delivery and release work

Read [docs/ITERATIVE_DELIVERY_RULES.md](docs/ITERATIVE_DELIVERY_RULES.md) before planning implementation, validation, or release work. These are Marcus's standing instructions, recorded November 14, 2026: protect his time and credits; keep routine UX iterations routine; do not turn a small release into an infrastructure project.

- Classify the actual change and test its affected behavior. Reuse valid evidence; do not repeat broad suites or reviews without a changed dependency, failure, or concrete unresolved risk.
- Keep approved UI, search, filtering, and performance changes together when appropriate. Identify real dependencies; isolate unrelated unfinished work rather than silently making it a release prerequisite.
- Do not create/recreate cloud test environments, expand release infrastructure, or add approval layers merely to validate routine UI work. Explain a concrete need and obtain authorization for genuinely new scope before incurring it. Existing authorization remains valid within its scope.
- Use the established deployment and rollback process. Preserve customer data/settings, permissions, order idempotency, and unrelated services. Do not waive mandatory workspace deployment requirements.
- State actual blockers and the smallest next action in plain language. Never describe a resource's maximum lifetime as a required test duration.

Applicable ancestor instructions and [Pathfinder UX governance](docs/pathfinder-ux-governance.md) continue to apply. Keep UX review focused on changed screens and reuse already-approved patterns/evidence when unchanged. Explicit current user instructions take precedence over these documented preferences.

These rules must accompany relevant worktrees, archived-source candidates, and handoffs; do not assume instructions in this checkout automatically reach another source tree. Documentation guides agents; it is not an automated deployment lock or permission grant.

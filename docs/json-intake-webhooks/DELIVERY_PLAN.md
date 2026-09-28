# Delivery slices and acceptance

Development is authorized locally; production publication/activation is not part of kickoff. Use current main for each slice, small reviews, and independent feature gates.

## Slice 0 — project baseline and ownership

Copy/verify handoff; record clean base SHA; inventory existing auth/storage/assurance/assets/transport boundaries; publish a short ownership map and first-slice plan to Pathfinder Development. Preserve the exact partner draft. Do not wait for optional future features.

## Slice 1 — schema/adapter and canonical foundation

Implement versioned source validation and additive canonical mapping. Use the four-line sanitized fixture plus valid and invalid cases. No live endpoint needed for this slice. Verify all fields survive round trips; unknown/unsupported values are explicit and actionable, never silently coerced. Validate positive numeric values, IDs, hash formats, one-page requirement, declared size, and approval-file linkage. Scope material rules to the Sticker Press profile. Existing canonical fixtures continue unchanged.

## Slice 2 — durable intake and status, review-only

Implement scoped machine credentials, receipt creation, durable workflow enqueue/outbox with recovery, safe retry/conflict behavior, authenticated status access, and a disabled-by-default isolated router. Design crash recovery between receipt and enqueue. Process restarts/concurrent identical submissions must produce one receipt. Store/customer identities come from credentials. Receipt lookup cannot cross integration boundaries. Expired/revoked/test keys behave correctly. Retain submission evidence safely and redact credentials/query strings.

Initial response should be fast after durable receipt, not wait for Lift/file downloads. Stable machine-readable field issues and customer/internal ownership should reuse Intake Assurance. Schema validation failures must not claim receipt/confirmation success. Blank optional dates use configuration; malformed supplied dates fail explicitly.

## Slice 3 — retained assets and review

Bounded HTTPS retrieval with URL/redirect/host/private-address controls, content and byte limits, timeout, file signature checks, integrity comparison, immutable retention and recovery. Expected tests include expired URL, transient fetch retry, malicious redirect/unsupported location, wrong checksum/size, mismatched approved hash, malformed PDF, wrong pages/geometry, missing named cut metadata, and reference rounding tolerance. Preview failure is distinct from missing production artwork. Retained asset must remain usable after source URL expiry. No PDF mutation or public grant creation.

Source URLs with renewed credentials but identical business content/hash update access metadata without another order. Actual artwork/content changes under existing identity return a conflict requiring review. Use deterministic local/mock fixtures; actual production reference PDFs may be inspected locally and need not be committed.

Milestone: sample order accepted, visible with correct four lines and checks, retry deduplicated, no Lift/Wrike/email/callback calls. Simulate crash/restart recovery and retain first-seen/source times.

## Slice 4 — webhooks and observability

Implement initial three events from committed state via durable outbox; avoid lost events across crashes. Customer endpoint registration/config is trusted/admin-scoped; don't accept arbitrary callback URLs from order JSON. HMAC raw bytes, independent signing keys, timestamps/replay checks, duplicate receiver expectations, attempt ledger, retry policy, terminal failures, support visibility, controlled replay, and authenticated status fallback. Exactly-once HTTP delivery is not promised. Uncertain callback timeouts can be retried under event-ID contract; do not weaken existing no-blind-retry Lift/Wrike semantics.

Run against a local test receiver first. Need approved destination and test activation before external delivery to Andy. Contract changes go through versioned review because he has the original draft. Confirm event subscriptions and shipping scope.

## Slice 5 — Lift translation and controlled test

Local preview portion implemented; see [LIFT_PREVIEW.md](LIFT_PREVIEW.md). Actual customer/catalog verification, production evidence destinations, shipping policy, authoritative bindings and sanctioned target test remain open.

Payload shape approved by Marcus on 2026-09-28. Local export preparation now applies inherited order mappings, validates/formats requested ship and due dates using an optional reviewed target format, and preserves the approved nested null fields. The production registry, route and reviewed-submit integration remain separate work.

Verify Silicon Pasture numeric customer, import/export fields, actual product/material translations in Lift, production notes, spot/approval representation, and document delivery. Do not drop required production information because an export field is unknown. Use a reviewed export preview and sanctioned test route first. Reuse strict EXT_ID reconciliation after uncertain submission, never blind resubmit. One input order = one verified target association. Test confirmation callback/status link generation only after correct association.

## Slice 5b — launch shipping callbacks

Andy now requires `shipment.updated` and `order.shipped` at launch. See [PARTNER_LAUNCH_UPDATE.md](PARTNER_LAUNCH_UPDATE.md) for the reported receiver acceptance, existing draft semantics, prepaid-label tracking requirements and sandbox credential handoff. The local receipt/outbox extension is implemented in [SHIPPING_CALLBACKS.md](SHIPPING_CALLBACKS.md), preserving the accepted signing/envelope/retry contract. Authoritative source adapters, dispatch policy, production bindings and activation remain open. Prepaid labels initially use a reviewed order attachment with a separate auditable dispatch procedure; no automatic shipping inference from label upload.

## Slice 6 — deployment and activation

Follow RELEASE_COORDINATION.md. Deployment and customer activation are separate. Deploy default-disabled shared code only after release review, then enable bounded test intake for the verified customer; production submission comes after partner/production end-to-end acceptance. Shipping callbacks are now a launch requirement under slice 5b; holds/cancellations remain separate source-backed slices.

## Required handoff at each slice

Base/current main SHA, branch/commit, precise files shared with other owners, schema/API changes, tests actually run, remaining failures, rollout flags/config changes, migration/rollback compatibility, remaining decisions, and next concrete slice. Never claim a zero-regression guarantee based only on compile/tests; record limitations and live smoke evidence when later authorized.

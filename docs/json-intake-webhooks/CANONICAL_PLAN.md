# Canonical additions and reusable adapter design

Inspect current main before implementation; locations below were verified in the Sep 28 baseline. Favor small additive changes and preserve defaults/serialization for existing clients.

## Reuse rather than fork

- `packages/canonical/src/index.ts`: CanonicalOrder/CanonicalOrderLine, field registry, validation.
- `packages/templates/src/index.ts`: existing spreadsheet input mapping. Avoid rewriting this path to serve JSON. buildLine does not currently propagate the registered production.cut_type; treat any repair here as a separately reviewed behavior change with Momentara regression tests.
- `packages/lift-adapter/src/index.ts`: target payload generation, configurable exports and validation. Do not assume arbitrary canonical fields are accepted by Lift.
- `apps/api/src/intake-assurance.ts`, intake-runtime-persistence, delivery/reconciliation/dispatch modules: shared receipt/state/error ownership foundations. Inspect actual capabilities and gates; historical docs are not evidence of activation.
- `apps/api/src/server.ts` and store.ts are shared high-conflict files. Prefer isolated routers/services with small reviewed integration points.
- Existing public intake routes are email-verified human/file intake, not a server-to-server credential surface. New API auth must not weaken existing Firebase/public capability boundaries.
- Existing Proof asset services/inspection contracts may provide useful primitives. Coordinate reuse with their owner before changing assumptions or storage; do not route every inbound asset into a public proof/grant automatically.

## Shared module versus adapter

Shared: tenant/integration auth, durable reception, idempotency and URL refresh semantics, versioned schema routing, asset fetch/retention, status projection, webhook outbox, HMAC transport, retries/observability, Intake Assurance and reconciliation linkage.

Adapter/config: stickerpress.order.v1 mapping, source codes, print validation profile, defaults, upstream approval semantics, output route/Lift export mapping. Customer name in the request never chooses a tenant or arbitrary destination. Test credentials can never select a production destination via payload.

Outbound event service must be usable by non-JSON intake methods eventually, without enabling callbacks for existing Wrike customers automatically. Do not create a separate exception/notification ledger if existing generic primitives can be extended safely.

## Fields to retain or add

| Group | Requirements |
| --- | --- |
| Source order | schema/version, store, unique order number, source creation timestamp, submitted timestamp, stable integration ID; separate source ID and generated Lift EXT_ID |
| Source line | external_line_id, store_product, store_variation_id, customer SKU if supplied; separate from target product/unit ID |
| Order metadata | title, PO, notes, type, market, priority, requested dates; do not introduce Momentara-specific required contract number into generic JSON orders |
| Dimensions | final width/height, units explicit, source page and trim geometry, final-size bleed; preserve declared and measured dimensions distinctly |
| Artwork | original filename/format/page count, expected bytes/hash, expiry, source URL (protected), retained asset/version/hash/reference, validation result |
| Preview | reference-only asset URL/expiry/format; not an approval trigger |
| Approval | source/provider, enum approved_by, approved_at, exact artifact hash; optional actual approver identifier only if supplied; no fabricated human identity |
| Cut | type, method, embedded flag, layer name, spot name, shape, optional future corner radius and separate cut artifact reference |
| Production | source material name/code, finish; optional future resolved Lift material ID kept separately; area value, units and bounding-box-times-quantity basis |
| Shipping | method/default policy, shipping mode, blind-ship flag, sender profile/name, prepaid-label asset; destination fields; future package/line quantity allocations |
| Line notes | map latest `note` into line_note |

Adding registry names alone is insufficient: verify types, parsing/mapping, validation, persistence round-trip, preview visibility, and opt-in output projection. Optional new values must not leak into existing Lift payloads or cause required-field failures for existing jobs. Avoid boolean/null loss and coercing an invalid quantity to one. Validate finite positive quantities/dimensions explicitly in the JSON adapter.

Preserve exact source PDF/approval hash through processing. Any transformed derivative must be a separately identified artifact with provenance, not a replacement for approved original. No colors/scaling changes in this module.

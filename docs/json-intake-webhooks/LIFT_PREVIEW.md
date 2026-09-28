# Lift translation review — local slice 5a

Update: [ECOMMERCE_TEMPLATE.md](ECOMMERCE_TEMPLATE.md) adds the requested Lift E-commerce Orders Draft and explicit expanded projection to this local preview. The original release gates below remain open; production evidence now appears in both the proposed payload and the review packet, with target field acceptance still unverified.

The pure `buildJsonLiftPreview` adapter reuses the existing shared `generateLiftPayload` and `validateLiftPayload` functions without changing them or the existing Momentara export path. The committed [sample packet](lift-preview.sample.json) is generated exclusively from the sanitized four-line fixture. It is a review artifact, not a request accepted by a submit route. `review_only: true` and `submission_allowed: false` are unconditional. The preview job/canonical IDs are labels, not persisted jobs. No target endpoint, credentials, HTTP request, order, document grant, submit attempt or confirmation is created.

Reproduce the sample from the repository root:

```sh
node --import tsx/esm scripts/json-intake-lift-preview.ts > docs/json-intake-webhooks/lift-preview.sample.json
```

## Mapping and evidence

A trusted mapping binds customer/integration/store/test environment, mapping revision and review reference. Customer input cannot select it. Exact product selectors include storefront product, variation, material code, finish, cut type and shape. Ambiguous duplicate selectors are rejected. Source product/variation codes never silently become target IDs. The selected identifier mode populates either Lift unit number or product ID, and reviewed material/laminate/cut values remain distinct from source values. Unmatched lines produce explicit gaps. Synthetic tests exercise resolved mappings, but none of those IDs or material values are configured for Silicon Pasture.

The real Silicon Pasture numeric customer ID and Lift product/material translations remain unverified. The handoff explicitly forbids Momentara's customer ID; this Sticker Press adapter rejects it. A mapping review reference records provenance claimed by the caller; it does not verify that claim against Lift. Authoritative read-only verification remains required before a sanctioned target test.

| Information | Preview treatment | Remaining integration work |
| --- | --- | --- |
| Customer, source order and EXT_ID | Existing exporter; immutable JSON EXT_ID must survive exactly | Verify destination customer and accepted EXT_ID length/contract; use same EXT_ID for submission and strict reconciliation |
| Quantities, final dimensions, bleed, titles, notes, ship-to | Existing typed Lift fields; no rounding/resizing | Verify import field semantics and requested-date format |
| Store product/variation, source material/finish/shape | Exact mapping inputs and source evidence beside target values | Obtain real product and production translations; do not equate finish with laminate automatically |
| Cut type/method/spot/layer/in-file flag | Complete evidence retained in packet | Review accepted import/document destinations; named metadata does not prove a painted contour |
| Approval provider/by/time/hash; PDF file/hash/size/pages/boxes | Complete source evidence retained; line/hash/size-bound retained record status | Bind approved original document delivery; no Proof approval manufactured |
| Inspection results | Included only when matching the retained hash; metadata flags alone do not clear review | Verify production policy/security gates; preview does not reread PDF bytes or provide fresh integrity attestation |
| Area | Preserve supplied value, square-inch unit and bounding-box-times-quantity basis | Review Lift destination; never substitute contour area |
| Order type, market, priority and creation date | Evidence beside candidate | Confirm export destinations before submission |
| Blind shipping, sender name, supplier mode and prepaid precedence | Explicit shipping evidence, including false/null-derived presence flags | Verify facility return address, ground method and packing/label exception workflow |
| Blank ship date | Remains absent in existing export and marked unresolved | Configure agreed turnaround; no date fabricated |
| Prepaid label | Presence recorded; supplied-label precedence retained | Verify/retain/deliver label; never buy a replacement or reuse one label for multiple packages |
| Preview image | Format/purpose, explicitly reference-only | No approval/publication implied |

The candidate is intentionally incomplete: structured artwork, preview and label access URLs and local retained paths are excluded. Core source metadata and production evidence remain in the private receipt. Candidate nulls follow the existing Lift exporter's omission behavior; evidence retains meaningful booleans and source approval values. This is an internal review packet, not a public status response: notes, names and ship-to fields are still business data. Do not publish real-customer packets.

The packet and mapping have deterministic SHA-256 review fingerprints. These are review identifiers, not production `SubmitIntegritySnapshot` approvals. Future job persistence, export registry visibility, document publication and reviewed-submit integrity must be integrated together; this new hash does not bypass the existing integrity checks.

## Scope and continuation

This completes the local export-preview portion of slice 5. Full slice 5 remains open: actual customer/catalog verification, approved import destinations for the evidence, return address/ground/date policy, document publication, authoritative job/submission/association bindings and an authorized target test. The existing strict uncertain-submit reconciliation must be reused; no blind retry or alternative association writer was added. Webhook confirmation remains behind its existing injected evidence boundary until authoritative adapters are implemented and tested.

No runtime mount, feature activation, dependency, shared exporter, store, scheduler, Proof, artwork, deployment or partner contract changes. No persistence migration is required. Rollback is removing the optional preview caller while preserving receipts and evidence. The sample is synthetic, includes no retained artwork and must not be mistaken for the separately retained private reference-PDF review. Existing asset-security and release gates remain unchanged.

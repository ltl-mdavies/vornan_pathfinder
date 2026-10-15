# October 15 receipt and callback test

Marcus authorized validation updates, supplied signing-secret setup, and sandbox callback deployment. Jason will supply one Lift product ID for all Andy lines later. Lift owns area pricing; Pathfinder only preserves optional supplied prices. Andy handles color tagging and agreed cut-file preparation; metadata review must not block intake receipt or its received callback. No Lift submission, confirmed/shipped event activation, or shared API/Proof/Status deployment is part of this release.

## Input additions (stickerpress.order.v1)

- Exact materials `White Bopp (Sticker)` and `Clear Bopp (Sticker)` are accepted unchanged. Legacy `White BOPP` remains valid for old receipt replay.
- Input `finish` accepts `Gloss Laminate (.75 mil)` and `Matte Laminate (.71 mil)` and copies these exact strings to canonical `production.laminate`. Legacy `gloss` remains accepted. Source evidence is preserved.
- `material_code` is optional; if supplied it is preserved as a source identifier, not used to choose a material or Lift product.
- Optional `order.pricing`: currency, subtotal, discount, shipping, refund, tax, total. Optional `lines[].pricing`: item_base_price, customer_price. Currency is a three-letter uppercase code; money is a nonnegative decimal string (up to 12 integral and 6 fractional digits) or null. Prices are neither calculated nor required, and totals are not recomputed. Unknown pricing keys are rejected rather than discarded.
- All business fields including prices participate in the existing content-conflict fingerprint. The legacy fixture's complete canonical result, evidence and fingerprint were compared with the previous adapter and are unchanged.
- No color conversion or tagging is performed. Artwork diagnostics and retained originals remain available; receipt acceptance and received callbacks run independently of artwork results. No historic RGB hold is cleared or rewritten by this release.

## Callback scope

Receiver: `https://stickerpress-admin-cfw.andres-59f.workers.dev/webhooks/lift`; key ID `sp-lift-test-2026-09`; scope customer 174094 / stickerpress-sandbox / ltlco / test. The actual partner-supplied secret was retrieved privately and stored separately from intake credentials. The text is used as UTF-8 bytes, not hex decoded; the emailed sample is not used.

Only received and actionable artwork-review events are enabled by this worker. No shipment packages are sent, so the receiver's 12-package limit does not apply to this receipt test; shipping activation must verify it separately. Received callbacks contain the existing relative authenticated status URL resolved against the sandbox intake base.

The receipt allowlist starts empty. Empty is an armed no-op with no receipt, outbox or signing-secret reads. After Andy submits from his release button, add that exact receipt ID to the trusted stack parameter to allow callback processing. This deliberately excludes all old orders and avoids backfill. Do not fabricate an order or Lift/shipping state as a connectivity test. Obtain Andy's receipt ID from his response, then run queue-only inspection before enabling delivery for that receipt.

## Release boundaries and rollback

Fetched main baseline 95e434b35ca189a9d36311b43fd5660106d4b57c was merged before the release; recent product-name and proof/status recovery fixes are preserved. Existing sandbox intake and artwork require CodeKey-only updates because both validate source payloads. All their live parameters/environments stay unchanged. The separate callback stack has its own retained outbox, scoped read-only receipt/S3 access, one exact signing-secret read permission, and three independent enable/delivery/schedule gates.

Rollback callback delivery by disabling its delivery, schedule and worker gates while retaining outbox history. Do not roll intake/artwork back once new-format orders are accepted unless the replacement still supports them. Preserve all receipts and originals. No shared service rollback is required. Private operational evidence is in ignored outputs/callback-release-2026-10-15; do not publish it wholesale.

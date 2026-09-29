# Andy — first test payload

The receipt-only test sandbox is live as of September 29, 2026. Use the agreed `stickerpress.order.v1` input shape. The separate Lift output example is for our internal importer and does not change your contract.

`andy-intake-order.example.json` is a sanitized four-line reference. Its `.invalid` URLs are nonfunctional and its file metadata is illustrative. Replace the order/line IDs, timestamps and file metadata with your actual test values.

## Sandbox access

- Base URL: `https://0kh8s19cc5.execute-api.us-east-1.amazonaws.com`
- Submit: `POST https://0kh8s19cc5.execute-api.us-east-1.amazonaws.com/api/v1/intake/orders`
- Status: authenticated `GET /api/v1/intake/orders/{receipt_id}` on the same base URL.
- Headers: `Content-Type: application/json` and `Authorization: Bearer <securely supplied token>`.
- Credential scope: customer `17409` (Silicon Pasture), integration `stickerpress-sandbox`, store `ltlco`, environment `test`; order receipt read/write only.
- Current test credential expires October 29, 2026 at 13:34:55 UTC. Marcus will supply it separately through secure sharing. No credential is included in this packet.

A new durable receipt returns HTTP 202. An identical replay returns HTTP 200 with the same receipt. Changed business content under the same order identity returns HTTP 409 for conflict review. A receipt is not a Lift order confirmation.

This endpoint validates the input schema and stores receipts durably. It does not download or inspect artwork, create Lift orders, buy labels, or deliver callbacks. Artwork status remains pending. The status route uses the same Bearer credential as submission.

## Prepare the first order

Send one clearly named test order using:

- A unique test order number and stable unique external line IDs.
- Actual reachable HTTPS URLs for the original one-page PDFs, expiry times far enough ahead for testing, exact byte counts and SHA-256 hashes. Provide the download hostname for future retrieval configuration. Do not put API credentials in the JSON.
- Approval metadata whose artwork hash matches the corresponding original PDF exactly.
- The RGB-derived PDF you offered, with its embedded profile retained and no color conversion, and its matching metadata in the JSON.
- Optional reference previews with their real metadata; these are not production originals.
- Your deployed callback receiver URL when ready, supplied separately from the order unless already part of the agreed contract.

For the first test use supplier-purchased shipping (`shipping.label_url: null`). Test a prepaid-label order separately afterward. The current contract supplies one optional label URL; do not add new tracking/package fields without agreeing an additive contract change.

You may send accompanying PDFs for initial inspection if live URLs are not ready, but subsequent retrieval testing needs real URLs. Original bytes must be preserved. Receipt validation is separate from artwork validation, Lift import and production approval.

## First API checks

1. Submit the test JSON and save the receipt ID.
2. Repeat the exact request and verify HTTP 200 with the same receipt ID.
3. Read authenticated status; expect a stored receipt, pending artwork and no Lift order yet.
4. Coordinate a changed-content test under the same order identity; expect HTTP 409.
5. Send Marcus the receipt ID and any validation error details, without credentials.

Outbound callback signing is a separate activation step. No active webhook signing secret has been issued for this sandbox. Intake Bearer authentication and outbound HMAC signing use different secrets. We will preserve the accepted X-Pathfinder/v1 signing contract; `shipment.updated` and `order.shipped` remain required for launch, including prepaid-label shipments.

After artwork processing, Lift mappings and outbound delivery are activated and verified, run a sanctioned end-to-end test with confirmation and shipping callbacks. Use separate purchased-label and prepaid-label cases.

## Message Marcus can send now

Andy — the receipt-only test endpoint is ready: `https://0kh8s19cc5.execute-api.us-east-1.amazonaws.com/api/v1/intake/orders`. I'll share your scoped Bearer token securely and separately; it expires October 29 at 13:34:55 UTC. Please submit one uniquely named test order using the v1 shape we agreed, with matching artwork URLs/file sizes/SHA-256 values and approval metadata. Include the RGB-derived PDF with its profile intact. Start with us purchasing the shipping label; we'll test prepaid separately. Please also send your receiver URL when deployed. This first step stores and validates the order payload; artwork processing, Lift creation and callbacks are not activated yet. Please send me the returned receipt ID so we can review it together.

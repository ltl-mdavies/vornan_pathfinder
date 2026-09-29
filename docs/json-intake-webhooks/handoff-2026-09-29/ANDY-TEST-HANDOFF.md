# Andy — first test payload

We can review your real test JSON and artwork now. Please use the already agreed `stickerpress.order.v1` input shape; the separate Lift output example is for our internal importer and does not change your contract.

`andy-intake-order.example.json` is a sanitized four-line reference. Its `.invalid` URLs are nonfunctional and its file metadata is illustrative. Replace the order/line IDs, timestamps and file metadata with your actual test values. It is not a ready-to-submit live order.

## Send now for file-based validation

Send Marcus one clearly named test JSON file through your existing agreed exchange, with:

- A unique test order number and stable unique external line IDs.
- Actual reachable HTTPS URLs for the original one-page PDFs, expiry times far enough ahead for testing, exact byte counts and SHA-256 hashes. Provide the download hostname so we can configure the allowed host. Do not put API credentials in the JSON.
- Approval metadata whose artwork hash matches the corresponding original PDF exactly.
- The RGB-derived PDF you offered, with its embedded profile retained and no color conversion, and its matching metadata in the JSON.
- Optional reference previews with their real metadata; these are not production originals.
- Your deployed callback receiver URL when ready.

For the first test use supplier-purchased shipping (`shipping.label_url: null`). Test a prepaid-label order separately afterward. The current contract supplies one optional label URL; do not add new tracking/package fields without agreeing an additive contract change.

You may send the PDFs as accompanying files for initial inspection if live URLs are not ready, but end-to-end retrieval testing needs real URLs. We will report validation findings and preserve original bytes. Receipt/asset validation is separate from a Lift order being created or production being approved.

## API access — pending, not yet issued

We have not yet supplied a verified deployed intake endpoint or active credentials. Do not try to use a guessed Pathfinder URL or the published signature-fixture secret.

The implemented relative routes are `POST /api/v1/intake/orders` and authenticated `GET /api/v1/intake/orders/{receipt_id}`. The final deployed base URL must be supplied after provisioning. Requests use `Content-Type: application/json` and a scoped Bearer token. A new durable receipt returns HTTP 202; an identical replay returns HTTP 200 with the same receipt. A changed business order under the same identity requires conflict review, not a new target order. A received response is not order confirmation.

After deployment verification, Marcus will provide the exact base URL, a secure share for the test intake Bearer token, and a separate webhook signing secret/key ID. Intake authentication and outbound HMAC signing use different secrets. We will preserve the accepted X-Pathfinder/v1 signing contract; shipping callbacks remain required for launch.

## Suggested first API checks once access is issued

1. Submit the test JSON; save its receipt and status URL.
2. Repeat the exact request; verify it returns the same receipt.
3. Check authenticated status and artwork validation findings.
4. Exercise agreed callback fixtures/receiver verification, then real test receipt events once outbound delivery is activated.
5. After the Lift mapping is verified, submit a sanctioned sandbox order and verify confirmation and shipment callbacks. Use separate purchased-label and prepaid-label cases.

No real credential, operational URL or promise of current live callback delivery is contained in this packet.

## Message Marcus can send now

Andy — we're ready to review a real test payload while we finish the sandbox setup. Please send me one uniquely named test order JSON using the v1 shape we agreed, along with the matching artwork URLs/file sizes/SHA-256 values and approval metadata. Please include the RGB-derived PDF with its profile intact. Start with us purchasing the shipping label; we'll run a separate prepaid-label test afterward. Please also send your receiver URL when deployed. I'll provide the verified intake URL and separate intake/webhook credentials through secure sharing once the sandbox is ready. Receiving and validating this first file won't create a production order.

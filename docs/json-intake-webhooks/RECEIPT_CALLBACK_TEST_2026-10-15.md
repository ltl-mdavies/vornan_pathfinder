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

## Verified release evidence

PR #357 merged as 5f7393309b0a90af734f3ffe5ff9405d543cd33e. Exact deployed artifact source is 4525b4069b29aafb93f71b2574d29bfffeedf516; merged sandbox source was compared and matches. CI run 38749791623 passed all workspace checks including browser regression and packaging; local API suite passed 736 tests. Independent candidate review passed 49 focused tests plus the callback infrastructure assertion and verified all three ZIP hashes/change-set boundaries.

The intake and artwork updates completed. The separate callback stack was created disabled and returned enabled:false on IAM invocation. All three actual Lambda code hashes match the reviewed artifacts. Live intake checks passed: authenticated status, identical replay 200, changed-content 409, unauthenticated 401. New material/laminate/optional-code/pricing validation was exercised with intentionally invalid quantity, confirming only validation rejection and no order creation. All four existing partner receipt states remained identical. Every pre-existing Vornan Lambda environment and shared Lambda code/revision matched the captured baseline. No shared API, Admin, Proof or Status deployment occurred.

The subsequent empty-list activation change set modifies only the callback worker's two enable environment variables and its schedule State; no replacement or other property change. The trusted receipt list stays empty. Actual receiver delivery and signature acceptance remain to be verified with Andy's fresh receipt, not inferred from local tests or deployment success.

Activation completed with all three stacks UPDATE_COMPLETE. The armed IAM invocation returned enabled:true, delivery_enabled:true, attempted:0, receipts:[]. The rule is ENABLED at two-minute intervals. CloudWatch recorded two completed invocations after activation (one manual smoke and one scheduled invocation) with zero errors. The empty receipt list prevented external sends. Actual partner signature acknowledgment is the remaining test, once Andy provides the fresh receipt ID.

## Fresh-order test checklist

### Capture and verify

Record Andy's source order number, receipt ID, submission time, expected line count and API response. Use authenticated status and trusted receipt storage to verify customer 174094, integration stickerpress-sandbox, store ltlco, environment test, matching source order and PO, and expected line IDs. Confirm no Lift association. Keep credentials, signed artwork URLs and private payloads out of the test report. An artwork review finding does not invalidate receipt acceptance.

### Activate exactly one receipt without a schedule race

1. Read the current callback stack parameters and function configuration; preserve all unrelated values. Confirm the deployed artifact and exact receiver/key binding still match the release record.
2. Set DeliveryEnabled=false and ScheduleEnabled=false first, retaining Enabled=true and the existing receipt list. Wait for UPDATE_COMPLETE and for any invocation started before disabling to finish (worker timeout 120 seconds; inspect completion rather than blindly sleeping). Do not add the new receipt while automatic delivery is still enabled.
3. Set ReceiptIds to a JSON array containing only the verified fresh receipt ID. Review the change set and execute only that parameter change. Do not include old receipts as connectivity tests.
4. Invoke the worker once with delivery off. Review the safe returned event inventory and, using scoped trusted storage access, the committed event body: correct receipt/order/store/environment, event ID, revision, line count and relative status URL. Expect order.received, plus only legitimate current artwork-review events if applicable. Do not interpret queued as delivered. Reject any unexpected confirmation/shipping event.
5. Set DeliveryEnabled=true while leaving ScheduleEnabled=false. After UPDATE_COMPLETE, invoke once and record the event's delivery state, HTTP status and attempt number from the dedicated outbox. Do not change the payload or event ID to retry.
6. Ask Andy to confirm the same event ID/order arrived, signature validation succeeded, and the expected shop state changed. A 2xx only confirms HTTP acknowledgment: Andy's receiver can store events without applying them for an unknown order, so his UI/application confirmation is a separate acceptance criterion.
7. Enable the schedule for this selected receipt if follow-up/retry delivery is needed. Retain audit history. If the test pauses, disable delivery/schedule first; no receipt deletion or order resubmission is required.

### Pass criteria and evidence

- API acceptance: fresh order returns 202 with one durable receipt and correct line IDs/count.
- Receiver acknowledgment: matching order.received event ID receives 2xx; attempt ledger records delivered.
- Partner application: Andy confirms signature success and the intended shop status for the same order. Confirm what his display label means; received does not assert Lift creation or production commencement.
- Scope: no historic-order notifications, no Lift order creation, no confirmed/shipped event, no alteration of approved artwork.
- Optional duplicate check, coordinated with Andy: identical intake replay returns 200 and the same receipt; materialization retains the original received event ID and does not create another received event. Do not deliberately replay an already delivered callback just to force a duplicate. Receiver duplicate-delivery behavior already has local test coverage; any live fault injection is a separately coordinated test.
- Record timestamp, receipt/order/event IDs, HTTP status, attempt count and Andy's confirmation. Report HTTP delivery and partner application outcomes separately. Record any artwork findings as a separate review result.

### Failure handling

- 401/403: pause and verify exact key ID, literal UTF-8 secret interpretation, raw-body signature and timestamp handling with Andy. Never paste the key into the diagnostic report.
- 400 or other non-retryable 4xx: pause; compare the safe event shape with Andy's receiver validation. Receipt events contain no packages; the 12-package limit belongs to the later shipping test.
- 408/425/429, 5xx or network timeout: preserve the same event ID/body and use the existing retry schedule. Timeout means delivery is uncertain, not necessarily absent on Andy's side.
- Paused/exhausted events: repair the cause, then use the existing trusted audited replay helper. No direct DynamoDB edits, outbox deletion, fresh event identity or new order submission to bypass delivery history.
- Unexpected artwork review: inspect the retained-file findings independently. Do not alter artwork or manufacture approval to make the callback test pass.

### Follow-on inputs

Jason's single Lift product ID and import interface readiness remain prerequisites for order creation. The Lift price sheet and interpretation of optional supplied prices remain Alex/Jason/Andy decisions; Pathfinder performs no pricing calculation. Shipping still needs authoritative dispatch/line association and the receiver's 12-package boundary test before launch. Neither product nor price-sheet completion blocks this receipt/callback test.

## Fresh release-button order — verified callback acknowledgment

Andy submitted SPM-D2611133 with receipt `rcpt_1b05a005e1fe64e71a8515dace68753d77c96d727f414d3e07145fb5b767567f`. Trusted receipt verification confirmed the expected customer/integration/test scope, matching order/PO, and three source lines D2611133-1/2/3. All three are 3 inches wide, White Bopp (Sticker), Gloss Laminate (.75 mil), thru-cut. The originals are retained and metadata inspections passed with no receipt issues; this does not claim manufacturing/cut-contour approval. Andy reported the brown-truck preview shows the wrong cut shape and the production PDF contains the intended contour. That preview report is recorded without editing or substituting production artwork.

Delivery and scheduling were paused before selecting only this receipt. Queue-only inspection produced exactly one order.received event, revision 1, line_count 3, null Lift order. Event ID: `evt_3cd3293c2311ece8bec898a645f1a32f7635a820e12f1166b2eef4528037a583`. The signed delivery at 2026-10-15T15:23:03.954Z used key ID sp-lift-test-2026-09 and received HTTP 204 on attempt 1. The outbox state is delivered with no pending retry. A subsequent invocation attempted zero sends and retained attempt_count 1. No historic-order callbacks, confirmed/shipped events or Lift writes were made.

HTTP acknowledgment is verified; Andy's confirmation that his receiver applied the event and displayed the expected shop state remains pending. Private receipt, queue, delivery and parameter-only change-set evidence lives under ignored outputs/andy-release-button-test. Do not publish private receipt payloads or signed source URLs.

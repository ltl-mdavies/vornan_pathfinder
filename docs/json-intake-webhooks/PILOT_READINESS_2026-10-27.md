# Sticker Press supervised pilot preparation — October 27, 2026

This is a preparation and operating plan, not production activation. High End Work and existing receipts/jobs remain unchanged. No new order, callback, credential or scheduler is created by this slice.

## Confirmed decisions and evidence

- Andy owns artwork approval before intake. Jason's Lift rule bypasses local proofing when the supplied status is **Approved**. Marcus clarified this on October 27; the legacy Pending XML example was context, not a request to invert approval semantics.
- `ecomm_product_status.csv` supplied by Marcus identifies Approved as `5217817` and Pending as `5217816`. Both are Active. SHA256: `d7f75e973995c71e427a94c430b5e882295cfea9c098680305ea6546a954c312`.
- New Sticker Press preparation projects the evidence-qualified approval decision into the existing `lines[].approval.proof_status` field as a decimal string ID. Business evidence stays in the original receipt. The existing resolver still requires `auto`, a valid timestamp, and matching retained production artwork; incomplete or conflicting evidence must not be promoted to Approved. Pending is an exception to investigate with Andy, not a request to start a new local proofing workflow.
- Product remains `374549` for every Sticker Press line. White/Clear materials map to `355948`/`362180`; Gloss/Matte laminates map to `354498`/`354757`. These IDs need a fresh receiving-interface check together with approval.
- Andy confirmed A0233832 fully shipped at revision 13, original receipt retained: line 1 qty100 / UPS Ground `1Z60V1570390944077`; lines 2 and 3 qty100 each / UPS Ground `1Z60V1570395841151`. This launch gate is complete. Do not regenerate or resubmit it.
- Billing supplied: Silicone Pasture, 8 the green, Ste b, Dover DE 19901. This is billing, not a shipping override. Jason must verify its application in Lift. Marcus is separately resolving the test address exception with Jason.

## Next fresh controlled test

1. Agree a new test order with Andy, submitted from his normal release button. Keep the original receipt and source order identifiers stable throughout this test.
2. Read current route, template, product and connection settings. Capture their versions and the reviewed mappings; never restore an older whole configuration. Restrict the test to Silicone Pasture 174094, Lift company91, Ecomm route `route-ltl-lift-91-ecomm-orders`, reusable `template-lift-ecommerce-orders`.
3. Retain/verify production PDFs, bind approval to those files and publish verified artwork delivery URLs. Require every line's approval output to be `5217817` for this approved-only pilot. If evidence is missing or yields Pending, hold for correction rather than silently approving it or sending it into a local proof queue.
4. Review exact output: customer174094; product374549; permitted material/laminate IDs; approval5217817; quantities/dimensions; billing; shipping address/service; source order/PO/line IDs; hyphen-safe `order.ext_id`; no root ext_id. Jason verifies intended Lift field paths, IDs, pricing and bypass rule.
5. Submit once through the reviewed normal process. Prove automatic association to the returned Lift order and original receipt. A successful HTTP/import acknowledgment alone is not proof the order exists correctly. If an outcome is uncertain, reconcile before retrying.
6. Verify all lines, artwork and prices in Lift without repairing the payload or manually linking the order. Confirm Jason's rule bypasses proofing. Andy confirms `order.confirmed` on the original receipt. Any manual repair means this acceptance gate remains open.
7. Preserve test evidence and snapshots. Confirm shipping collection/recovery readiness and named operators before admitting real orders.

## Production configuration worksheet — not deployable configuration

The current source identity and authentication explicitly support `test`; the webhook worker also binds `test`. The Lift destination already being PROD does not make partner intake production-ready. This requires reviewed implementation and separate production resources/configuration, not changing a dropdown or reusing a test credential.

| Setting | Prepared requirement / remaining decision |
| --- | --- |
| Customer, company, template, product | 174094 / 91 / Lift Ecomm Orders / 374549; explicit restrictions |
| Production integration ID and environment | New distinct identity; exact name and production enum/wire value still to implement and agree |
| Intake URL and credential | Separate production URL and scoped credential; no test token reuse; hashed credential record, expiration/revocation and least-privilege read/write scopes |
| Callback endpoint and key ID | Andy must confirm production destination and key ID; do not assume his test receiver is the production destination |
| Callback signing secret | Separate secret from intake token and test signing key; exact endpoint/scope/revision binding; share via one-time secure link |
| Data isolation | Separate receipt/outbox/artwork scope, no test receipt migration or historical backfill |
| Output settings | Read the current Ecomm connection; version/fingerprint only intended scoped changes; High End Work untouched |
| Activation switches | Intake, preparation, submit, collection and callback delivery independently disabled until reviewed; queue-only verification before outbound delivery |
| Owner and initial volume | Marcus designates monitoring owner and backup, coverage hours and agreed initial cap; these are launch blockers, not assumed staffing |
| Recovery | Pause new admissions/submission/delivery independently; retain histories and use a history-compatible worker. In-flight requests may finish; inspect ledgers before retry |

## Staff operating checklist

**Before submitting:** verify source receipt/order, customer/route, mapping version, expected product/material/laminate/approval IDs, retained artwork identity and delivery URLs, billing/shipping and prices. Resolve unknown IDs or ambiguous matches before submitting. Approved-only launch means missing approval is a partner correction/hold, not staff approval.

**Uncertain Lift outcome:** freeze that order's submission. Inspect original attempt, EXT_ID, import log and Lift order association. Reconcile to exactly one order using receipt/line/customer evidence. Do not generate a new EXT_ID/PO/title merely to force a retry; that caused duplicate test orders previously. Confirm absence or obtain a reviewed recovery decision before any resend.

**Artwork exception:** preserve original bytes and approval metadata. If the file or version changes, obtain approved replacement evidence from Andy through the supported correction process. Do not reuse old approval or automatically convert color. Existing accepted-order content conflict rules still apply; no new amendment API is implied.

**Shipping:** collect complete scoped source reports and reconcile line quantities/packages against the original receipt and confirmed Lift order. A label or Waiting for pickup status alone is insufficient. Partial shipping must leave unshipped lines open. Emit final shipped only when all quantities are accounted for. Preserve both package identities/tracking numbers and remain within Andy's 12-package event limit.

**Failed callback:** inspect the durable outbox/event ID, attempt and response classification. Retry the same immutable event/body using established recovery; do not resubmit the Lift order or create a new receipt. For endpoint/auth failures, correct the binding/credential through the controlled path. A paused/exhausted event needs audited replay; a delivered event is not reset. Check with Andy when delivery is uncertain.

**Shift reconciliation:** compare accepted receipts, prepared jobs, confirmed Lift associations, shipment snapshots and callback outcomes. Assign an owner to every held/uncertain item. Monitoring/alerts and shift coverage are not yet activated by this plan.

## Routine shipping engineering acceptance

The controlled partial-to-full test is proven; routine automatic collection is not enabled. Implement and test these before promising unattended shipping:

- Persist reviewed report pagination/completeness contracts. Timeout, missing page, repeated page or incomplete report yields a hold, never zero shipped or a complete-order event.
- Durable per-order polling/reconciliation cursor, overlapping poll deduplication, bounded requests and scheduling, fresh source checks before sending, audited hold resolution and monitored failed polls.
- Fix the documented full-to-full correction mismatch: the permit currently expects all projected package events while materialization can enqueue only changed packages. Derive the permitted delta and completion dependencies consistently from immutable prior/current snapshots. Do not just disable the gate or resend unchanged packages to satisfy it.
- Cover late tracking correction for one of two packages, repeat/no-op poll, restart after enqueue, changed source during dispatch, revised quantities/voided package, out-of-order receiver delivery, and final callback dependency on the required package updates. Verify revision semantics with Andy. Preserve historical event bodies and delivered records.
- Establish behavior for orders exceeding 12 packages before accepting such orders. Never truncate a shipping event; hold unsupported cases until a versioned receiver-compatible design is agreed.

## Remaining release gates

Fresh no-repair end-to-end import; Jason's billing/pricing/ID/bypass checks; production identity/runtime support and separate secrets; monitored shipping and later-correction support (or an explicit staffed manual procedure); owner/backup/coverage and initial cap; agreed activation window. Full-shipment confirmation is complete. A separate Lift proof-exception workflow is no longer a prerequisite for Andy's approved-only launch.

See [shared value-map contract](ECOMM_VALUE_MAPPING_CONTRACT.md). No shared mapping service or production scheduling is claimed by these preparation documents.

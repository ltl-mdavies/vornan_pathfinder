# Post-release UX refinement candidate

Baseline: `cd7fb1f4bfe47e0141125d9faef5a353eaf209de`.
Status: implemented for local review; **not deployed**. Final UX review and remaining release checks are required.

## Scope

- Pathfinder signed-in identity uses the 44px pill and 17px user icon, retaining sign-out behavior and narrow-screen accessibility.
- Customers directory uses neutral gutters, a white table, comfortable wrapping rows, market/rep filters, independent Pathfinder membership, and customer-record navigation through the existing guarded handlers.
- Primary Market comes from `PRIMARY_MARKET` in the existing authorized Lift directory feed. No Customer Insights exclusions or name-based joins.
- Customer-level Last confirmed order is independent of loaded Jobs pagination. Missing/unavailable data is not presented as no orders.
- Proof reviewer-save success is a fixed, politely announced, dismissible five-second toast with hover/focus pause. Errors, uncertain saves and other outcomes stay persistent.
- Proof creative rail scales from 128px to 160px. The simple desktop decision dock is compact; multi-creative allocation, feedback, disabled reasons, error results and mobile behavior remain.

No Status code, intake/reconciliation logic, API settings, Share scope, artwork upload activation or email activation is changed.

## Order summary contract

`GET /api/operations/customer-orders` remains inside the existing authenticated Operations boundary and existing feature flag. No new writes, seeding or secret reads. It returns only configured workspace IDs and uses no-store responses.

Eligible records are persisted, non-archived, non-sandbox jobs in Order Confirmed or Completed state, with a nonempty Lift order reference. Only durable `order_confirmed_at` timestamps qualify. Repeated records for the same customer/order use the earliest confirmation; latest unique order wins. Any eligible undated record yields `date_unavailable` rather than a fabricated latest date. Creation/update timestamps are never substitutes.

The reader scans all persisted job pages with a 12-second and 1000-page bound. Corrupt/partial reads fail closed as unavailable. The browser has a 15-second bound and latest-request protection. This is a bounded read model, not a production-validated precomputed aggregate. Production latency/load and historical-state coverage are release gates; especially inspect older records confirmed only through runtime reconciliation. Excluded/cancelled states are not currently counted as confirmed orders.

## Verification

- Full workspace typecheck passed.
- Web and Proof production builds passed; existing Web large-chunk warning remains.
- Final complete workspace tests: 1541 passed, zero failures/skips.
- An earlier repeat had one unexplained 405 instead of 400 in the unchanged Wrike OAuth host-rejection test. Focused file rerun passed 7/7 and the subsequent complete suite passed. Preserve this observation for release review.
- Local actual-component checks at 1366×768, 1920×1080 and 390×844: directory filters/pagination/missing data/long fields/navigation; Proof view-only/actionable and multi-creative states; custom image/PDF zoom/fit; transient-success timing/focus and persistent uncertainty. No proof decisions were submitted.
- PDF surround remains dark; existing pale image surround remains unchanged per UX direction. Artwork pixels are unchanged.

Local synthetic previews:

```sh
npx vite --config tests/browser/fixtures/vite.config.ts --port 5406
node --import tsx/esm tests/browser/fixtures/proof-refinement-preview.mts
```

Customers: `http://127.0.0.1:5406/customers-refinement.html` (`?unknown=1` / `?empty=1` for setup/data states).
Proof: `http://127.0.0.1:5407/?scenario=multi#/proof`; scenarios: view, review, multi, pdf, transparent, uncertain. Synthetic participant identity is shared within the fixture server; no real accounts or external API proxy. Other endpoints reject writes.

## Release gate

Obtain final UX review; validate production summary reads and legacy data; rerun authenticated integration/dirty-form checks; reconcile latest main and separate Proof work; review narrow API/frontend artifacts and rollback. Keep deployment held. Do not change Share permissions or activate pending upload/email functionality as part of this batch.

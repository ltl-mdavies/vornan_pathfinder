# Post-release UX refinement candidate

Baseline: `cd7fb1f4bfe47e0141125d9faef5a353eaf209de`.
Status: approved for the scoped release after final artifact, rollback and concurrency gates; deployment receipts are maintained in private release storage.

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

The reader scans persisted job pages with a 12-second, 25-page and 5000-read-capacity budget. Exceeding a budget or encountering corrupt/partial records fails closed as unavailable. The router retains one exact-membership summary for up to 60 seconds per warm process, coalesces concurrent matching requests and serializes different memberships. It keeps the original checked_at, never serves expired data on error, and returns no-store HTTP responses. The column tooltip discloses the one-minute delay. The browser has a 15-second bound and latest-request protection.

One bounded production read covered 220 jobs over 11 pages in about 1.4 seconds, using 2700 read-capacity units including membership. One eligible historical confirmation lacked a date and correctly yielded date_unavailable. This is not a distributed cache or maintained index: cold instances and fleet growth can multiply reads, and growing history can hit the fail-closed budgets. Current production load acceptance remains an explicit release gate; a passing single read is not a concurrency certification. Excluded/cancelled states are not counted as confirmed orders.

## Verification

- Full workspace typecheck passed.
- Web and Proof production builds passed; existing Web large-chunk warning remains.
- Latest complete workspace tests after cache/budget guards: 1544 passed, zero failures/skips. Typecheck passed again. A sandboxed repeat could not bind local HTTP test servers; the rerun with local server permissions passed.
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

UX accepted the visual candidate and one-minute tooltip clarification. Authenticated full-App directory/navigation and import-method dirty-form checks passed. A bounded production check of the actual summary reader with 20 simultaneous requests and 20 warm repeats performed one underlying load (11 pages, 220 jobs, 2693 job read-capacity units), completing the cold batch in 1.274 seconds and the warm batch in under one millisecond. This clears the current small internal-directory read-load gate, not a distributed fleet or future-growth certification. Maintain the fail-closed budgets and revisit a maintained summary before expanding usage or history materially. Final configured artifact/dry-run, durable rollback and live concurrency checks remain mandatory before mutation. Do not change Share permissions or activate pending upload/email functionality as part of this batch.

The pre-existing customer Proof-settings draft-navigation gap is tracked separately. No customer settings are saved or changed by this refinement batch; the existing import-method guard remains intact.

Main API compatibility: canonical upload-gating correction f128f7a was intentionally deployed only to the public Proof Lambda. The main API retains older asset-upload-config.ts and asset-upload-service.ts by design. Proof owner confirmed this scope. A main-API-only isolated build must overlay those two modules from the freshly verified live source map, without reverting canonical source or deploying the public/operator/scanner functions. The local rehearsal verifies exact retained module hashes, unique source matches, unchanged dependencies and all non-main ZIP members. Its source-map diff allows only the new customer-order-summary module and changes to store, operations/router and customer-directory. A generic API rebuild/deploy would silently widen this scope and is prohibited for this release.

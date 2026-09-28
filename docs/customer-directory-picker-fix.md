# Customer selector correction — 2026-09-28

The Admin customer selector had two independent limits: initial/retry loading called the seed-only directory API path, and rendering truncated the matching customer list to eight rows. Searching could not find customers absent from the seed, and scrolling could not reveal truncated matches.

The client now requests the existing `/api/lift/customers?refresh=1` endpoint on initial load, retry and refresh. All matching rows render inside the existing bounded scroll container. Name, ID and customer-number searches operate over the loaded directory; an unmatched search displays an empty-result message rather than injecting the selected customer as an apparent match.

Refresh preserves an established customer selection. A seed fallback retains the prior loaded directory; an incomplete live response retains the selected customer record. Neither switches tenants or reloads another workspace. A request sequence guard ignores superseded responses and prevents them from clearing the current loading state. Safe sidebar messages distinguish stale/limited lists, missing selection and partial status enrichment without displaying upstream endpoint/error details. Cold-start default selection remains unchanged.

Validation:

- All 148 web tests pass, including four new directory/search/state cases; web TypeScript check passes.
- Local Chromium check against the actual Admin frontend with mocked APIs: 31 customers render and scroll, name/ID search finds the final entry (Silicon Pasture / 17409), unmatched search is empty, seed fallback retains the selected workspace and list, refresh disables while pending, HTTP failure preserves selection, and successful retry clears the warning. All observed API requests were GETs. No Lift connection or customer data was used.
- Browser fixture initially omitted unrelated catalogue fields and was corrected before the successful check. The CLI wrapper was unavailable locally; the check used the repository's installed Playwright browser library. No package installation was required.

This is a local Admin frontend correction. No server/endpoint implementation, customer workspace creation, route/configuration, live customer verification or deployment changed. Admin deployment is required before the hosted application benefits. The live endpoint's completeness/pagination and live customer identity have not been independently verified by these mocked tests.

Marcus supplied Silicon Pasture's Lift customer ID as 17409. Its provenance and the retained-original artwork delivery recommendation are recorded in `json-intake-webhooks/LIFT_PREVIEW.md`; no verified target mapping was fabricated.

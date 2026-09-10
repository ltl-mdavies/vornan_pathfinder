import { test, expect } from "@playwright/test";
test("receipt review survives resolved intake, paginates, retries failures and resets on customer switch", async ({ page }) => {
  let fail = false;
  await page.route("**/api/customers/*/intake-exceptions?*", route => route.fulfill({ json: { rows: [], next_cursor: null, checked_at: "2026-09-10T12:00:00Z" } }));
  await page.route("**/api/customers/*/intake-deliveries?*", route => {
    const url = new URL(route.request().url());
    if (fail) return route.fulfill({ status: 503, json: { error: "unavailable" } });
    if (url.pathname.includes("fixture-b")) return route.fulfill({ json: { rows: [], next_cursor: null } });
    const second = url.searchParams.has("cursor");
    return route.fulfill({ json: { rows: [{ receipt_id: second ? "second" : "first", attempt_id: second ? "Resolved request B" : "Resolved request A", kind: "source_feedback", state: second ? "sent" : "uncertain", needs_review: !second,
      updated_at: "2026-09-10T12:00:00Z", dispatch_started_at: "2026-09-10T12:00:00Z", provider_message_id: second ? "COMMENT1" : null }], next_cursor: second ? null : "next-page" } });
  });
  await page.goto("/intake-exceptions");
  await expect(page.getByText("No intake exceptions found.")).toBeVisible();
  await expect(page.getByText("Outcome uncertain — review required")).toBeVisible();
  fail = true;
  await page.getByRole("button", { name: "Load more receipts" }).click();
  await expect(page.getByText("Could not load delivery receipts. Please retry.")).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Load more receipts" }).click();
  await expect(page.getByText("Provider acknowledged", { exact: true })).toBeVisible();
  await expect(page.getByText("Resolved request A", { exact: true })).toBeVisible();
  await page.screenshot({ path: "/tmp/intake-delivery-review.png", fullPage: true });
  await page.getByRole("button", { name: "Switch customer" }).click();
  await expect(page.getByText("No delivery receipts found.")).toBeVisible();
  await expect(page.getByText("Resolved request A", { exact: true })).toHaveCount(0);
});

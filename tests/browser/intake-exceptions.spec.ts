import { expect, test } from "@playwright/test";
test("Exceptions UI paginates past empty pages, displays failures and clears prior customer data", async ({ page, context }) => {
  let fail = false;
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1:5190") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (fail) return route.fulfill({ status: 503, json: { error: "temporary" } });
    const secondCustomer = url.pathname.includes("fixture-b");
    const later = url.searchParams.has("cursor");
    return route.fulfill({ json: { checked_at: "2026-09-10T12:00:00Z", next_cursor: !secondCustomer && !later ? "next-page" : null,
      rows: !secondCustomer && later ? [{ attempt_id: "request", provider: "wrike", source_id: "Source A", state: "customer_action_required", owner: "customer", reason: "missing_order_grid", created_at: "2026-09-10T10:00:00Z", next_action_at: "2026-09-10T11:00:00Z", overdue: true, job_id: null, confirmed_order_number: null }] : [] } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/intake-exceptions");
  await expect(page.getByText("No exceptions on the pages loaded. More requests are available.")).toBeVisible();
  await page.getByRole("button", { name: "Load more requests" }).click();
  await expect(page.getByText("No job created")).toBeVisible();
  await expect(page.getByText("missing order grid")).toBeVisible();
  await page.getByRole("button", { name: "Switch customer" }).click();
  await expect(page.getByText("No intake exceptions found.")).toBeVisible();
  await expect(page.getByText("Source A")).toHaveCount(0);
  fail = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not load intake exceptions");
});

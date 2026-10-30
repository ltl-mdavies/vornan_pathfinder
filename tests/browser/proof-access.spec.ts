import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { demoActivityForHash, demoOrderForHash } from "../../apps/proof/src/demo";
import { fileURLToPath } from "node:url";

const origin = "http://127.0.0.1:5191";
const access = `${origin}/#/access/${"A".repeat(43)}`; // Synthetic, never sent outside localhost.
const pdf = fileURLToPath(new URL("../../apps/proof/public/brand/proof-placeholder.pdf", import.meta.url));

async function fixture(context: BrowserContext, options: {
  exchangeStatus?: number; orderStatus?: number; expiresAt?: string; exchangeNetworkFailure?: boolean; holdExtension?: boolean;
} = {}) {
  const requests: string[] = [];
  const external: string[] = [];
  const unexpected: string[] = [];
  let active = true;
  let holdNextOrder = false;
  let releaseOrder: (() => void) | undefined;
  let releaseExtension: (() => void) | undefined;
  await context.addCookies([{ name: "fixture-session", value: "existing", url: origin }]);
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "assets.fixture.invalid") {
      return route.fulfill({ contentType: "application/pdf", path: pdf });
    }
    if (url.origin !== origin) {
      external.push(url.origin);
      return route.abort("blockedbyclient");
    }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const key = `${route.request().method()} ${url.pathname}`;
    requests.push(key);
    if (key === "POST /api/public/proof/sessions") {
      if (options.exchangeNetworkFailure) return route.abort("failed");
      const status = options.exchangeStatus ?? 201;
      return route.fulfill({ status, json: status === 201
        ? { authenticated: true, expires_at: new Date(Date.now() + 600_000).toISOString() }
        : { error: "Synthetic exchange rejection" } });
    }
    if (key === "DELETE /api/public/proof/sessions/current") {
      active = false;
      return route.fulfill({ status: 204 });
    }
    if (key === "POST /api/public/proof/sessions/current/extend") {
      if (options.holdExtension) await new Promise<void>((resolve) => { releaseExtension = resolve; });
      return route.fulfill({ json: { extended: true, expires_at: new Date(Date.now() + 600_000).toISOString() } });
    }
    if (key === "POST /api/public/proof/order/refresh") return route.fulfill({ json: { refresh_queued: true } });
    if (key === "GET /api/public/proof/order") {
      if (holdNextOrder) {
        holdNextOrder = false;
        await new Promise<void>((resolve) => { releaseOrder = resolve; });
        // Deliberately return a stale success even after local/session teardown.
      } else if (!active || options.orderStatus === 401) {
        return route.fulfill({ status: 401, json: { error: "Synthetic session expiry" } });
      }
      const order = structuredClone(demoOrderForHash("#/proof/assets-qa"));
      order.last_synced_at = new Date().toISOString();
      return route.fulfill({ json: {
        order, participant: null, activity: demoActivityForHash("#/proof"), refresh_queued: false,
        session_expires_at: options.expiresAt ?? new Date(Date.now() + 600_000).toISOString()
      } });
    }
    unexpected.push(key);
    return route.fulfill({ status: 404, json: { error: "Outside isolated test scope" } });
  });
  return {
    requests,
    holdOrder: () => { holdNextOrder = true; },
    releaseOrder: () => { expect(releaseOrder).toBeDefined(); releaseOrder!(); },
    orderHeld: () => Boolean(releaseOrder),
    extensionHeld: () => Boolean(releaseExtension),
    releaseExtension: () => { expect(releaseExtension).toBeDefined(); releaseExtension!(); },
    assertIsolated: () => { expect(external).toEqual([]); expect(unexpected).toEqual([]); }
  };
}

async function unavailable(page: Page) {
  await expect(page.getByRole("heading", { name: "This proof link isn’t available" })).toBeVisible();
  await expect(page).toHaveURL(/#\/link-unavailable$/);
  await expect(page.locator(".task-card, .proof-document-viewer, .proof-image")).toHaveCount(0);
}

for (const status of [401, 403, 404, 410, 503]) {
  test(`exchange ${status} does not load another cookie's order or end its session`, async ({ page, context }) => {
    const f = await fixture(context, { exchangeStatus: status });
    await page.goto(access);
    await unavailable(page);
    await expect(page.getByRole("main")).toBeFocused();
    expect(f.requests).toEqual(["POST /api/public/proof/sessions"]);
    if (status === 503) await expect(page.getByText(/We couldn’t open this proof link/)).toBeVisible();
    else await expect(page.getByText(/invalid, expired, or has already been used/)).toBeVisible();
    if (status === 401) await page.screenshot({ path: "output/playwright/proof-access-unavailable.png" });
    f.assertIsolated();
  });
}

test("network exchange failure does not replay or clean up a different session", async ({ page, context }) => {
  const f = await fixture(context, { exchangeNetworkFailure: true });
  await page.goto(access);
  await unavailable(page);
  await expect(page.getByText(/We couldn’t open this proof link/)).toBeVisible();
  expect(f.requests).toEqual(["POST /api/public/proof/sessions"]);
  f.assertIsolated();
});

test("malformed link does not exchange, load an order, or end a session", async ({ page, context }) => {
  const f = await fixture(context);
  await page.goto(`${origin}/#/access/invalid`);
  await unavailable(page);
  expect(f.requests).toEqual([]);
  f.assertIsolated();
});

for (const exchange of [true, false]) {
  test(`${exchange ? "exchanged" : "existing"} session order401 stays fail-closed`, async ({ page, context }) => {
    const f = await fixture(context, { orderStatus: 401 });
    await page.goto(exchange ? access : `${origin}/#/proof`);
    await expect(page.getByRole("heading", { name: "Your secure session has ended" })).toBeVisible();
    await expect.poll(() => f.requests.filter((r) => r.startsWith("DELETE")).length).toBe(1);
    await expect(page.locator(".task-card, .proof-document-viewer")).toHaveCount(0);
    expect(f.requests).toEqual([
      ...(exchange ? ["POST /api/public/proof/sessions"] : []),
      "GET /api/public/proof/order", "DELETE /api/public/proof/sessions/current"
    ]);
    f.assertIsolated();
  });
}

for (const expiresAt of ["2000-01-01T00:00:00.000Z", "invalid"]) {
  test(`session expiry ${expiresAt} remains fail-closed`, async ({ page, context }) => {
    const f = await fixture(context, { expiresAt });
    await page.goto(access);
    await expect(page.getByRole("heading", { name: "Your secure session has ended" })).toBeVisible();
    await expect.poll(() => f.requests.filter((r) => r.startsWith("DELETE")).length).toBe(1);
    await expect(page.locator(".task-card, .proof-document-viewer")).toHaveCount(0);
    f.assertIsolated();
  });
}

test("rejected link in another tab leaves original session and custom PDF controls usable", async ({ page, context }) => {
  const f = await fixture(context, { exchangeStatus: 401 });
  await page.goto(`${origin}/#/proof`);
  await expect(page.getByRole("heading", { name: "Summer retail rollout" })).toBeVisible();
  const second = await context.newPage();
  await second.goto(access);
  await unavailable(second);
  await page.reload(); // Confirms the original session was not remotely ended.
  const controls = page.getByRole("group", { name: "PDF proof viewer controls" });
  await expect(controls).toBeVisible();
  await controls.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(page.locator(".proof-document-canvas").first()).toBeVisible();
  await expect(page.locator("iframe, embed, object")).toHaveCount(0);
  await page.screenshot({ path: "output/playwright/proof-access-original-session.png" });
  expect(f.requests.filter((r) => r.startsWith("DELETE"))).toEqual([]);
  f.assertIsolated();
});

test("valid access exchange loads Proof normally", async ({ page, context }) => {
  const f = await fixture(context);
  await page.goto(access);
  await expect(page.getByRole("heading", { name: "Summer retail rollout" })).toBeVisible();
  await expect(page.getByRole("group", { name: "PDF proof viewer controls" })).toBeVisible();
  expect(f.requests).toEqual(["POST /api/public/proof/sessions", "GET /api/public/proof/order"]);
  f.assertIsolated();
});

test("late queued order success cannot revive a locally ended session", async ({ page, context }) => {
  const f = await fixture(context);
  await page.goto(access);
  await expect(page.getByRole("heading", { name: "Summer retail rollout" })).toBeVisible();
  f.holdOrder();
  await page.getByRole("button", { name: "Request latest proof details" }).click();
  await expect.poll(f.orderHeld).toBe(true);
  await page.getByRole("button", { name: "End secure session" }).click();
  await expect(page.getByRole("heading", { name: "Your secure session has ended" })).toBeVisible();
  const response = page.waitForResponse((r) => r.url().endsWith("/api/public/proof/order"));
  f.releaseOrder();
  await response;
  await expect(page.getByRole("heading", { name: "Your secure session has ended" })).toBeVisible();
  await expect(page.locator(".task-card, .proof-document-viewer")).toHaveCount(0);
  expect(f.requests.filter((r) => r.startsWith("DELETE"))).toHaveLength(1);
  f.assertIsolated();
});

test("late background success cannot revive an ended session", async ({ page, context }) => {
  const f = await fixture(context);
  await page.clock.install();
  await page.goto(access);
  await expect(page.getByRole("heading", { name: "Summer retail rollout" })).toBeVisible();
  f.holdOrder();
  await page.clock.fastForward(60_001);
  await expect.poll(f.orderHeld).toBe(true);
  await page.getByRole("button", { name: "End secure session" }).click();
  await expect(page.getByRole("heading", { name: "Your secure session has ended" })).toBeVisible();
  const response = page.waitForResponse((r) => r.url().endsWith("/api/public/proof/order"));
  f.releaseOrder();
  await response;
  await expect(page.getByRole("heading", { name: "Your secure session has ended" })).toBeVisible();
  await expect(page.locator(".task-card, .proof-document-viewer")).toHaveCount(0);
  expect(f.requests.filter((r) => r.startsWith("DELETE"))).toHaveLength(1);
  f.assertIsolated();
});

test("late session extension cannot restore expired proof content", async ({ page, context }) => {
  const f = await fixture(context, { holdExtension: true, expiresAt: new Date(Date.now() + 45_000).toISOString() });
  await page.clock.install();
  await page.goto(access);
  await page.getByRole("button", { name: "Continue reviewing" }).click();
  await expect.poll(f.extensionHeld).toBe(true);
  await page.clock.fastForward(46_000);
  await expect(page.getByRole("heading", { name: "Your secure session has ended" })).toBeVisible();
  const response = page.waitForResponse((r) => r.url().endsWith("/sessions/current/extend"));
  f.releaseExtension();
  await response;
  await expect(page.getByRole("heading", { name: "Your secure session has ended" })).toBeVisible();
  await expect(page.locator(".task-card, .proof-document-viewer")).toHaveCount(0);
  expect(f.requests.filter((r) => r.startsWith("DELETE"))).toHaveLength(1);
  f.assertIsolated();
});

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const fixtureSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">
    <rect width="640" height="400" fill="#fffef9"/>
    <circle cx="84" cy="84" r="36" fill="#abc65f"/>
    <path d="M84 60v48M60 84h48" stroke="#39523b" stroke-width="10" stroke-linecap="round"/>
    <text x="140" y="95" font-family="Arial,sans-serif" font-size="34" font-weight="700" fill="#263e2a">FIXTURE PROOF</text>
  </svg>
`;

const viewports = [
  { name: "desktop", width: 1366, height: 768 },
  { name: "mobile portrait", width: 390, height: 844 },
  { name: "mobile landscape", width: 844, height: 390 },
  { name: "compact mobile", width: 320, height: 568 }
] as const;

async function isolateNetwork(context: BrowserContext) {
  const blocked: string[] = [];
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:5190" && !url.pathname.startsWith("/api/")) {
      await route.continue();
      return;
    }
    if (url.hostname === "assets.fixture.invalid") {
      await route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: fixtureSvg
      });
      return;
    }
    blocked.push(url.toString());
    await route.abort("blockedbyclient");
  });
  return blocked;
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
    && document.body.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true);
}

async function waitForProofWorkspace(page: Page) {
  await expect(page.getByRole("heading", { name: "Summer retail rollout" })).toBeVisible();
}

for (const viewport of viewports) {
  test(`Proof remains contained at ${viewport.name} (${viewport.width}x${viewport.height})`, async ({ page, context }) => {
    const blocked = await isolateNetwork(context);
    await page.setViewportSize(viewport);
    await page.goto("/proof#/proof");
    await waitForProofWorkspace(page);

    await expectNoHorizontalOverflow(page);
    const preview = page.locator(viewport.width > 820 && viewport.height > 480
      ? ".preview-stage .proof-image"
      : ".mobile-feed .feed-card:first-child .proof-image");
    const previewContainer = page.locator(viewport.width > 820 && viewport.height > 480
      ? ".preview-stage"
      : ".mobile-feed .feed-card:first-child .feed-preview");
    await expect(preview).toBeVisible();
    const [imageBox, containerBox] = await Promise.all([preview.boundingBox(), previewContainer.boundingBox()]);
    expect(imageBox).not.toBeNull();
    expect(containerBox).not.toBeNull();
    expect(imageBox!.x).toBeGreaterThanOrEqual(containerBox!.x - 1);
    expect(imageBox!.y).toBeGreaterThanOrEqual(containerBox!.y - 1);
    expect(imageBox!.x + imageBox!.width).toBeLessThanOrEqual(containerBox!.x + containerBox!.width + 1);
    expect(imageBox!.y + imageBox!.height).toBeLessThanOrEqual(containerBox!.y + containerBox!.height + 1);

    const decisionButtons = page.locator(".action-transport:visible button");
    await expect(decisionButtons).not.toHaveCount(0);
    for (let index = 0; index < await decisionButtons.count(); index += 1) {
      await expect(decisionButtons.nth(index)).toBeDisabled();
    }

    await page.goto(`/proof?fixture=assets-${encodeURIComponent(viewport.name)}#/proof/assets-qa`);
    await waitForProofWorkspace(page);
    await expectNoHorizontalOverflow(page);
    expect(await page.getByText("north-wall-final-proof-with-an-intentionally-long-filename-for-responsive-review.pdf").count()).toBeGreaterThan(0);

    if (viewport.width > 820 && viewport.height > 480) {
      const queue = page.locator(".task-list");
      expect(await queue.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
      await expect(queue).toHaveCSS("overflow-y", "auto");
    }
    expect(blocked).toEqual([]);
  });

  test(`shared proof card remains contained at ${viewport.name} (${viewport.width}x${viewport.height})`, async ({ page, context }) => {
    const blocked = await isolateNetwork(context);
    await page.setViewportSize(viewport);
    await page.goto("/order-rollup");

    const filename = page.locator(".order-rollup__proof-filename");
    await expect(filename).toBeVisible();
    await expect(filename).toHaveCSS("overflow-wrap", "anywhere");
    await expectNoHorizontalOverflow(page);
    const card = page.locator(".order-rollup__proof-card");
    const [filenameBox, cardBox] = await Promise.all([filename.boundingBox(), card.boundingBox()]);
    expect(filenameBox).not.toBeNull();
    expect(cardBox).not.toBeNull();
    expect(filenameBox!.x + filenameBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 1);

    const control = page.getByRole("link", { name: "View proof" });
    await expect(control).toHaveCount(1);
    await expect(control).toHaveAttribute("href", "https://assets.fixture.invalid/proof-high.svg");
    await expect(control).toHaveAttribute("target", "_blank");
    await expect(control).toHaveAttribute("rel", "noreferrer");
    const popupPromise = page.waitForEvent("popup");
    await control.click();
    const popup = await popupPromise;
    await expect.poll(() => popup.url()).toBe("https://assets.fixture.invalid/proof-high.svg");
    await popup.close();
    expect(blocked).toEqual([]);
  });
}

test("Proof preserves dialog focus return and full-resolution image target", async ({ page, context }) => {
  const blocked = await isolateNetwork(context);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/proof#/proof");
  await waitForProofWorkspace(page);

  const feedbackButton = page.getByRole("button", { name: "Feedback" }).first();
  await feedbackButton.click();
  await expect(page.getByRole("dialog", { name: "Feedback" })).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(feedbackButton).toBeFocused();

  const imageLink = page.getByRole("link", { name: "Open north-wall-v2.jpg full size in a new tab" });
  await expect(imageLink).toHaveAttribute("href", "/brand/proof-placeholder.svg");
  await expect(imageLink).toHaveAttribute("target", "_blank");
  await expect(imageLink).toHaveAttribute("rel", "noreferrer");
  const popupPromise = page.waitForEvent("popup");
  await imageLink.click();
  const popup = await popupPromise;
  await expect.poll(() => popup.url()).toBe("http://127.0.0.1:5190/brand/proof-placeholder.svg");
  await popup.close();
  expect(blocked).toEqual([]);
});

test("Proof renders terminal focus and atomic alert without retained proof data", async ({ page, context }) => {
  const blocked = await isolateNetwork(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/proof#/session-ended");

  const terminal = page.getByRole("main", { name: "Your secure session has ended" });
  await expect(terminal).toBeVisible();
  await expect(terminal).toBeFocused();
  await expect(terminal.getByRole("alert")).toContainText("Your secure session has ended");
  await expect(page.locator(".task-card, .feed-card, .proof-image")).toHaveCount(0);
  expect(blocked).toEqual([]);
});

test("Proof renders PDF and non-preview fallbacks deterministically", async ({ page, context }) => {
  const blocked = await isolateNetwork(context);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/proof#/proof/assets-qa");
  await waitForProofWorkspace(page);

  await expect(page.locator(".preview-stage iframe[title^='PDF proof preview']")).toBeVisible();
  await page.getByRole("option", { name: /north-wall-layered-production-artwork-with-linked-assets\.psd/ }).click();
  await expect(page.locator(".preview-stage").getByText("Full-resolution file", { exact: true })).toBeVisible();
  await expect(page.locator(".preview-stage").getByRole("link", { name: /Open north-wall-layered-production-artwork/ })).toHaveAttribute("target", "_blank");
  await page.getByRole("option", { name: /north-wall-preview-processing-pending\.tiff/ }).click();
  await expect(page.locator(".preview-stage").getByText("Preview unavailable", { exact: true })).toBeVisible();
  expect(blocked).toEqual([]);
});

test("Proof honors reduced-motion preferences", async ({ page, context }) => {
  const blocked = await isolateNetwork(context);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/proof#/proof");
  await waitForProofWorkspace(page);

  const motion = await page.locator(".task-card").first().evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      transitionDuration: style.transitionDuration,
      animationDuration: style.animationDuration
    };
  });
  expect(motion.transitionDuration).toBe("0s");
  expect(Number.parseFloat(motion.animationDuration)).toBeLessThanOrEqual(0.00001);
  expect(blocked).toEqual([]);
});

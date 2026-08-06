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
      if (url.pathname.endsWith(".pdf")) {
        await route.fulfill({
          status: 200,
          contentType: "application/pdf",
          body: "%PDF-1.4\n%%EOF"
        });
        return;
      }
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

    const visibleTransport = page.locator(".action-transport:visible").first();
    const simpleDecisionButtons = visibleTransport.locator(".transport-buttons > button");
    if (await simpleDecisionButtons.count()) {
      for (let index = 0; index < await simpleDecisionButtons.count(); index += 1) {
        await expect(simpleDecisionButtons.nth(index)).toBeDisabled();
      }
    } else {
      await expect(visibleTransport.getByRole("button", { name: "Approve this creative" })).toBeEnabled();
      await expect(visibleTransport.getByRole("button", { name: "Request changes" })).toBeDisabled();
      await expect(visibleTransport.locator("[data-quantity-assignment-trigger]")).toBeDisabled();
    }

    await page.goto(`/proof?fixture=assets-${encodeURIComponent(viewport.name)}#/proof/assets-qa`);
    await waitForProofWorkspace(page);
    await expectNoHorizontalOverflow(page);
    expect(await page.getByText("north-wall-final-proof-with-an-intentionally-long-filename-for-responsive-review.pdf").count()).toBeGreaterThan(0);

    if (viewport.width > 820 && viewport.height > 480) {
      const queue = page.locator(".task-list");
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
    const thumbnail = card.locator("img");
    const [filenameBox, cardBox, thumbnailBox] = await Promise.all([
      filename.boundingBox(),
      card.boundingBox(),
      thumbnail.boundingBox()
    ]);
    expect(filenameBox).not.toBeNull();
    expect(cardBox).not.toBeNull();
    expect(thumbnailBox).not.toBeNull();
    expect(filenameBox!.x + filenameBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 1);
    expect(thumbnailBox!.width).toBeGreaterThanOrEqual(110);
    await expect(page.getByText("Qty 1 · 46.375”h x 30.375”w")).toBeVisible();
    await expect(page.getByText("INTERNAL-PRODUCT-ID")).toHaveCount(0);

    const control = card.getByRole("button", { name: /^Open high-resolution proof / });
    await expect(control).toHaveCount(1);
    await control.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("img", { name: /^High-resolution proof / })).toHaveAttribute("src", "https://assets.fixture.invalid/proof-high.svg");
    await expect(dialog.getByRole("link")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    await page.goto("/order-rollup?document=pdf");
    const pdfControl = page.getByRole("button", { name: "Open high-resolution proof proof-packet.pdf" });
    await pdfControl.click();
    const pdfDialog = page.getByRole("dialog");
    await expect(pdfDialog.locator("iframe")).toHaveAttribute("src", "https://assets.fixture.invalid/proof-packet.pdf");
    await expect(pdfDialog.locator("iframe")).toHaveAttribute("title", "High-resolution proof proof-packet.pdf");
    await expect(pdfDialog.locator("iframe")).not.toHaveAttribute("sandbox");
    expect(blocked).toEqual([]);
  });
}

test("Proof saves, reviews, processes, and summarizes a multi-proof allocation without network transport", async ({ page, context }) => {
  const blocked = await isolateNetwork(context);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/proof#/proof/batch-qa");
  await waitForProofWorkspace(page);

  const proofQueue = page.getByRole("complementary", { name: "Proof queue" });
  await expect(proofQueue.getByRole("button", { name: "Line 1 North wall graphic Qty 20 · 4 awaiting review 4 proofs" })).toBeVisible();
  await expect(proofQueue.getByRole("button", { name: "Line 2 Register counter decal Qty 2 · 1 awaiting review 1 proof" })).toBeVisible();
  await expect(proofQueue.getByRole("button", { name: "Creative 1 north-wall-v2.jpg Pending" })).toHaveCount(0);
  await expect(proofQueue.locator(".line-group-thumbnail")).toHaveCount(2);
  await expect(page.locator(".preview-filebar")).toContainText("north-wall-v2.jpg");
  const visibleTransport = page.locator(".action-transport:visible");
  await expect(visibleTransport.getByText("Select each creative you want to approve, then assign its quantity.")).toBeVisible();
  await expect(page.getByLabel("Message with approval (optional)")).toHaveCount(0);
  await expect(visibleTransport.locator("[data-quantity-assignment-trigger]")).toBeDisabled();

  const creativeLabels = ["north-wall-v2.jpg", "north-wall-panel-2.jpg", "north-wall-panel-3.jpg", "north-wall-panel-4.jpg"];
  await page.getByRole("button", { name: new RegExp(`Creative 1: ${creativeLabels[0]}`) }).click();
  await visibleTransport.getByRole("button", { name: "Approve this creative" }).click();
  await visibleTransport.getByRole("button", { name: "Undo" }).click();
  await expect(visibleTransport.getByText("0 of 4 selected for approval")).toBeVisible();
  await expect(visibleTransport.locator("[data-quantity-assignment-trigger]")).toBeDisabled();

  for (let index = 0; index < creativeLabels.length; index += 1) {
    await page.getByRole("button", { name: new RegExp(`Creative ${index + 1}: ${creativeLabels[index]}`) }).click();
    await visibleTransport.getByRole("button", { name: "Approve this creative" }).click();
    await expect(visibleTransport.getByText("Ready to submit")).toBeVisible();
  }
  await expect(visibleTransport.getByText("4 of 4 selected for approval")).toBeVisible();

  await visibleTransport.locator("[data-quantity-assignment-trigger]").click();
  const dialog = page.getByRole("dialog", { name: "Assign quantities" });
  await dialog.getByLabel("Quantity for creative 1").fill("8");
  await dialog.getByLabel("Quantity for creative 2").fill("4");
  await dialog.getByLabel("Quantity for creative 3").fill("4");
  await dialog.getByLabel("Quantity for creative 4").fill("4");
  await expect(dialog.getByText("Ready to approve")).toBeVisible();
  await dialog.getByRole("button", { name: "Continue to review" }).click();

  const confirmation = page.getByRole("dialog", { name: "Submit these approvals?" });
  await expect(confirmation.getByText("Total quantity")).toBeVisible();
  await expect(confirmation.getByText("20", { exact: true })).toBeVisible();
  await confirmation.getByLabel("Message with approval (optional)").fill("Approved quantities for the production team.");
  await confirmation.getByRole("button", { name: "Submit approvals to print" }).click();
  await expect(page.getByRole("dialog", { name: /Approving creative/ })).toBeVisible();
  const result = page.getByRole("dialog", { name: "Your proofs and quantities are now approved" });
  await expect(result).toBeVisible({ timeout: 6_000 });
  await expect(result.getByText("After refresh")).toBeVisible();
  await expect(result.getByText("Approved", { exact: true })).toHaveCount(4);
  expect(blocked).toEqual([]);
});

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
  await page.getByRole("button", { name: "Creative 2: north-wall-layered-production-artwork-with-linked-assets.psd; Pending", exact: true }).click();
  await expect(page.locator(".preview-stage").getByText("Full-resolution file", { exact: true })).toBeVisible();
  await expect(page.locator(".preview-stage").getByRole("link", { name: /Open north-wall-layered-production-artwork/ })).toHaveAttribute("target", "_blank");
  await page.getByRole("button", { name: "Creative 3: north-wall-preview-processing-pending.tiff; Pending", exact: true }).click();
  await expect(page.locator(".preview-stage").getByText("Preview unavailable", { exact: true })).toBeVisible();
  expect(blocked).toEqual([]);
});

test("Proof honors reduced-motion preferences", async ({ page, context }) => {
  const blocked = await isolateNetwork(context);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/proof#/proof");
  await waitForProofWorkspace(page);

  const motion = await page.locator(".line-group-summary").first().evaluate((element) => {
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

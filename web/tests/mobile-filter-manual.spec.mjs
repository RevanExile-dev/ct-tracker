import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

async function touchSwipe(page, fromY, toY) {
  const session = await page.context().newCDPSession(page);
  const x = 195;
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y: fromY }],
  });

  const steps = 8;
  for (let i = 1; i <= steps; i += 1) {
    const y = fromY + ((toY - fromY) * i) / steps;
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y }],
    });
    await page.waitForTimeout(18);
  }

  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await session.detach();
  await page.waitForTimeout(500);
}

test.describe("mobile filters: scroll touch non cambia apertura", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("chiusi restano chiusi e aperti restano aperti durante swipe", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

    const wrap = page.locator('[data-testid="toolbar-collapse"]');
    const handle = page.getByRole("button", { name: /Nascondi filtri|Mostra filtri/i });
    await expect(wrap).toBeVisible({ timeout: 30_000 });
    await expect(handle).toBeVisible();

    // La maniglia mobile deve essere piu' facile da colpire della vecchia
    // freccina da ~24px.
    const handleBox = await handle.boundingBox();
    expect(handleBox).not.toBeNull();
    expect(handleBox.height).toBeGreaterThanOrEqual(36);

    // Stato chiuso scelto dall'utente.
    await handle.tap();
    await page.waitForTimeout(400);
    const hiddenHeight = (await wrap.boundingBox()).height;
    expect(hiddenHeight).toBeLessThan(50);
    await expect(handle).toHaveAttribute("aria-expanded", "false");

    // Swipe verso l'alto: la pagina scorre verso il basso, ma i filtri non
    // devono riaprirsi da soli.
    await touchSwipe(page, 720, 220);
    const afterDownScroll = await page.evaluate(() => window.scrollY);
    expect(afterDownScroll).toBeGreaterThan(50);
    await expect(handle).toHaveAttribute("aria-expanded", "false");
    expect((await wrap.boundingBox()).height).toBeLessThan(50);

    // Swipe opposto: nemmeno tornando verso l'alto deve scattare il vecchio
    // auto-reveal.
    await touchSwipe(page, 230, 650);
    await expect(handle).toHaveAttribute("aria-expanded", "false");
    expect((await wrap.boundingBox()).height).toBeLessThan(50);

    // Solo il tap esplicito riapre.
    await handle.tap();
    await page.waitForTimeout(400);
    await expect(handle).toHaveAttribute("aria-expanded", "true");
    const shownHeight = (await wrap.boundingBox()).height;
    expect(shownHeight).toBeGreaterThan(100);

    // Anche da aperta, uno swipe non la richiude automaticamente durante
    // l'interazione touch.
    await touchSwipe(page, 720, 300);
    await expect(handle).toHaveAttribute("aria-expanded", "true");
    expect((await wrap.boundingBox()).height).toBeGreaterThan(100);
  });
});

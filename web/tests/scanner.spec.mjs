import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

// PNG 1x1: basta a verificare il percorso upload/detection fallback senza
// dipendere dal CDN OCR o da fixture binarie nel repository.
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z9ZkAAAAASUVORK5CYII=",
  "base64",
);

test.describe("scanner CartaViva", () => {
  test("route visibile e upload entra nello stato di analisi", async ({ page }) => {
    await page.goto(`${BASE_URL}/scan`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Inquadra/i })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /Carica una foto/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Apri la fotocamera/i })).toBeVisible();

    const input = page.locator('input[type="file"]').first();
    await input.setInputFiles({ name: "scanner-test.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG });
    await expect(page.getByText(/Nessun bordo sicuro|carta rilevata/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Sessione/i)).toBeVisible();
  });

  test.describe("mobile touch", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test("nessun overflow e target principali tappabili", async ({ page }) => {
      await page.goto(`${BASE_URL}/scan`, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: /Inquadra/i })).toBeVisible({ timeout: 30_000 });
      const metrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
      await expect(page.getByRole("button", { name: /Carica una foto/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /Apri la fotocamera/i })).toBeVisible();
    });
  });
});

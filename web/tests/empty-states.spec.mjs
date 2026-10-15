// Primo contatto: binder vuoto con tasti verso catalogo e scanner (tocchi veri).
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

test("binder vuoto: dal testo ai tasti catalogo e scanner in 1 tocco", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ct-tracker:binder:v2", "[]"));
  await page.goto(`${BASE_URL}/binder`);
  await expect(page.locator("body")).toContainText("Il Binder è ancora vuoto", { timeout: 20_000 });
  const scan = page.getByRole("link", { name: /Scansiona una carta/ });
  expect((await scan.boundingBox()).height).toBeGreaterThanOrEqual(43);
  await scan.tap();
  await expect(page).toHaveURL(`${BASE_URL}/scan`);
});

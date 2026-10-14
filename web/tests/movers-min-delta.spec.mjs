import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("movers nasconde le variazioni sotto 1€ di default e le mostra col tocco", async ({ page }) => {
  const urls = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/movers")) urls.push(r.url());
  });
  await page.goto(`${BASE_URL}/movers`, { waitUntil: "domcontentloaded" });
  // I filtri su telefono stanno dietro il pulsante "Filtri" (chiusi di default).
  await page.getByRole("button", { name: /^Filtri/ }).tap();
  const toggle = page.getByRole("button", { name: "Nascondo variazioni sotto 1€" });
  await expect(toggle).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => urls.some((u) => u.includes("minDeltaCents=100"))).toBe(true);

  await toggle.tap();
  await expect(page.getByRole("button", { name: "Mostro anche sotto 1€" })).toBeVisible();
  await expect(page).toHaveURL(/piccole=1/);
  await expect.poll(() => urls.some((u) => !u.includes("minDeltaCents"))).toBe(true);
});

// "Conviene comprare ora?" sulla scheda carta, tap veri su telefono e PC.
// Dati di tests/fixtures/smoke-seed.sql: 950001 (storico 25 gg, minimo 10,00 €,
// attuale 14,00 €), 950002 (1 sola rilevazione).
import { test, expect, devices } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const SHOTS = process.env.BUY_NOW_SHOTS;

for (const [name, opts] of [
  ["iPhone 13 (tap)", { viewport: devices["iPhone 13"].viewport, userAgent: devices["iPhone 13"].userAgent, hasTouch: true, isMobile: true }],
  ["PC", { viewport: { width: 1280, height: 800 } }],
]) {
  test.describe(`conviene comprare ora - ${name}`, () => {
    test.use(opts);

    test("verdetto contro il minimo e classifica per totale stimato", async ({ page }) => {
      await page.goto(`${BASE_URL}/card/950001`);
      const box = page.getByTestId("buy-now");
      await expect(box).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("buy-now-verdict")).toHaveAttribute("data-tone", "wait");
      await expect(page.getByTestId("buy-now-verdict")).toContainText("40% sopra il minimo");
      const rows = page.getByTestId("buy-now-ranked").locator("li");
      await expect(rows).toHaveCount(3);
      // 12,50 + 8,50 (DE), 14,00 + 8,50 (IT), 15,00 + 8,50 (FR); l'inserzione US e' esclusa.
      await expect(rows.nth(0)).toContainText("zero-de");
      await expect(rows.nth(0)).toContainText("21,00");
      await expect(rows.nth(2)).toContainText("zero-fr");
      await expect(box).not.toContainText("zero-us");
      await expect(page.getByTestId("buy-now-nohub")).toContainText("cheap-no-hub");
      if (SHOTS) await box.screenshot({ path: `${SHOTS}/${name.startsWith("PC") ? "pc" : "telefono"}-conviene.png` });
      // niente scroll orizzontale
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflow).toBe(false);
    });

    test("storico corto: nessun verdetto ma la classifica c'e'", async ({ page }) => {
      await page.goto(`${BASE_URL}/card/950002`);
      await expect(page.getByTestId("buy-now-no-verdict")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("buy-now-verdict")).toHaveCount(0);
      await expect(page.getByTestId("buy-now-ranked").locator("li")).toHaveCount(1);
      if (SHOTS) await page.getByTestId("buy-now").screenshot({ path: `${SHOTS}/${name.startsWith("PC") ? "pc" : "telefono"}-storico-corto.png` });
    });
  });
}

import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

// Tocchi veri (CLAUDE.md, regola 6) e anche PC: il pulsante "Occasioni" e' sempre
// visibile, non sta dietro il pannello Filtri.
for (const variant of [
  { name: "telefono", opts: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, tap: true },
  { name: "PC", opts: { viewport: { width: 1366, height: 900 } }, tap: false },
]) {
  test.describe(`/movers Occasioni - ${variant.name}`, () => {
    test.use(variant.opts);

    async function press(locator) {
      if (variant.tap) await locator.tap();
      else await locator.click();
    }

    test("filtra per soglie, passa dall'URL e il reset lo toglie", async ({ page }) => {
      const urls = [];
      page.on("request", (r) => {
        if (r.url().includes("/api/movers")) urls.push(r.url());
      });
      await page.goto(`${BASE_URL}/movers?tab=drops&period=30`, { waitUntil: "domcontentloaded" });
      const visible = (text) => page.getByText(text).locator("visible=true");
      await expect(visible(/Mover Card/).first()).toBeVisible({ timeout: 15_000 });

      const toggle = page.getByRole("button", { name: "Occasioni" });
      await page.waitForTimeout(300); // hydration su runner lenti
      await press(toggle);
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      await expect(page).toHaveURL(/occasioni=1/);
      await expect.poll(() => urls.some((u) => u.includes("occasioni=1"))).toBe(true);

      // Resta solo la carta che supera tutte le soglie.
      await expect(visible(/Occasione Valida/).first()).toBeVisible({ timeout: 15_000 });
      for (const n of ["Occasione Ribasso Lieve", "Occasione Poche Inserzioni", "Occasione Prezzo Vecchio", "Occasione Prezzo Basso", "Mover Card"]) {
        await expect(page.getByText(n)).toHaveCount(0);
      }

      // Si riparte da pulsante spento.
      await press(toggle);
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
      await expect(visible(/Mover Card/).first()).toBeVisible({ timeout: 15_000 });
    });

    test("da URL parte gia' attivo", async ({ page }) => {
      await page.goto(`${BASE_URL}/movers?tab=drops&occasioni=1&period=30`, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("button", { name: "Occasioni" })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByText(/Occasione Valida/).locator("visible=true").first()).toBeVisible({ timeout: 15_000 });
    });
  });
}

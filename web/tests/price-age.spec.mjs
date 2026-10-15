// Prezzo non aggiornato da >= 7 giorni: etichetta discreta (scheda, tile) e
// niente variazione/ribasso costruiti su quel prezzo. Tap veri su telefono.
import { test, expect, devices } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
// Dati di tests/fixtures/smoke-seed.sql: 903004 ha il prezzo di 10 giorni fa, 903001 di oggi;
// entrambe con un ribasso rispetto al confronto.
const STALE_ID = 903004;
const FRESH_ID = 903001;

for (const [name, opts] of [
  ["iPhone 13 (tap)", { viewport: devices["iPhone 13"].viewport, userAgent: devices["iPhone 13"].userAgent, hasTouch: true, isMobile: true }],
  ["PC", { viewport: { width: 1280, height: 800 } }],
]) {
  test.describe(`freschezza prezzo - ${name}`, () => {
    test.use(opts);

    test("scheda: etichetta solo sul prezzo vecchio", async ({ page }) => {
      await page.goto(`${BASE_URL}/card/${STALE_ID}`);
      await expect(page.getByTestId("price-age")).toHaveText(/prezzo di 10 gg fa/, { timeout: 15_000 });
      await page.goto(`${BASE_URL}/card/${FRESH_ID}`);
      await expect(page.getByTestId("it-nm-zero-line")).toBeVisible();
      await expect(page.getByTestId("price-age")).toHaveCount(0);
    });

    test("movers: il ribasso su prezzo vecchio non compare, quello fresco si", async ({ request }) => {
      const names = [];
      for (const page of [1, 2, 3]) {
        const res = await request.get(`${BASE_URL}/api/movers?direction=drop&page=${page}`);
        names.push(...(await res.json()).cards.map((c) => c.name));
      }
      expect(names).toContain("Occasione Valida");
      expect(names).not.toContain("Occasione Prezzo Vecchio");
    });
  });
}

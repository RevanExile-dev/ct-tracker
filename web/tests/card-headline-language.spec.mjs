// Scheda carta: il prezzo grande dice in che lingua e' (prima 3,53 € "Prezzo
// migliore" era inglese senza dirlo, mentre l'italiano NM Zero da 7,13 € stava
// in piccolo sotto) e l'offerta italiana, se diversa, risalta. Risposta API
// simulata con i valori reali di Snorlax (15 ott), tap/touch veri.
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

test("prezzo grande con lingua, offerta italiana in evidenza", async ({ page }) => {
  await page.route(/\/api\/cards\/903001$/, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({
      response: res,
      json: { ...body, best_price_cents: 353, best_price_currency: "EUR", best_language: "en", best_condition: "Near Mint", it_nm_zero_price_cents: 713, it_nm_zero_price_currency: "EUR" },
    });
  });
  await page.goto(`${BASE_URL}/card/903001`);
  await expect(page.getByTestId("headline-language")).toContainText("EN", { timeout: 30_000 });
  const it = page.getByTestId("it-nm-zero-line");
  await expect(it).toContainText("7,13");
  await expect(it).toHaveClass(/text-ink-primary/);
});

// Scheda carta: il prezzo grande dice in che lingua e' (prima 3,53 € "Prezzo
// migliore" era inglese senza dirlo, mentre l'italiano NM Zero da 7,13 € stava
// in piccolo sotto) e l'offerta italiana, se diversa, risalta. Dati iniziali
// dal seed Postgres con i valori di Snorlax (15 ott), tap/touch veri.
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

test("prezzo grande con lingua, offerta italiana in evidenza", async ({ page }) => {
  await page.goto(`${BASE_URL}/card/960001`);
  await expect(page.getByTestId("headline-language")).toContainText("EN", { timeout: 30_000 });
  const it = page.getByTestId("it-nm-zero-line");
  await expect(it).toContainText("7,13");
  await expect(it).toHaveClass(/text-ink-primary/);
});

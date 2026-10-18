// Grafico storico: la serie principale e' il prezzo in evidenza della scheda
// (best_price_cents, non il minimo grezzo), c'e' il periodo 7g, e un buco di
// dati (>10 gg) si vede come filo punteggiato invece di una linea inventata.
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

test("il grafico mostra il prezzo in evidenza, ha 7g e segna il buco di dati", async ({ page }) => {
  await page.goto(`${BASE_URL}/card/960002`);

  const group = page.getByRole("group", { name: "Periodo storico" });
  await expect(group).toBeVisible({ timeout: 30_000 });
  await expect(group.getByRole("button", { name: "7g" })).toBeVisible();

  const box = page.locator("div.rounded-card:has(svg[aria-label^='Andamento prezzo'])").first();
  // ultimo punto: best = 800 + 19*10 = 990 -> 9,90 EUR (il minimo grezzo sarebbe 5,19)
  await expect(box).toContainText("9,90");
  await expect(box).not.toContainText("5,19");
  await expect(page.getByTestId("chart-gap")).toHaveCount(1);

  // tocco sul bordo sinistro: punto vecchio, con il suo prezzo in evidenza
  const svg = page.locator("svg[aria-label^='Andamento prezzo']").first();
  await svg.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  const b = await svg.boundingBox();
  await page.touchscreen.tap(b.x + 2, b.y + b.height / 2);
  await expect(svg).toHaveAttribute("aria-label", /8,00/);
});

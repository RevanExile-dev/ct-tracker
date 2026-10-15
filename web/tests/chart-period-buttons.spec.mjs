// Grafico storico: i bottoni del periodo (30g / 90g / Tutto) erano alti 32 px
// su telefono (misurato in produzione); ora >= 44 px, e un tocco sul grafico
// mostra data, prezzo e inserzioni del punto. Storico simulato di 120 giorni.
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

test("periodo del grafico: bottoni da 44 px e valore al tocco", async ({ page }) => {
  const day = 86_400_000;
  const history = Array.from({ length: 120 }, (_, i) => ({
    captured_at: new Date(Date.UTC(2026, 9, 1) - (119 - i) * day).toISOString().slice(0, 10),
    min_price_cents: 500 + i,
    min_price_currency: "EUR",
    avg_price_cents: 700 + i,
    listings_count: 10 + (i % 7),
    best_price_cents: 600 + i,
    best_price_currency: "EUR",
    it_nm_zero_price_cents: null,
    it_nm_zero_price_currency: null,
  }));
  await page.route(/\/api\/cards\/903001\/history$/, (route) => route.fulfill({ json: history }));
  await page.goto(`${BASE_URL}/card/903001`);
  const group = page.getByRole("group", { name: "Periodo storico" });
  await expect(group).toBeVisible({ timeout: 30_000 });
  const buttons = group.getByRole("button");
  expect(await buttons.count()).toBeGreaterThanOrEqual(3); // 30g, 90g, Tutto
  for (const b of await buttons.all()) {
    expect((await b.boundingBox()).height).toBeGreaterThanOrEqual(43.5); // 44 px CSS, meno l'arrotondamento del bordo
  }

  await buttons.first().tap();
  const svg = page.locator("svg[aria-label^='Andamento prezzo']").first();
  // Il grafico si rimonta al cambio di periodo (disegno progressivo): aspetto
  // che sia fermo prima di toccarlo.
  await expect(svg).toBeVisible();
  await svg.scrollIntoViewIfNeeded(); // fuori schermo un tocco non arriva
  await page.waitForTimeout(1200);
  const box = await svg.boundingBox();
  await page.touchscreen.tap(box.x + box.width * 0.1, box.y + box.height / 2);
  await expect(svg).not.toHaveAttribute("aria-label", /01 ottobre 2026/); // non piu' l'ultimo punto
});

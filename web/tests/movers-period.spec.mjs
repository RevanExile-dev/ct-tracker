import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

// "Carte in movimento": un ribasso e' un confronto tra il prezzo di oggi e
// uno salvato prima. Visto in produzione (2026-10-14) che circa 2.000 dei
// ~3.500 "ribassi" erano confronti con prezzi di 2-4 settimane prima,
// presentati come se fossero recenti: il periodo predefinito e' 30 giorni e
// ogni carta dice di quanti giorni e' la variazione.

// Su telefono rialzi e cali stanno in due schede e quella non scelta resta nel
// DOM, nascosta: i controlli sul testo guardano solo cio' che l'utente vede.
const visible = (locator, page) => locator.and(page.locator(":visible"));

for (const variant of [
  { name: "desktop", contextOptions: { viewport: { width: 1366, height: 900 } }, tap: false },
  {
    name: "mobile",
    contextOptions: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
    tap: true,
  },
]) {
  test.describe(`/movers periodo di confronto - ${variant.name}`, () => {
    test.use(variant.contextOptions);

    async function press(page, locator) {
      if (variant.tap) await locator.tap();
      else await locator.click();
    }

    test("di default non mostra confronti piu' vecchi di 30 giorni e li etichetta", async ({ page }) => {
      await page.goto(`${BASE_URL}/movers?tab=drops`, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("button", { name: "30 giorni" })).toHaveAttribute("aria-pressed", "true");
      await expect(visible(page.getByText(/Mover Card/), page).first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("Vecchio Confronto")).toHaveCount(0);
      // L'etichetta dice quanto e' vecchio il confronto (seed: 5 giorni).
      await expect(visible(page.getByText("in 5 gg"), page).first()).toBeVisible();
    });

    test("scegliendo Tutto compaiono i confronti vecchi, con la loro eta'", async ({ page }) => {
      await page.goto(`${BASE_URL}/movers?tab=drops`, { waitUntil: "domcontentloaded" });
      await expect(visible(page.getByText(/Mover Card/), page).first()).toBeVisible({ timeout: 15_000 });
      await press(page, page.getByRole("button", { name: "Tutto" }));
      await expect(visible(page.getByText(/Vecchio Confronto 1/), page).first()).toBeVisible({ timeout: 15_000 });
      await expect(visible(page.getByText("in 45 gg"), page).first()).toBeVisible();
      await expect(page).toHaveURL(/period=all/);
    });

    test("3 giorni esclude i confronti di 5; 7 li include; il reset torna a 30", async ({ page }) => {
      await page.goto(`${BASE_URL}/movers?tab=drops&period=7`, { waitUntil: "domcontentloaded" });
      await expect(visible(page.getByText(/Mover Card/), page).first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("Vecchio Confronto")).toHaveCount(0);
      await press(page, page.getByRole("button", { name: "3 giorni" }));
      await expect(page.getByText(/Mover Card/)).toHaveCount(0);
      await expect(visible(page.getByText(/Nessun .* in questa combinazione di filtri/), page).first()).toBeVisible();
      await press(page, page.getByRole("button", { name: /Reset filtri/ }));
      await expect(page.getByRole("button", { name: "30 giorni" })).toHaveAttribute("aria-pressed", "true");
      await expect(visible(page.getByText(/Mover Card/), page).first()).toBeVisible({ timeout: 15_000 });
    });

    test("un periodo sconosciuto nell'URL torna al predefinito senza errori", async ({ page }) => {
      await page.goto(`${BASE_URL}/movers?period=boh`, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("button", { name: "30 giorni" })).toHaveAttribute("aria-pressed", "true");
    });
  });
}

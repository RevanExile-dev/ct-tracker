// Lista desideri: il totale "Totale oggi" somma i prezzi delle carte in lista
// e si aggiorna quando se ne toglie una. Eventi touch veri (CLAUDE.md).
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

test("desideri: totale oggi e lista vuota", async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("ct-tracker:wishlist")) {
      localStorage.setItem("ct-tracker:wishlist", JSON.stringify([903001, 903002]));
    }
  });
  await page.goto(`${BASE_URL}/wishlist`);
  const total = page.getByTestId("wishlist-total");
  await expect(total).toContainText("48,00", { timeout: 20_000 });
  await expect(page.locator("body")).toContainText("Carte in lista");
  // "In ribasso" c'e' sempre: o il numero di carte scese o "nessuna" (prima la
  // tessera spariva e il testo prometteva ribassi anche con 5 carte su 5 in rialzo).
  await expect(page.getByTestId("wishlist-drops")).toHaveText(/▼ \d+|nessuna/);
  await expect(page.locator("body")).not.toContainText("ordinate dal ribasso");

  // Tolta una carta (tap sul cuore) il totale scende a quello dell'altra.
  await page.getByRole("button", { name: /desideri/i }).first().tap();
  await expect(total).not.toContainText("48,00");
});

test("desideri vuota: nessun totale", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ct-tracker:wishlist", "[]"));
  await page.goto(`${BASE_URL}/wishlist`);
  await expect(page.locator("body")).toContainText("La lista desideri è vuota", { timeout: 20_000 });
  await expect(page.getByTestId("wishlist-total")).toHaveCount(0);
});

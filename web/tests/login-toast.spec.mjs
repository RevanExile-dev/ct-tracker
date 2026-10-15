// Avviso "Accedi per..." da non loggati (allarme, desideri, binder): prima era
// trasparente (testo sovrapposto a quello della pagina) e non aveva il tasto
// Accedi. Ora sfondo pieno, tasto Accedi >= 44 px che porta a /login, chiusura
// >= 44 px. Tocchi veri, telefono.
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

for (const nome of [/crea allarme/i, /aggiungi ai desideri/i, /aggiungi al binder/i]) {
  test(`avviso login leggibile con tasto Accedi: ${nome}`, async ({ page }) => {
    await page.addInitScript(() => { localStorage.setItem("ct-tracker:wishlist", "[]"); });
    await page.goto(`${BASE_URL}/card/903001`);
    await page.getByRole("button", { name: nome }).first().tap();
    const toast = page.getByTestId("login-toast");
    await expect(toast).toBeVisible({ timeout: 10_000 });

    const box = toast.locator("div").first();
    const alpha = await box.evaluate((e) => {
      const m = getComputedStyle(e).backgroundColor.match(/[\d.]+/g) ?? [];
      return m.length > 3 ? Number(m[3]) : 1;
    });
    expect(alpha).toBe(1); // sfondo pieno

    const accedi = toast.getByRole("link", { name: "Accedi" });
    expect((await accedi.boundingBox()).height).toBeGreaterThanOrEqual(43);
    const chiudi = toast.getByRole("button", { name: "Chiudi" });
    const cb = await chiudi.boundingBox();
    expect(cb.height).toBeGreaterThanOrEqual(43);
    expect(cb.width).toBeGreaterThanOrEqual(43);

    await chiudi.tap();
    await expect(toast).toHaveCount(0);
  });

  test(`il tasto Accedi porta al login: ${nome}`, async ({ page }) => {
    await page.addInitScript(() => { localStorage.setItem("ct-tracker:wishlist", "[]"); });
    await page.goto(`${BASE_URL}/card/903001`);
    await page.getByRole("button", { name: nome }).first().tap();
    await page.getByTestId("login-toast").getByRole("link", { name: "Accedi" }).tap();
    await expect(page).toHaveURL(/\/login/);
  });
}

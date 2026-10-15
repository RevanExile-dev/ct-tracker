// Scheda carta su telefono: azioni (binder/desideri/allarme) e prezzo stanno nel
// primo schermo (prima il prezzo era a ~970 px e le azioni a ~865 px, sotto
// l'immagine a tutta larghezza). Misurato su tre telefoni, con tap veri, anche
// per lo scheletro di caricamento e per una carta senza prezzo.
import { test, expect, devices } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

const phones = [
  { name: "iPhone SE", device: devices["iPhone SE"] },
  { name: "iPhone 13", device: devices["iPhone 13"] },
  { name: "Pixel 7", device: devices["Pixel 7"] },
];

const bottomOf = (page, re) =>
  page.evaluate((src) => {
    const re = new RegExp(src, "i");
    const el = [...document.querySelectorAll("button")].find((b) => re.test(b.innerText));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return Math.round(r.bottom + scrollY);
  }, re.source);

for (const { name, device } of phones) {
  test.describe(`scheda carta - ${name}`, () => {
    // Stessa emulazione dei telefoni veri, senza il campo defaultBrowserType
    // (non si puo' cambiare dentro un describe).
    test.use({ viewport: device.viewport, userAgent: device.userAgent, deviceScaleFactor: device.deviceScaleFactor, isMobile: true, hasTouch: true });

    test("azioni e prezzo nel primo schermo, nessun overflow", async ({ page }) => {
      await page.goto(`${BASE_URL}/card/903001`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
      const vh = await page.evaluate(() => innerHeight);
      for (const re of [/aggiungi al binder/, /aggiungi ai desideri/, /crea allarme/]) {
        const bottom = await bottomOf(page, re);
        expect(bottom, `${re} dentro il primo schermo`).not.toBeNull();
        expect(bottom).toBeLessThanOrEqual(vh);
      }
      const priceTop = await page.evaluate(() => {
        const el = [...document.querySelectorAll("main *")].find((e) => e.children.length === 0 && /\d+,\d{2}\s*€/.test(e.textContent));
        return el ? Math.round(el.getBoundingClientRect().top + scrollY) : null;
      });
      expect(priceTop).not.toBeNull();
      expect(priceTop).toBeLessThanOrEqual(vh); // il prezzo comincia nel primo schermo
      // La tessera "Inserzioni attive" non si allunga a tutta l'altezza della
      // tessera del prezzo (in produzione era ~190 px con ~55 px di contenuto).
      const tileH = await page.getByTestId("listings-tile").evaluate((e) => Math.round(e.getBoundingClientRect().height));
      expect(tileH).toBeLessThanOrEqual(110);
      const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      expect(ov.sw).toBeLessThanOrEqual(ov.cw);

      // Un tap vero su "aggiungi ai desideri" funziona dalla nuova posizione.
      const wish = page.getByRole("button", { name: /aggiungi ai desideri/i });
      await wish.tap();
      await expect(page.getByRole("button", { name: /nella lista desideri/i })).toBeVisible();
    });

    test("scheletro di caricamento: stessa disposizione compatta, nessun overflow", async ({ page }) => {
      await page.route(/\/api\/cards\/903001$/, async (route) => {
        await new Promise((r) => setTimeout(r, 4000));
        await route.continue();
      });
      await page.goto(`${BASE_URL}/card/903001`, { waitUntil: "domcontentloaded" });
      const img = page.locator("main .skeleton.aspect-\\[5\\/7\\]");
      await expect(img).toBeVisible({ timeout: 15_000 });
      const box = await img.boundingBox();
      const vw = page.viewportSize().width;
      expect(box.width).toBeLessThan(vw * 0.5); // non piu' a tutta larghezza
      const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      expect(ov.sw).toBeLessThanOrEqual(ov.cw);
    });

    test("carta senza prezzo: azioni comunque nel primo schermo", async ({ page }) => {
      await page.goto(`${BASE_URL}/card/900201`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
      const vh = await page.evaluate(() => innerHeight);
      expect(await bottomOf(page, /crea allarme/)).toBeLessThanOrEqual(vh);
      const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      expect(ov.sw).toBeLessThanOrEqual(ov.cw);
    });
  });
}

test.describe("scheda carta - PC", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test("due colonne come prima: immagine a sinistra, titolo a destra", async ({ page }) => {
    await page.goto(`${BASE_URL}/card/903001`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
    const h1 = await page.getByRole("heading", { level: 1 }).boundingBox();
    const imgBox = await page.locator("main [class*='aspect-[5/7]']").first().boundingBox();
    expect(imgBox.width).toBeGreaterThanOrEqual(300);
    expect(h1.x).toBeGreaterThan(imgBox.x + imgBox.width);
  });
});

// Bersagli di tocco: i link di testo della scheda carta e del piede di pagina
// erano alti 16-20 px (misurato in produzione). Su telefono ora >= 44 px,
// su PC >= 24 px (soglia WCAG 2.2, criterio 2.5.8).
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

const heights = (page, selector) =>
  page.$$eval(selector, (els) => els.map((e) => ({ t: (e.textContent || "").trim().slice(0, 30), h: Math.round(e.getBoundingClientRect().height) })));

test.describe("bersagli di tocco - telefono", () => {
  test.use({ viewport: { width: 390, height: 664 }, hasTouch: true, isMobile: true });
  test("link del piede e della scheda alti almeno 44 px", async ({ page }) => {
    await page.goto(`${BASE_URL}/card/903001`);
    await page.getByRole("link", { name: /Torna indietro/ }).waitFor();
    const all = [
      ...(await heights(page, 'footer nav a')),
      ...(await heights(page, 'a:has-text("Torna indietro")')),
      ...(await heights(page, 'a:has-text("Apri su CardTrader")')),
      // Azioni principali del percorso "tengo d'occhio questa carta": erano 27 px.
      // (Sotto i 620 px di altezza, es. iPhone SE, restano compatte: vedi card-first-screen.)
      ...(await heights(page, 'button:has-text("aggiungi al binder")')),
      ...(await heights(page, 'button:has-text("aggiungi ai desideri")')),
      ...(await heights(page, 'button:has-text("crea allarme")')),
    ];
    expect(all.length).toBeGreaterThanOrEqual(8);
    for (const x of all) expect(x.h, x.t).toBeGreaterThanOrEqual(43);
  });
});

test.describe("bersagli di tocco - PC", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test("link del piede e della scheda alti almeno 24 px", async ({ page }) => {
    await page.goto(`${BASE_URL}/card/903001`);
    await page.getByRole("link", { name: /Torna indietro/ }).waitFor();
    const all = [
      ...(await heights(page, 'footer nav a')),
      ...(await heights(page, 'a:has-text("Torna indietro")')),
      ...(await heights(page, 'a:has-text("Apri su CardTrader")')),
    ];
    for (const x of all) expect(x.h, x.t).toBeGreaterThanOrEqual(24);
  });
});

test.describe("bersagli di tocco - /movers", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test("link \"Torna al catalogo\" alto almeno 44 px", async ({ page }) => {
    await page.goto(`${BASE_URL}/movers`);
    const link = page.getByTestId("back-link");
    await link.waitFor();
    expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(43);
  });
});

test.describe("bersagli di tocco - altre pagine con \"Torna al catalogo\"", () => {
  test.use({ viewport: { width: 390, height: 664 }, hasTouch: true, isMobile: true });
  for (const path of ["/login", "/wishlist", "/privacy", "/termini"]) {
    test(`${path}: link alto almeno 44 px`, async ({ page }) => {
      await page.goto(`${BASE_URL}${path}`);
      const link = page.getByRole("link", { name: /Torna al catalogo/ }).first();
      await link.waitFor();
      expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(43);
    });
  }
});

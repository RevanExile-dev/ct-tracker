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
  test("\"Come si legge\" alto almeno 44 px e si apre con un tocco", async ({ page }) => {
    await page.goto(`${BASE_URL}/movers`);
    const sum = page.locator("summary", { hasText: "Come si legge" });
    await sum.waitFor();
    expect((await sum.boundingBox()).height).toBeGreaterThanOrEqual(43);
    await sum.tap();
    await expect(page.getByText(/almeno \d+ inserzioni/).first()).toBeVisible();
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
  test("/binder: link \"← Catalogo\" alto almeno 44 px", async ({ page }) => {
    await page.goto(`${BASE_URL}/binder`);
    const link = page.getByRole("link", { name: /← Catalogo/ }).first();
    await link.waitFor();
    expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(43);
  });
});

// I tasti tondi delle tessere (binder, desideri, allarme) sono 36 px e stanno
// uno sopra l'altro: l'area di tocco deve arrivare a 44 px senza cambiarne
// l'aspetto. Si misura con un punto vero (elementFromPoint), non con il rettangolo.
test.describe("bersagli di tocco - tessere del catalogo", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test("i tasti tondi delle tessere si colpiscono a 4 px dal bordo", async ({ page }) => {
    await page.goto(`${BASE_URL}/`);
    const btn = page.getByRole("button", { name: /Aggiungi al binder|Rimuovi dal binder/ }).first();
    await btn.waitFor();
    await btn.scrollIntoViewIfNeeded();
    const hits = await page.evaluate(() => {
      const out = [];
      const names = /Aggiungi al binder|Rimuovi dal binder|lista desideri|Crea allarme/;
      for (const el of document.querySelectorAll("button[aria-label]")) {
        if (!names.test(el.getAttribute("aria-label") || "")) continue;
        const r = el.getBoundingClientRect();
        // Solo i tasti interamente visibili (le file orizzontali ne hanno fuori schermo).
        if (r.width === 0 || r.top < 8 || r.bottom > innerHeight - 8 || r.left < 8 || r.right > innerWidth - 8) continue;
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const probe = (x, y) => document.elementFromPoint(x, y)?.closest("button") === el;
        out.push({
          label: el.getAttribute("aria-label"),
          w: Math.round(r.width),
          left: probe(r.left - 3.5, cy),
          right: probe(r.right + 3.5, cy),
          top: probe(cx, r.top - 3.5),
          bottom: probe(cx, r.bottom + 3.5),
        });
      }
      return out;
    });
    expect(hits.length).toBeGreaterThanOrEqual(2);
    for (const h of hits) {
      expect(h.w, h.label).toBeLessThanOrEqual(36);
      expect(h.left && h.top, h.label).toBeTruthy();
    }
  });
  test("/movers: Precedente e Successiva alti almeno 44 px", async ({ page }) => {
    await page.goto(`${BASE_URL}/movers`);
    const next = page.getByRole("button", { name: /Successiva/ }).first();
    await next.waitFor();
    expect((await next.boundingBox()).height).toBeGreaterThanOrEqual(43);
  });
});

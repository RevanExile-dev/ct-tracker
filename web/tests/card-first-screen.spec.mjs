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

    test("primo disegno dal server senza API duplicate: disposizione compatta, nessun overflow", async ({ page }) => {
      // Le API principali sono indisponibili: i dati devono arrivare dal
      // server, senza nascondere un refetch client dietro un ritardo fittizio.
      const requests = [];
      await page.route(/\/api\/cards\/903001(\/history|\/listings)?$/, (route) => {
        requests.push(new URL(route.request().url()).pathname);
        return route.fulfill({ status: 503, body: "{}" });
      });
      const hydrated = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/cards/903001/cardmarket");
      await page.goto(`${BASE_URL}/card/903001`, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 3_000 });
      const img = page.locator("main [class*='aspect-[5/7]']").first();
      await expect(img).toBeVisible();
      const box = await img.boundingBox();
      const vw = page.viewportSize().width;
      expect(box.width).toBeLessThan(vw * 0.5); // non piu' a tutta larghezza
      await hydrated;
      expect(requests).toEqual([]);
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

// Regressioni del caricamento server: incluse nella suite gia' eseguita in CI.
test.describe("scheda carta - dati iniziali server", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  function coreRequests(page, id) {
    const paths = [];
    page.on("request", (r) => {
      const path = new URL(r.url()).pathname;
      if (new RegExp(`^/api/cards/${id}(/history|/listings)?$`).test(path)) paths.push(path);
    });
    return paths;
  }
  async function openHydrated(page, path, id) {
    const ready = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/cards/${id}/cardmarket`);
    await page.goto(`${BASE_URL}${path}`);
    await ready;
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }

  test("riusa dettaglio, storico e inserzioni del server senza richieste duplicate", async ({ page }) => {
    const requests = coreRequests(page, 950001);
    await openHydrated(page, "/card/950001", 950001);
    await expect(page.locator("svg[aria-label^='Andamento prezzo']")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Migliori inserzioni" })).toBeVisible();
    await expect(page.getByTestId("buy-now-ranked").locator("li")).toHaveCount(3);
    expect(requests).toEqual([]);
  });

  test("array vuoti iniziali: nessun refetch o riquadro residuo", async ({ page }) => {
    const requests = coreRequests(page, 900104);
    await openHydrated(page, "/card/900104", 900104);
    await expect(page.getByText(/Ancora nessuno storico prezzi/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Migliori inserzioni" })).toHaveCount(0);
    await expect(page.getByTestId("cardmarket-reference")).toHaveCount(0);
    expect(requests).toEqual([]);
  });

  test("navigazione client azzera periodo, filtro e desideri della carta precedente", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("ct-tracker:wishlist", JSON.stringify([950001])));
    const next = "/card/960003?from=/card/900104";
    await openHydrated(page, `/card/950001?from=${encodeURIComponent(next)}`, 950001);
    await page.evaluate(() => { window.__cardNavigationToken = "same-document"; });
    await expect(page.getByRole("button", { name: /nella lista desideri/i })).toBeVisible();
    await page.getByRole("button", { name: /Solo CardTrader Zero/ }).tap();
    await page.getByRole("group", { name: "Periodo storico" }).getByRole("button", { name: "7g", exact: true }).tap();
    await page.getByRole("link", { name: /Torna indietro/ }).tap();
    await expect(page.getByRole("heading", { level: 1, name: "Scheda Storico Lungo" })).toBeVisible();
    expect(await page.evaluate(() => window.__cardNavigationToken)).toBe("same-document");
    await expect(page.getByRole("button", { name: /aggiungi ai desideri/i })).toBeVisible();
    await expect(page.getByRole("group", { name: "Periodo storico" }).getByRole("button", { name: "Tutto", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: /Solo CardTrader Zero/ })).not.toHaveClass(/bg-accent/);
    await expect(page.getByText(/^scheda-no-hub/).first()).toBeVisible();
    await expect(page.getByText(/^scheda-zero/).first()).toBeVisible();
    await page.getByRole("link", { name: /Torna indietro/ }).tap();
    await expect(page.getByRole("heading", { level: 1, name: "Smoke Card 4" })).toBeVisible();
    await expect(page.getByText(/Ancora nessuno storico prezzi/)).toBeVisible();
    await expect(page.locator("svg[aria-label^='Andamento prezzo']")).toHaveCount(0);
    await expect(page.getByTestId("buy-now-ranked")).toHaveCount(0);
  });

  test("server fallito: fallback client, caricamento e risposte tardive isolate per carta", async ({ page }) => {
    // Safe integer positivo fuori dal tipo INTEGER di Postgres: le query
    // server falliscono davvero, senza flag di produzione o mock RSC.
    const id = 2147483648;
    const detail = await (await page.request.get(`${BASE_URL}/api/cards/950001`)).json();
    const history = await (await page.request.get(`${BASE_URL}/api/cards/950001/history`)).json();
    const listings = await (await page.request.get(`${BASE_URL}/api/cards/950001/listings`)).json();
    const requests = coreRequests(page, id);
    let releaseCard, releaseData;
    const cardGate = new Promise((resolve) => { releaseCard = resolve; });
    const dataGate = new Promise((resolve) => { releaseData = resolve; });
    await page.route(new RegExp(`/api/cards/${id}(/history|/listings)?$`), async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/history")) { await dataGate; return route.fulfill({ json: history }); }
      if (path.endsWith("/listings")) { await dataGate; return route.fulfill({ json: listings }); }
      await cardGate;
      return route.fulfill({ json: { ...detail, id } });
    });
    await page.goto(`${BASE_URL}/card/${id}?from=/card/900104`);
    await expect.poll(() => requests.length).toBe(3);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(0);
    await expect(page.locator("main .skeleton").first()).toBeVisible();
    releaseCard();
    await expect(page.getByRole("heading", { level: 1, name: detail.name })).toBeVisible();
    await page.getByRole("link", { name: /Torna indietro/ }).tap();
    await expect(page.getByRole("heading", { level: 1, name: "Smoke Card 4" })).toBeVisible();
    const lateResponses = Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === `/api/cards/${id}/history`),
      page.waitForResponse((r) => new URL(r.url()).pathname === `/api/cards/${id}/listings`),
    ]);
    releaseData();
    await lateResponses;
    await expect(page.getByText(/Ancora nessuno storico prezzi/)).toBeVisible();
    await expect(page.locator("svg[aria-label^='Andamento prezzo']")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Migliori inserzioni" })).toHaveCount(0);
    await expect(page.getByText(/^zero-de/)).toHaveCount(0);
    expect(requests).toHaveLength(3);
  });
});

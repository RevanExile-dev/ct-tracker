import { test, expect } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

// Riquadro "Riferimento Cardmarket" sulla scheda carta. Mobile con tocchi
// veri (hasTouch + isMobile, .tap()), non un viewport stretto con click
// sintetici (CLAUDE.md, disciplina n.6). Stati controllati tutti: dati
// (sotto e sopra i 25 euro), dati vecchi, nessun dato, caricamento lento,
// errore del server. Le carte 900101-900104 e le righe external_prices sono
// in tests/fixtures/smoke-seed.sql.

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

const box = (page) => page.getByTestId("cardmarket-reference");

async function open(page, id) {
  await page.goto(`${BASE}/card/${id}`, { waitUntil: "domcontentloaded" });
  // la pagina e' pronta quando e' arrivato il dettaglio carta
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
}

test("dati recenti sotto i 25 euro: media, holo, fonte, data e spedizione stimata", async ({ page }) => {
  await open(page, 900101);
  await expect(box(page)).toBeVisible();
  await expect(box(page).getByRole("heading", { name: /Riferimento Cardmarket/ })).toBeVisible();
  await expect(box(page)).toContainText("non un'offerta");
  await expect(box(page)).toContainText("tutte le lingue e condizioni");
  await expect(box(page)).toContainText("4,02");
  await expect(box(page)).toContainText("Versione holo");
  await expect(box(page)).toContainText("9,90");
  await expect(page.getByTestId("cardmarket-source")).toContainText("Cardmarket via TCGdex");
  const ship = page.getByTestId("cardmarket-shipping");
  await expect(ship).toContainText("stima");
  await expect(ship).toContainText("1,60");
  await expect(ship).toContainText("per ordine, non per carta");
  // confronto con CardTrader Zero: una sola spedizione dall'hub, 8,50 euro fino a 44 carte
  const zero = page.getByTestId("zero-comparison");
  await expect(zero).toContainText("CardTrader Zero");
  await expect(zero).toContainText("8,50");
  await expect(zero).toContainText("stima");
  await expect(ship.getByRole("link", { name: "CardTrader Zero" })).toHaveAttribute("href", /cardtrader\.com.*shipping_country=IT/);
});

test("sopra i 25 euro: raccomandata obbligatoria e tetto estero", async ({ page }) => {
  await open(page, 900102);
  const ship = page.getByTestId("cardmarket-shipping");
  await expect(ship).toContainText("6,50");
  await expect(ship).toContainText("16 €");
  await expect(ship).toContainText("raccomandata è obbligatoria");
});

test("non si confonde con CardTrader: nessun pulsante, nessuna etichetta, prezzo in evidenza invariato", async ({ page }) => {
  await open(page, 900101);
  await expect(box(page)).toBeVisible();
  // niente azioni dentro il riquadro, tranne il link alla pagina delle tariffe
  await expect(box(page).getByRole("button")).toHaveCount(0);
  await expect(box(page)).not.toContainText(/miglior prezzo|acquista|compra\b|aggiungi al carrello/i);
  // il prezzo in evidenza resta quello CardTrader (101 + 1 = 1,01 nel seed)
  const main = await page.locator("main").innerText();
  const outside = main.replace(await box(page).innerText(), "");
  expect(outside).toContain("1,01");
  expect(outside).not.toContain("4,02");
  // il riquadro e' dopo lo storico prezzi e fuori da ogni lista di inserzioni
  const order = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="cardmarket-reference"]');
    const h = [...document.querySelectorAll("h2")].find((e) => /Andamento prezzo/.test(e.textContent));
    return h ? !!(h.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) : null;
  });
  expect(order).toBe(true);
});

test("niente scroll orizzontale e tocco sul link tariffe senza chiusure o salti", async ({ page }) => {
  await open(page, 900101);
  await box(page).scrollIntoViewIfNeeded();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  // un tocco dentro il riquadro (testo e titolo) non lo fa sparire
  await box(page).getByRole("heading", { name: /Riferimento Cardmarket/ }).tap();
  await box(page).getByText("Tendenza").first().tap();
  await expect(box(page)).toBeVisible();
  // il link alle tariffe apre la pagina ufficiale in una nuova scheda
  const link = page.getByTestId("cardmarket-shipping").getByRole("link", { name: "Cardmarket" });
  await expect(link).toHaveAttribute("href", /help\.cardmarket\.com/);
  await expect(link).toHaveAttribute("target", "_blank");
});

test("dato vecchio di 10 giorni: il riquadro non compare", async ({ page }) => {
  const resp = page.waitForResponse((r) => r.url().includes("/api/cards/900103/cardmarket"));
  await open(page, 900103);
  expect((await resp).status()).toBe(200);
  await expect(box(page)).toHaveCount(0);
});

test("carta senza dati: il riquadro non compare", async ({ page }) => {
  const resp = page.waitForResponse((r) => r.url().includes("/api/cards/900104/cardmarket"));
  await open(page, 900104);
  expect(await (await resp).json()).toBeNull();
  await expect(box(page)).toHaveCount(0);
});

test("errore del server: il riquadro non compare e il resto della scheda funziona", async ({ page }) => {
  await page.route("**/api/cards/900101/cardmarket", (route) => route.fulfill({ status: 500, body: "boom" }));
  await open(page, 900101);
  await expect(page.getByRole("heading", { name: "Andamento prezzo" })).toBeVisible();
  await expect(box(page)).toHaveCount(0);
});

test("caricamento lento: nulla finche' non arriva, poi compare", async ({ page }) => {
  let release;
  const gate = new Promise((r) => { release = r; });
  await page.route("**/api/cards/900101/cardmarket", async (route) => { await gate; await route.continue(); });
  await open(page, 900101);
  await expect(page.getByRole("heading", { name: "Andamento prezzo" })).toBeVisible();
  await expect(box(page)).toHaveCount(0);
  release();
  await expect(box(page)).toBeVisible();
});

test("l'API risponde cacheabile dalla CDN e rifiuta id non validi", async ({ request }) => {
  const ok = await request.get(`${BASE}/api/cards/900101/cardmarket`);
  expect(ok.status()).toBe(200);
  expect(ok.headers()["cache-control"]).toMatch(/s-maxage=600/);
  const body = await ok.json();
  expect(body.base.trend_cents).toBe(402);
  expect(body.holo.trend_cents).toBe(990);
  const bad = await request.get(`${BASE}/api/cards/0/cardmarket`);
  expect(bad.status()).toBe(400);
});

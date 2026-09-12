import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';

// Carta Uno: lingua IT nota, il mock trova un'inserzione IT a 700 (invece
// del "best" 1000) -> il totale deve usare 700, non 1000.
// Carta Due: lingua JP nota, il mock NON trova nulla in JP -> resta sul
// "best" (500) ma con un segnale esplicito di fallback (mai silenzioso).
// Carta Tre: nessuna lingua nota -> comportamento invariato, "best" (2000),
// nessun badge.
const CARDS = [
  { id: 1, name: 'Carta Uno', best_price_cents: 1000, language: 'it' },
  { id: 2, name: 'Carta Due', best_price_cents: 500, language: 'jp' },
  { id: 3, name: 'Carta Tre', best_price_cents: 2000, language: null },
];

async function arrange(page) {
  const cards = CARDS.map((c) => ({
    id: c.id, name: c.name, image_url: '/icon.svg', expansion_name: 'Set di test',
    expansion_code: 'test', version: null, rarity: 'Rare', best_price_cents: c.best_price_cents,
    latest_price_cents: c.best_price_cents, best_price_currency: 'EUR', latest_price_currency: 'EUR',
  }));
  await page.addInitScript((entries) => {
    localStorage.setItem('ct-tracker:binder:v2', JSON.stringify(entries));
  }, CARDS.map((c) => ({ blueprintId: c.id, language: c.language, quantity: 1, finish: 'normal', addedAt: '2026-08-01' })));
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path === '/api/cards/language-prices' && req.method() === 'POST') {
      // Solo Carta Uno (id 1, lingua it) ha una corrispondenza nel mock -
      // Carta Due (jp) viene interrogata ma non trova nulla, esattamente
      // come una vera assenza di inserzioni in quella lingua sul mercato.
      // Chiave "blueprintId:lingua" (non solo blueprintId): stesso formato
      // usato dal vero endpoint dopo il fix del bug sui lotti multi-lingua
      // (due lotti della stessa carta in lingue diverse si sovrascrivevano
      // a vicenda con una chiave solo numerica - vedi web/lib/db.server.ts).
      await route.fulfill({ status: 200, json: { '1:it': { price_cents: 700, price_currency: 'EUR', listings_count: 3 } } });
      return;
    }
    let body = [];
    if (path === '/api/auth/session') body = { user: { name: 'Test', email: 'binder@example.test' }, expires: '2099-01-01T00:00:00Z' };
    else if (path === '/api/cards') body = cards;
    else if (path === '/api/cards/trend' || path === '/api/meta') body = {};
    else if (path === '/api/account/binder/value-history') body = [];
    await route.fulfill({ status: 200, json: body });
  });
}

test('the total uses the price in the owned language when the market has one', async ({ page }) => {
  await arrange(page);
  await page.goto(`${BASE}/binder`);
  // 700 (Carta Uno, IT match) + 500 (Carta Due, JP no match -> best) + 2000 (Carta Tre, no language) = 3200,00
  // Se il fix non funzionasse (sempre "best"): 1000+500+2000 = 3500,00.
  await expect(page.locator('text=Valore stimato').locator('..')).toContainText(/32,00|3\.200,00|3200,00/);
  await expect(page.getByText('1/2 nella lingua posseduta', { exact: false })).toBeVisible();
});

test('a card tile shows the owned-language price with a flag badge when matched', async ({ page }) => {
  await arrange(page);
  await page.goto(`${BASE}/binder`);
  const tileOne = page.locator('div.group', { hasText: 'Carta Uno' });
  await expect(tileOne).toContainText(/7,00/);
  await expect(tileOne.getByText('tua lingua', { exact: false })).toBeVisible();
});

test('a card tile explicitly signals when the owned language has no market match, never a silent fallback', async ({ page }) => {
  await arrange(page);
  await page.goto(`${BASE}/binder`);
  const tileTwo = page.locator('div.group', { hasText: 'Carta Due' });
  // Il prezzo resta il "best" (5,00), ma con la nota esplicita di fallback.
  await expect(tileTwo).toContainText(/5,00/);
  await expect(tileTwo.getByText('Nessuna inserzione in', { exact: false })).toBeVisible();
});

test('a card with no known language is unaffected, exactly as before this feature', async ({ page }) => {
  await arrange(page);
  await page.goto(`${BASE}/binder`);
  const tileThree = page.locator('div.group', { hasText: 'Carta Tre' });
  await expect(tileThree).toContainText(/20,00/);
  await expect(tileThree.getByText('tua lingua', { exact: false })).toHaveCount(0);
  await expect(tileThree.getByText('Nessuna inserzione in', { exact: false })).toHaveCount(0);
});

test('the table view mirrors the same resolved price and flag', async ({ page }) => {
  await arrange(page);
  await page.goto(`${BASE}/binder?layout=table`);
  const rowOne = page.locator('tr', { hasText: 'Carta Uno' });
  await expect(rowOne).toContainText(/7,00/);
  const rowTwo = page.locator('tr', { hasText: 'Carta Due' });
  await expect(rowTwo).toContainText(/5,00/);
  await expect(rowTwo).toContainText(/nessuna inserzione in.*JP/i);
});

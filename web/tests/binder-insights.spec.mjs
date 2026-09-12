import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';
const points = [
  { captured_at: '2026-08-01', total_cents: 10000, currency: 'EUR', cards_count: 20, priced_count: 20 },
  { captured_at: '2026-09-01', total_cents: 12000, currency: 'EUR', cards_count: 20, priced_count: 20 },
  { captured_at: '2026-09-10', total_cents: 14000, currency: 'EUR', cards_count: 21, priced_count: 20 },
  { captured_at: '2026-09-11', total_cents: 15000, currency: 'EUR', cards_count: 21, priced_count: 21 },
];

async function arrange(page, { history = points, historyStatus = 200, empty = false } = {}) {
  const cards = empty ? [] : Array.from({ length: 20 }, (_, i) => ({
    id: i + 1, name: `Carta ${i + 1}`, image_url: '/icon.svg', expansion_name: 'Set di test',
    expansion_code: 'test', version: null, rarity: 'Rare', best_price_cents: 100,
    latest_price_cents: 100, best_price_currency: 'EUR', latest_price_currency: 'EUR',
  }));
  await page.addInitScript((ids) => {
    localStorage.setItem('ct-tracker:binder:v2', JSON.stringify(ids.map((id) => ({
      blueprintId: id, language: 'it', quantity: 1, finish: 'normal', addedAt: '2026-08-01',
    }))));
  }, cards.map((card) => card.id));
  // Isolate UI behavior. No request reaches a real account or production DB.
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body = [];
    let status = 200;
    if (path === '/api/auth/session') body = { user: { name: 'Test', email: 'binder@example.test' }, expires: '2099-01-01T00:00:00Z' };
    else if (path === '/api/account/binder/value-history') { body = history; status = historyStatus; }
    else if (path === '/api/cards') body = cards;
    else if (path === '/api/cards/trend' || path === '/api/meta') body = {};
    else if (path.startsWith('/api/account/filter-presets/')) body = null;
    await route.fulfill({ status, json: body });
  });
}

test('date ranges, keyboard comparison, zoom and CSV use actual selected observations', async ({ page }) => {
  await arrange(page);
  await page.goto(`${BASE}/binder`);
  const chart = page.getByRole('region', { name: 'Storico del valore del binder' });
  const slider = page.getByRole('slider', { name: 'Esplora lo storico' });
  await expect(slider).toHaveAttribute('aria-valuemax', '3');
  await slider.press('Home');
  await page.getByRole('button', { name: 'Confronta da questo punto' }).click();
  await slider.press('End');
  await expect(chart).toContainText('+50,00');
  await page.getByRole('button', { name: '1g', exact: true }).click();
  await expect(slider).toHaveAttribute('aria-valuemax', '1');
  await page.getByLabel('Inizio periodo', { exact: true }).fill('2026-09-02');
  await page.getByLabel('Fine periodo', { exact: true }).fill('2026-09-09');
  await expect(chart).toContainText('Nessuna rilevazione in questo periodo');
  await page.getByRole('button', { name: 'Tutto', exact: true }).click();
  await page.getByRole('slider', { name: 'Inizio zoom', exact: true }).press('Home');
  await page.getByRole('slider', { name: 'Inizio zoom', exact: true }).press('ArrowRight');
  await page.getByRole('slider', { name: 'Inizio zoom', exact: true }).press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuemax', '1');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Esporta CSV' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('binder-2026-09-10-2026-09-11.csv');
  const stream = await download.createReadStream();
  let csv = '';
  for await (const chunk of stream) csv += chunk.toString();
  expect(csv).toContain('"14000"');
  expect(csv).not.toContain('2026-08-01');
});

test('a failed history request is an error with retry, never an empty-history success', async ({ page }) => {
  await arrange(page, { historyStatus: 503 });
  await page.goto(`${BASE}/binder`);
  await expect(page.getByRole('alert').filter({ hasText: 'Non riesco a caricare lo storico' })).toBeVisible();
  await page.route('**/api/account/binder/value-history', (route) => route.fulfill({ json: points }));
  // .evaluate(el => el.click()) invece di .click(): il bottone viene
  // smontato (sostituito dallo scheletro, poi dal grafico) da un
  // re-render che puo' scattare prima ancora che Playwright completi le
  // sue verifiche di azionabilita'/allegamento al DOM (anche con
  // force:true, che le salta ma non l'attesa che l'elemento sia ancora
  // presente al momento del dispatch) - risultato intermittente "element
  // was detached from the DOM". Un click DOM diretto e sincrono e' immune
  // a questa corsa: attiva comunque il gestore React (l'evento nativo
  // risale fino al listener delegato sulla radice), solo senza il
  // controllo a piu' fasi di Playwright nel mezzo.
  await page.getByRole('button', { name: 'Riprova storico' }).evaluate((el) => el.click());
  await expect(page.getByRole('slider', { name: 'Esplora lo storico' })).toBeVisible();
});

test('a single history point remains useful and accessible', async ({ page }) => {
  await arrange(page, { history: points.slice(0, 1) });
  await page.goto(`${BASE}/binder`);
  await expect(page.getByText('Un solo punto:', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '1g', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Tutto', exact: true })).toBeEnabled();
});

test('mixed currencies never produce an apparently comparable return', async ({ page }) => {
  await arrange(page, { history: [points[0], { ...points[1], currency: 'USD' }] });
  await page.goto(`${BASE}/binder`);
  await expect(page.getByText('Il periodo contiene valute diverse:', { exact: false })).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Esplora lo storico' })).toHaveCount(0);
});

test('button page turn bends between endpoints; chart keys cannot turn the book', async ({ page }) => {
  await arrange(page);
  await page.goto(`${BASE}/binder?view=book`);
  await page.getByRole('slider', { name: 'Esplora lo storico' }).press('ArrowLeft');
  await expect(page.locator('.binder-controls [aria-live]')).toHaveText('1–2/4');
  await page.getByRole('button', { name: 'Pagina succ.', exact: false }).click();
  await expect.poll(() => page.locator('.binder-flip-far').evaluateAll((nodes) => nodes.some((node) => {
    const degrees = parseFloat(node.style.transform.replace('rotateY(', ''));
    return Math.abs(degrees) > 2;
  })), { intervals: [16, 16, 32] }).toBe(true);
  await expect(page.locator('.binder-controls [aria-live]')).toHaveText('3–4/4');
  await expect(page.locator('.binder-flip')).toHaveCount(0);
});

test.describe('touch on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('tap presets and the plot without closing controls or overflowing', async ({ page }) => {
    await arrange(page);
    await page.goto(`${BASE}/binder`);
    await page.getByRole('button', { name: '1g', exact: true }).tap();
    await page.getByRole('slider', { name: 'Esplora lo storico' }).tap();
    await expect(page.getByLabel('Inizio periodo', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '1g', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

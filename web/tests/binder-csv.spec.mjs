import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

const CARDS = [
  { id: 1, name: 'Carta Uno', best_price_cents: 1000, quantity: 1 },
  { id: 2, name: 'Carta Due', best_price_cents: 500, quantity: 3 },
];
const mkCard = (c) => ({
  id: c.id, name: c.name, image_url: '/icon.svg', expansion_name: 'Set di test', expansion_code: 'test', version: null,
  rarity: 'Rare', best_price_cents: c.best_price_cents, latest_price_cents: c.best_price_cents,
  best_price_currency: 'EUR', latest_price_currency: 'EUR',
});

async function arrange(page, stored = CARDS) {
  await page.addInitScript((entries) => {
    if (!localStorage.getItem('ct-tracker:binder:v2')) localStorage.setItem('ct-tracker:binder:v2', JSON.stringify(entries));
  }, stored.map((c) => ({ blueprintId: c.id, language: 'it', quantity: c.quantity, finish: 'normal', addedAt: '2026-08-01' })));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    let body = [];
    if (url.pathname === '/api/auth/session') body = {};
    else if (url.pathname === '/api/cards') {
      // Solo id 1, 2 e 3 esistono nel "catalogo" del test; 99 no.
      const ids = url.searchParams.getAll('ids').map(Number);
      body = [...CARDS, { id: 3, name: 'Carta Tre', best_price_cents: 200, quantity: 1 }].filter((c) => ids.includes(c.id)).map(mkCard);
    } else if (url.pathname === '/api/cards/trend' || url.pathname === '/api/meta') body = {};
    await route.fulfill({ status: 200, json: body });
  });
}

test('export downloads a CSV whose total matches the page', async ({ page }) => {
  await arrange(page);
  await page.goto(`${BASE}/binder`);
  await expect(page.getByText('Valore stimato')).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Esporta binder' }).tap()]);
  const text = readFileSync(await download.path(), 'utf8');
  expect(download.suggestedFilename()).toMatch(/^cartaviva-binder-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(text).toContain('1;Carta Uno;;Set di test;it;;normal;1;10,00;EUR;10,00');
  expect(text).toContain('2;Carta Due;;Set di test;it;;normal;3;5,00;EUR;15,00');
});

test('import previews new/updated/unknown, applies on confirm and never removes cards', async ({ page }) => {
  await arrange(page);
  await page.goto(`${BASE}/binder`);
  await expect(page.getByText('Valore stimato')).toBeVisible();
  const csv = 'id;quantita;lingua;finitura\n2;5;en;foil\n3;2;it;normal\n99;1;it;normal\n';
  await page.locator('input[type=file]').setInputFiles({ name: 'mio.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Trovate 2 carte');
  await expect(dialog).toContainText('1 nuove');
  await expect(dialog).toContainText('1 già nel binder');
  await expect(dialog).toContainText('1 non sono nel catalogo');
  await dialog.getByRole('button', { name: 'Importa', exact: true }).tap();
  // 10,00 (Uno x1) + 5,00 x5 (Due) + 2,00 x2 (Tre) = 39,00
  await expect(page.locator('text=Valore stimato').locator('..')).toContainText(/39,00/);
  await expect(page.getByText('Carta Uno').first()).toBeVisible();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('ct-tracker:binder:v2')));
  expect(stored.map((e) => [e.blueprintId, e.quantity, e.language]).sort()).toEqual([[1, 1, 'it'], [2, 5, 'en'], [3, 2, 'it']]);
});

test('a file without the id column explains what is wrong and changes nothing', async ({ page }) => {
  await arrange(page);
  await page.goto(`${BASE}/binder`);
  await page.locator('input[type=file]').setInputFiles({ name: 'x.csv', mimeType: 'text/csv', buffer: Buffer.from('carta;set\nA;B\n') });
  await expect(page.getByRole('status').filter({ hasText: 'colonna' })).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});

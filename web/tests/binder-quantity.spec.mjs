import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';

// 3 carte con prezzi distinti per verificare la somma pesata per quantita':
// 10.00x1 + 5.00x3 + 20.00x1 = 45.00 (non 35.00, che sarebbe la somma
// ignorando le quantita' - il bug corretto in questo giro).
const CARDS = [
  { id: 1, name: 'Carta Uno', best_price_cents: 1000, quantity: 1 },
  { id: 2, name: 'Carta Due', best_price_cents: 500, quantity: 3 },
  { id: 3, name: 'Carta Tre', best_price_cents: 2000, quantity: 1 },
];

async function arrange(page) {
  const cards = CARDS.map((c) => ({
    id: c.id, name: c.name, image_url: '/icon.svg', expansion_name: 'Set di test',
    expansion_code: 'test', version: null, rarity: 'Rare', best_price_cents: c.best_price_cents,
    latest_price_cents: c.best_price_cents, best_price_currency: 'EUR', latest_price_currency: 'EUR',
  }));
  await page.addInitScript((entries) => {
    localStorage.setItem('ct-tracker:binder:v2', JSON.stringify(entries));
  }, CARDS.map((c) => ({ blueprintId: c.id, language: 'it', quantity: c.quantity, finish: 'normal', addedAt: '2026-08-01' })));
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body = [];
    if (path === '/api/auth/session') body = { user: { name: 'Test', email: 'binder@example.test' }, expires: '2099-01-01T00:00:00Z' };
    else if (path === '/api/cards') body = cards;
    else if (path === '/api/cards/trend' || path === '/api/meta') body = {};
    else if (path === '/api/account/binder/value-history') body = [];
    await route.fulfill({ status: 200, json: body });
  });
}

test('the estimated value weighs each card by owned quantity, not one copy per type', async ({ page }) => {
  await arrange(page);
  await page.goto(`${BASE}/binder`);
  await expect(page.getByText('Valore stimato')).toBeVisible();
  // 1000*1 + 500*3 + 2000*1 = 4500 cents = 45,00 EUR - would read 35,00 if
  // quantities were ignored (the bug this fix corrects).
  await expect(page.locator('text=Valore stimato').locator('..')).toContainText(/45,00/);
  // 3 tipi di carta, ma 1+3+1 = 5 copie fisiche possedute.
  await expect(page.getByText('5 copie', { exact: false })).toBeVisible();
});

test('the quantity stepper on a card tile updates its badge and the total', async ({ page }) => {
  await arrange(page);
  await page.goto(`${BASE}/binder`);
  const tileTwo = page.locator('div.group', { hasText: 'Carta Due' });
  await expect(tileTwo.getByText('×3')).toBeVisible();

  await tileTwo.getByRole('button', { name: 'Aumenta quantità' }).click();
  await expect(tileTwo.getByText('×4')).toBeVisible();
  // 1000*1 + 500*4 + 2000*1 = 5000 cents = 50,00 EUR
  await expect(page.locator('text=Valore stimato').locator('..')).toContainText(/50,00/);

  await tileTwo.getByRole('button', { name: 'Diminuisci quantità' }).click();
  await tileTwo.getByRole('button', { name: 'Diminuisci quantità' }).click();
  await tileTwo.getByRole('button', { name: 'Diminuisci quantità' }).click();
  await expect(tileTwo.getByText('×1')).toBeVisible();
  await expect(tileTwo.getByRole('button', { name: 'Diminuisci quantità' })).toBeDisabled();
  // Non puo' scendere sotto 1 tramite lo stepper (per rimuovere la carta si
  // usa la stella, non azzerare la quantita').
  await tileTwo.getByRole('button', { name: 'Diminuisci quantità' }).click({ force: true }).catch(() => {});
  await expect(tileTwo.getByText('×1')).toBeVisible();
});

test('the table view shows an extended total per row and stays in sync with the summary', async ({ page }) => {
  await arrange(page);
  await page.goto(`${BASE}/binder?layout=table`);
  const row = page.locator('tr', { hasText: 'Carta Due' });
  await expect(row).toContainText('3');

  await row.getByRole('button', { name: /Aumenta quantità/ }).click();
  await expect(row).toContainText('4');
  // Prezzo unitario 5,00 x 4 = 20,00 mostrato come riga secondaria nella cella prezzo.
  await expect(row).toContainText(/20,00/);
  await expect(page.locator('text=Valore stimato').locator('..')).toContainText(/50,00/);
});

test.describe('touch on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('tapping the stepper on a real touch context updates the quantity', async ({ page }) => {
    await arrange(page);
    await page.goto(`${BASE}/binder`);
    const tileTwo = page.locator('div.group', { hasText: 'Carta Due' });
    await expect(tileTwo.getByText('×3')).toBeVisible();
    await tileTwo.getByRole('button', { name: 'Aumenta quantità' }).tap();
    await expect(tileTwo.getByText('×4')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

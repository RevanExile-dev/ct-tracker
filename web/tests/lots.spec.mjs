import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';

const PIKACHU = {
  id: 200, name: 'Pikachu VMAX', image_url: '/icon.svg', expansion_name: 'Set di test',
  expansion_code: 'test', version: null, rarity: 'Rare',
  best_price_cents: 5000, latest_price_cents: 5000, best_price_currency: 'EUR', latest_price_currency: 'EUR',
};

async function mockCommon(page, { loggedIn = true } = {}) {
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    if (path === '/api/auth/session') {
      // Il vero endpoint di Auth.js risponde con "null" (non "{}") quando
      // non c'e' nessuna sessione attiva - verificato con una richiesta
      // reale senza cookie contro il server locale. "{}" e' comunque un
      // oggetto troncamento (! {} === false), quindi verrebbe trattato
      // erroneamente come loggato sia da UserMenu che da questa pagina.
      const body = loggedIn ? { user: { name: 'Test', email: 'lots@example.test' }, expires: '2099-01-01T00:00:00Z' } : null;
      await route.fulfill({ status: 200, json: body });
      return;
    }
    if (path === '/api/cards' && req.method() === 'GET') {
      if (url.searchParams.get('idsProvided') === '1') {
        const ids = url.searchParams.getAll('ids').map(Number);
        await route.fulfill({ status: 200, json: ids.includes(PIKACHU.id) ? [PIKACHU] : [] });
        return;
      }
      if (url.searchParams.get('search')) {
        await route.fulfill({ status: 200, json: [PIKACHU] });
        return;
      }
      await route.fulfill({ status: 200, json: [] });
      return;
    }
    if (path === '/api/cards/language-prices') {
      await route.fulfill({ status: 200, json: {} });
      return;
    }
    await route.continue();
  });
}

test('without login, shows the login prompt instead of the form', async ({ page }) => {
  await mockCommon(page, { loggedIn: false });
  await page.goto(`${BASE}/lots`);
  // Sia l'header (SiteHeader/UserMenu) sia il messaggio della pagina hanno
  // un link "Accedi" - qui basta che almeno uno sia visibile, il punto del
  // test e' che il form NON appaia da sloggati.
  await expect(page.getByRole('link', { name: 'Accedi' }).first()).toBeVisible();
  await expect(page.getByText('I lotti sono legati al tuo account')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aggiungi lotto' })).toHaveCount(0);
});

test('logged in with no lots yet, shows the empty state and the form', async ({ page }) => {
  await mockCommon(page);
  await page.route('**/api/account/lots', async (route) => {
    if (route.request().method() === 'GET') { await route.fulfill({ status: 200, json: [] }); return; }
    await route.continue();
  });
  await page.goto(`${BASE}/lots`);
  await expect(page.getByText('Non hai ancora registrato nessun lotto.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aggiungi lotto' })).toBeVisible();
});

test('adding a lot: search, select a card, submit, appears in the table', async ({ page }) => {
  await mockCommon(page);
  let created = null;
  await page.route('**/api/account/lots', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') {
      await route.fulfill({ status: 200, json: created ? [created] : [] });
      return;
    }
    if (req.method() === 'POST') {
      const payload = req.postDataJSON();
      created = {
        id: 'new-lot-1', blueprintId: payload.blueprintId, quantity: payload.quantity,
        language: payload.language ?? null, condition: null, finish: null,
        provenance: payload.provenance ?? 'non_specificata', acquiredAt: payload.acquiredAt ?? '2026-09-12',
        costTotalCents: payload.costTotalCents ?? null, costCurrency: payload.costCurrency ?? null,
        note: payload.note ?? null, createdAt: '2026-09-12T00:00:00.000Z',
      };
      await route.fulfill({ status: 201, json: created });
      return;
    }
    await route.continue();
  });
  await page.goto(`${BASE}/lots`);
  await page.getByPlaceholder('Cerca una carta per nome…').fill('Pikachu');
  await expect(page.getByRole('button', { name: /Pikachu VMAX/ })).toBeVisible();
  await page.getByRole('button', { name: /Pikachu VMAX/ }).click();
  await page.getByLabel('Quantità').fill('2');
  await page.getByLabel('Costo totale del lotto').fill('25.00');
  await page.getByRole('button', { name: 'Aggiungi lotto' }).click();
  const row = page.locator('tr', { hasText: 'Pikachu VMAX' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('2');
  await expect(row).toContainText(/25,00/);
  // Valore attuale (2 copie * 50,00 best_price_cents) = 100,00; costo 25,00
  // -> plusvalenza NON REALIZZATA positiva di 75,00, mai chiamata "profitto".
  await expect(row).toContainText(/100,00/);
  await expect(row).toContainText(/75,00/);
  await expect(page.getByText('Plusvalenza non realizzata')).toBeVisible();
  await expect(page.getByText(/profitto/i)).toHaveCount(0);
});

test('a lot with unknown cost never contributes a fake gain, and is excluded honestly from the total', async ({ page }) => {
  await mockCommon(page);
  await page.route('**/api/account/lots', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        json: [{
          id: 'lot-unknown-cost', blueprintId: PIKACHU.id, quantity: 1, language: null,
          condition: null, finish: null, provenance: 'pacchetto', acquiredAt: '2026-01-01',
          costTotalCents: null, costCurrency: null, note: null, createdAt: '2026-01-01T00:00:00.000Z',
        }],
      });
      return;
    }
    await route.continue();
  });
  await page.goto(`${BASE}/lots`);
  const row = page.locator('tr', { hasText: 'Pikachu VMAX' });
  await expect(row).toContainText('sconosciuto');
  await expect(page.getByText('calcolata su 0/1 lotti', { exact: false })).toBeVisible();
});

test('deleting a lot removes it from the table', async ({ page }) => {
  await mockCommon(page);
  let deleted = false;
  await page.route('**/api/account/lots', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        json: deleted ? [] : [{
          id: 'lot-to-delete', blueprintId: PIKACHU.id, quantity: 1, language: null,
          condition: null, finish: null, provenance: 'acquisto', acquiredAt: '2026-01-01',
          costTotalCents: 1000, costCurrency: 'EUR', note: null, createdAt: '2026-01-01T00:00:00.000Z',
        }],
      });
      return;
    }
    await route.continue();
  });
  await page.route('**/api/account/lots/lot-to-delete', async (route) => {
    if (route.request().method() === 'DELETE') { deleted = true; await route.fulfill({ status: 200, json: { ok: true } }); return; }
    await route.continue();
  });
  await page.goto(`${BASE}/lots`);
  await expect(page.locator('tr', { hasText: 'Pikachu VMAX' })).toBeVisible();
  await page.getByRole('button', { name: 'Elimina' }).click();
  await expect(page.locator('tr', { hasText: 'Pikachu VMAX' })).toHaveCount(0);
  await expect(page.getByText('Non hai ancora registrato nessun lotto.')).toBeVisible();
});

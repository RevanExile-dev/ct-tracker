import { expect } from '@playwright/test';

export const concurrencyBase = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';
const cards = ['Pikachu', 'Eevee', 'Mew'].map((name, index) => ({
  id: index + 200, name, image_url: '/icon.svg', expansion_name: 'Test', expansion_code: 'test',
  rarity: 'Rare', best_price_cents: 5000, latest_price_cents: 5000,
  best_price_currency: 'EUR', latest_price_currency: 'EUR',
}));
export const concurrentLot = (id, overrides = {}) => ({
  id: `lot-${id}`, blueprintId: 199 + id, quantity: 1, language: null, condition: null, finish: null,
  provenance: 'acquisto', acquiredAt: '2026-10-01', costTotalCents: 1000, costCurrency: 'EUR',
  note: null, createdAt: '2026-10-01T00:00:00.000Z', ...overrides,
});
export const concurrentAlert = (id, overrides = {}) => ({
  id, blueprintId: 199 + id, languages: ['it'], condition: 'Near Mint', canSellViaHub: 1,
  targetType: 'absolute_cents', targetValue: 1250, baselinePriceCents: 5000, baselineCurrency: 'EUR',
  baselineCapturedAt: '2026-10-01T00:00:00.000Z', fireMode: 'once', rearmCooldownHours: null,
  state: 'armed', firedAt: null, createdAt: '2026-10-01T00:00:00.000Z', ...overrides,
});

// Deferred actual HTTP responses make completion order explicit, without
// sleeps or assertions against implementation details such as React state.
export async function mockConcurrentApi(page, { lots = [], alerts = [] } = {}) {
  const pending = new Map();
  const calls = [];
  let deferReload = false;
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    calls.push({ path, method });
    if (/^\/api\/account\/(lots|alerts)\/[^/]+$/.test(path) && ['DELETE', 'PATCH'].includes(method)) {
      pending.set(`${method} ${path}`, route);
      return;
    }
    let body = [];
    let status = 200;
    if (path === '/api/auth/session') body = { user: { name: 'Test', email: 'concurrency@example.test' }, expires: '2099-01-01T00:00:00Z' };
    else if (path === '/api/cards') {
      const ids = url.searchParams.getAll('ids').map(Number);
      body = url.searchParams.has('search') ? [cards[2]] : cards.filter((card) => ids.includes(card.id));
    } else if (path === '/api/account/lots' && method === 'GET') {
      if (deferReload) { pending.set('reload lots', route); return; }
      body = lots;
    } else if (path === '/api/account/alerts' && method === 'GET') body = alerts;
    else if (path === '/api/account/lots' && method === 'POST') { body = concurrentLot(3, req.postDataJSON()); status = 201; }
    else if (path === '/api/account/alerts' && method === 'POST') { body = concurrentAlert(3, req.postDataJSON()); status = 201; }
    else if (path === '/api/account/lots/import') body = { outcomes: [], warnings: [] };
    else if (path === '/api/cards/language-prices') body = {};
    else if (path === '/api/account/telegram') body = { linked: true };
    else if (path === '/api/languages') body = ['it', 'en'];
    else if (path === '/api/conditions') body = ['Near Mint'];
    await route.fulfill({ status, json: body });
  });
  return {
    calls,
    deferReload: () => { deferReload = true; },
    async wait(key) { await expect.poll(() => pending.has(key)).toBe(true); },
    async release(key, status, json = {}) {
      await this.wait(key);
      const route = pending.get(key);
      pending.delete(key);
      await route.fulfill({ status, json });
    },
  };
}

export const concurrentLotRows = (page) => page.locator('tbody tr');
export const concurrentLotRow = (page, name) => concurrentLotRows(page).filter({ hasText: name });
export const concurrentAlertRows = (page) => page.locator('li').filter({ has: page.getByRole('button', { name: /Modifica allarme/ }) });
export const concurrentAlertRow = (page, name) => page.locator('li').filter({ has: page.getByRole('button', { name: `Modifica allarme ${name}`, exact: true }) });

export async function triggerImportReload(page) {
  await page.getByRole('button', { name: 'Importa da Markdown' }).tap();
  await page.locator('textarea').fill('| Carta | Set | Prezzo pagato |\n|---|---|---|\n| Mew | Test | 1 |');
  await page.getByRole('button', { name: 'Importa', exact: true }).tap();
}

export async function createConcurrentThird(page, kind) {
  await page.getByPlaceholder('Cerca una carta per nome…').fill('Mew');
  await page.getByRole('button', { name: 'Mew — Test', exact: true }).tap();
  if (kind === 'alerts') await page.getByLabel('Avvisami sotto (€)').fill('10');
  await page.getByRole('button', { name: kind === 'lots' ? 'Aggiungi lotto' : 'Crea allarme', exact: true }).tap();
}

import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';

const PIKACHU = {
  id: 200, name: 'Pikachu VMAX', image_url: '/icon.svg', expansion_name: 'Set di test',
  expansion_code: 'test', version: null, rarity: 'Rare',
  best_price_cents: 5000, latest_price_cents: 5000, best_price_currency: 'EUR', latest_price_currency: 'EUR',
};

function makeAlert(overrides = {}) {
  return {
    id: 7, blueprintId: 200, languages: ['it'], condition: 'Near Mint', canSellViaHub: 1,
    targetType: 'absolute_cents', targetValue: 1250, baselinePriceCents: 5000, baselineCurrency: 'EUR',
    baselineCapturedAt: '2026-10-01T00:00:00.000Z', fireMode: 'once', rearmCooldownHours: null,
    state: 'fired', firedAt: '2026-10-05T00:00:00.000Z', createdAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

// Mock con stato: il PATCH aggiorna l'allarme come farebbe il server
// (fired -> armed), cosi' si vede anche la lista cambiare dopo il salvataggio.
async function mockApi(page, alert) {
  const patches = [];
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    if (path === '/api/auth/session') {
      await route.fulfill({ status: 200, json: { user: { name: 'Test', email: 'alerts@example.test' }, expires: '2099-01-01T00:00:00Z' } });
      return;
    }
    if (path === '/api/cards' && req.method() === 'GET') {
      await route.fulfill({ status: 200, json: url.searchParams.get('idsProvided') === '1' ? [PIKACHU] : [] });
      return;
    }
    if (path === '/api/languages') { await route.fulfill({ status: 200, json: ['it', 'en'] }); return; }
    if (path === '/api/conditions') { await route.fulfill({ status: 200, json: ['Near Mint', 'Played'] }); return; }
    if (path === '/api/account/alerts' && req.method() === 'GET') {
      await route.fulfill({ status: 200, json: [alert.current] });
      return;
    }
    if (path === `/api/account/alerts/${alert.current.id}` && req.method() === 'PATCH') {
      const body = req.postDataJSON();
      patches.push(body);
      alert.current = {
        ...alert.current,
        languages: body.languages, condition: body.condition, canSellViaHub: body.canSellViaHub,
        targetType: body.targetType, targetValue: body.targetValue, fireMode: body.fireMode,
        rearmCooldownHours: body.rearmCooldownHours ?? null,
        state: alert.current.state === 'fired' ? 'armed' : alert.current.state,
      };
      await route.fulfill({ status: 200, json: alert.current });
      return;
    }
    await route.continue();
  });
  return patches;
}

test.describe('modifica allarme prezzo (touch)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('tap su Modifica: campi precompilati, cambio soglia, salva, la lista si aggiorna', async ({ page }) => {
    const alert = { current: makeAlert() };
    const patches = await mockApi(page, alert);
    await page.goto(`${BASE}/account/alerts`);

    await expect(page.getByText('Scattati (1)')).toBeVisible();
    await page.getByRole('button', { name: /Modifica allarme Pikachu VMAX/ }).tap();

    const dialog = page.getByRole('dialog', { name: 'Modifica allarme di prezzo' });
    await expect(dialog).toBeVisible();
    // Precompilato con i valori dell'allarme (anche prima che le opzioni arrivino).
    await expect(dialog.getByRole('checkbox', { name: 'it' })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: 'en' })).not.toBeChecked();
    await expect(dialog.getByLabel('Condizione')).toHaveValue('Near Mint');
    await expect(dialog.getByLabel('CardTrader Zero')).toHaveValue('only');
    const soglia = dialog.getByPlaceholder('es. 10,00');
    await expect(soglia).toHaveValue('12,50');

    // Un tap DENTRO il pannello non deve chiuderlo (bug classico touch/portale).
    await soglia.tap();
    await expect(dialog).toBeVisible();

    await soglia.fill('9,90');
    await dialog.getByRole('button', { name: 'Salva' }).tap();

    await expect(dialog).toHaveCount(0);
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({ languages: ['it'], condition: 'Near Mint', canSellViaHub: 1, targetType: 'absolute_cents', targetValue: 990, fireMode: 'once' });
    // Un allarme scattato torna attivo dopo la modifica: esce dalla sezione "Scattati".
    await expect(page.getByText('Scattati (1)')).toHaveCount(0);
    await expect(page.getByText(/sotto 9,90/)).toBeVisible();
  });

  test('allarme ripetibile: la modifica conserva modalita e ore di attesa', async ({ page }) => {
    const alert = { current: makeAlert({ fireMode: 'rearm', rearmCooldownHours: 12, state: 'armed', firedAt: null }) };
    const patches = await mockApi(page, alert);
    await page.goto(`${BASE}/account/alerts`);
    await page.getByRole('button', { name: /Modifica allarme Pikachu VMAX/ }).tap();
    const dialog = page.getByRole('dialog', { name: 'Modifica allarme di prezzo' });
    await expect(dialog.getByLabel('Attesa minima tra due avvisi (ore)')).toHaveValue('12');
    await dialog.getByRole('button', { name: 'Calo %' }).tap();
    await dialog.getByPlaceholder('es. 20').fill('15');
    await dialog.getByRole('button', { name: 'Salva' }).tap();
    await expect(dialog).toHaveCount(0);
    expect(patches[0]).toMatchObject({ targetType: 'percent_drop', targetValue: 15, fireMode: 'rearm', rearmCooldownHours: 12 });
  });

  test('errore del server: il messaggio resta nella finestra e Annulla non salva nulla', async ({ page }) => {
    const alert = { current: makeAlert() };
    const patches = await mockApi(page, alert);
    await page.route('**/api/account/alerts/7', async (route) => {
      if (route.request().method() === 'PATCH') {
        await route.fulfill({ status: 400, json: { error: 'Nessuna inserzione trovata per questo identico profilo' } });
        return;
      }
      await route.fallback();
    });
    await page.goto(`${BASE}/account/alerts`);
    await page.getByRole('button', { name: /Modifica allarme Pikachu VMAX/ }).tap();
    const dialog = page.getByRole('dialog', { name: 'Modifica allarme di prezzo' });
    await dialog.getByRole('button', { name: 'Salva' }).tap();
    await expect(dialog.getByRole('alert')).toContainText('Nessuna inserzione trovata');
    await dialog.getByRole('button', { name: 'Annulla' }).tap();
    await expect(dialog).toHaveCount(0);
    expect(patches).toHaveLength(0);
  });
});

test.describe('allarme con piu lingue', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('spuntando anche en l allarme accetta una o l altra e la lista lo dice', async ({ page }) => {
    const alert = { current: makeAlert({ state: 'armed', firedAt: null }) };
    const patches = await mockApi(page, alert);
    await page.goto(`${BASE}/account/alerts`);
    await page.getByRole('button', { name: /Modifica allarme Pikachu VMAX/ }).tap();
    const dialog = page.getByRole('dialog', { name: 'Modifica allarme di prezzo' });
    await dialog.getByRole('checkbox', { name: 'en' }).check();
    await expect(dialog.getByText(/una qualsiasi di queste/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Salva' }).tap();
    await expect(dialog).toHaveCount(0);
    expect(patches[0].languages.sort()).toEqual(['en', 'it']);
    await expect(page.getByText(/lingua it o en|lingua en o it/)).toBeVisible();
  });

  test('togliendo tutte le lingue diventa qualunque lingua', async ({ page }) => {
    const alert = { current: makeAlert({ state: 'armed', firedAt: null }) };
    const patches = await mockApi(page, alert);
    await page.goto(`${BASE}/account/alerts`);
    await page.getByRole('button', { name: /Modifica allarme Pikachu VMAX/ }).tap();
    const dialog = page.getByRole('dialog', { name: 'Modifica allarme di prezzo' });
    await dialog.getByRole('checkbox', { name: 'it' }).uncheck();
    await expect(dialog.getByText('Nessuna spuntata: qualunque lingua.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Salva' }).tap();
    await expect(dialog).toHaveCount(0);
    expect(patches[0].languages).toEqual([]);
    await expect(page.getByText(/^qualunque lingua, condizione/)).toBeVisible();
  });
});

test.describe('modifica allarme prezzo (tastiera)', () => {
  test('Modifica raggiungibile da tastiera, Esc chiude e il fuoco torna al pulsante', async ({ page }) => {
    const alert = { current: makeAlert() };
    await mockApi(page, alert);
    await page.goto(`${BASE}/account/alerts`);
    const edit = page.getByRole('button', { name: /Modifica allarme Pikachu VMAX/ });
    await edit.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Modifica allarme di prezzo' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(edit).toBeFocused();
  });
});

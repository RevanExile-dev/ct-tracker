// Allarmi da loggato, telefono con tocchi veri: (1) creare "scende sotto X"
// dalla scheda in 2 tocchi (apri + Traccia, con la soglia scritta) e senza
// promettere messaggi Telegram se non e' collegato; (2) capire in una riga,
// senza aprire nulla, perche' un allarme non e' scattato / e' scattato.
import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const SESSION = { user: { name: 'Test', email: 'alert-flow@example.test' }, expires: '2099-01-01T00:00:00Z' };

function baseAlert(over = {}) {
  return {
    id: 1, blueprintId: 903001, languages: ['it'], condition: 'Near Mint', canSellViaHub: 1,
    targetType: 'absolute_cents', targetValue: 1000, baselinePriceCents: 1500, baselineCurrency: 'EUR',
    baselineCapturedAt: '2026-10-01T00:00:00.000Z', fireMode: 'once', rearmCooldownHours: null,
    state: 'armed', firedAt: null, createdAt: '2026-10-01T00:00:00.000Z',
    matchingPriceCents: 1250, matchingPriceCurrency: 'EUR', ...over,
  };
}

async function mock(page, { linked, alerts = [] }) {
  const posts = [];
  await page.route('**/api/auth/session', (r) => r.fulfill({ status: 200, json: SESSION }));
  await page.route('**/api/account/telegram', (r) => r.fulfill({ status: 200, json: { linked, linkedAt: linked ? '2026-10-01T00:00:00Z' : null } }));
  await page.route('**/api/account/alerts', async (r) => {
    if (r.request().method() === 'POST') {
      posts.push(r.request().postDataJSON());
      await r.fulfill({ status: 201, json: baseAlert({ id: 9, matchingPriceCents: undefined }) });
    } else {
      await r.fulfill({ status: 200, json: alerts });
    }
  });
  return posts;
}

test('creare un allarme dalla scheda: 2 tocchi, con Telegram collegato', async ({ page }) => {
  const posts = await mock(page, { linked: true });
  await page.goto(`${BASE}/card/903001`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });
  let taps = 0;
  await page.getByRole('button', { name: /crea allarme/i }).tap(); taps++;
  const dialog = page.getByRole('dialog', { name: 'Crea allarme di prezzo' });
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder('es. 10,00').fill('3,50');
  await dialog.getByRole('button', { name: 'Traccia' }).tap(); taps++;
  await expect(dialog.getByText('Allarme creato')).toBeVisible();
  await expect(dialog.getByText(/Ti avviseremo su Telegram/)).toBeVisible();
  expect(taps).toBeLessThanOrEqual(3);
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ blueprintId: 903001, targetType: 'absolute_cents', targetValue: 350 });
});

test('senza Telegram collegato: niente promessa di messaggi, link per collegarlo', async ({ page }) => {
  await mock(page, { linked: false });
  await page.goto(`${BASE}/card/903001`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /crea allarme/i }).tap();
  const dialog = page.getByRole('dialog', { name: 'Crea allarme di prezzo' });
  await expect(dialog.getByText(/Ti segnaliamo in Allarmi prezzo/)).toBeVisible();
  await dialog.getByPlaceholder('es. 10,00').fill('3,50');
  await dialog.getByRole('button', { name: 'Traccia' }).tap();
  await expect(dialog.getByText(/Ti avviseremo su Telegram/)).toHaveCount(0);
  await expect(dialog.getByRole('link', { name: 'collega Telegram' })).toBeVisible();
});

test('lista allarmi: ogni riga dice prezzo di ora, soglia e cosa succede dopo', async ({ page }) => {
  await mock(page, {
    linked: false,
    alerts: [
      baseAlert({ id: 1 }),
      baseAlert({ id: 2, matchingPriceCents: null, blueprintId: 903002 }),
      baseAlert({ id: 3, state: 'fired', firedAt: '2026-10-05T00:00:00.000Z', matchingPriceCents: 900 }),
    ],
  });
  await page.goto(`${BASE}/account/alerts`);
  const rows = page.getByTestId('alert-status');
  await expect(rows).toHaveCount(3, { timeout: 30_000 });
  await expect(rows.filter({ hasText: 'mancano' })).toHaveCount(1);
  await expect(page.getByTestId('telegram-missing').getByRole('link', { name: 'Collega Telegram' })).toBeVisible();
  const texts = await rows.allInnerTexts();
  expect(texts.join('\n')).toMatch(/Nessuna offerta con questo profilo/);
  expect(texts.join('\n')).toMatch(/finché non lo riattivi/);
  // Nessun testo fuori schermo su telefono.
  await page.screenshot({ path: process.env.ALERT_SHOT ?? 'test-results/alert-list.png', fullPage: true });
  const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(ov.sw).toBeLessThanOrEqual(ov.cw);
  const link = await page.getByTestId('telegram-missing').getByRole('link').boundingBox();
  expect(link.height).toBeGreaterThanOrEqual(43);
});

test('allarme ripetibile dalla scheda: 3 tocchi (apri, Ripetibile, Traccia)', async ({ page }) => {
  const posts = await mock(page, { linked: true });
  await page.goto(`${BASE}/card/903001`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });
  let taps = 0;
  await page.getByRole('button', { name: /crea allarme/i }).tap(); taps++;
  const dialog = page.getByRole('dialog', { name: 'Crea allarme di prezzo' });
  await dialog.getByPlaceholder('es. 10,00').fill('3,50');
  // Default invariato: una volta sola.
  await expect(dialog.getByLabel('Quando scatta')).toHaveValue('once');
  await dialog.getByLabel('Quando scatta').selectOption('rearm'); taps++;
  await expect(dialog.getByLabel('Attesa minima tra due avvisi (ore)')).toHaveValue('24');
  await dialog.getByRole('button', { name: 'Traccia' }).tap(); taps++;
  await expect(dialog.getByText('Allarme creato')).toBeVisible();
  expect(taps).toBe(3);
  expect(posts[0]).toMatchObject({ fireMode: 'rearm', rearmCooldownHours: 24 });
});

test('creazione senza toccare "Quando scatta": resta una volta sola', async ({ page }) => {
  const posts = await mock(page, { linked: true });
  await page.goto(`${BASE}/card/903001`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /crea allarme/i }).tap();
  const dialog = page.getByRole('dialog', { name: 'Crea allarme di prezzo' });
  await dialog.getByPlaceholder('es. 10,00').fill('3,50');
  await dialog.getByRole('button', { name: 'Traccia' }).tap();
  await expect(dialog.getByText('Allarme creato')).toBeVisible();
  expect(posts[0].fireMode).toBe('once');
});

// Link di sola lettura al binder / lista desideri, telefono con tocchi veri
// (CLAUDE.md): (1) la pagina pubblica /s/<token> mostra solo carte, mai email
// o nome dell'account, con anteprima social corretta e noindex; (2) chi e'
// loggato (sessione vera nel database di prova, vedi smoke-seed.sql) crea il
// link dal Binder, un'altra persona senza login lo apre, e dopo la revoca (o
// dopo averne creato uno nuovo) il vecchio indirizzo e la sua anteprima
// rispondono 404; (3) un indirizzo inventato e' respinto e le aperture
// ripetute sono limitate.
import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';
const SEEDED_TOKEN = 'SmokeBinderShareTokenAAAAAAAAA12';
const SECRETS = ['mario.segretissimo', 'Segretissimo', '00000000-0000-4000-8000-0000000000a1'];

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

// Uguale al binder seminato nel database (smoke-seed.sql): al login l'app
// unisce il locale con l'account, quindi qui non devono esserci valori
// diversi, altrimenti il test cambierebbe i dati degli altri test.
const LOCAL_BINDER = [
  { blueprintId: 900101, language: null, quantity: 2, finish: 'foil', addedAt: '2026-10-01' },
  { blueprintId: 900105, language: null, quantity: 1, finish: 'normal', addedAt: '2026-10-01' },
  { blueprintId: 900110, language: null, quantity: 3, finish: 'unknown', addedAt: '2026-10-01' },
];

async function login(context) {
  await context.addCookies([{ name: 'authjs.session-token', value: 'share-smoke-session', url: BASE }]);
}

async function openBinderLoggedIn(page, context) {
  await login(context);
  await page.addInitScript((entries) => {
    if (!localStorage.getItem('ct-tracker:binder:v2')) localStorage.setItem('ct-tracker:binder:v2', JSON.stringify(entries));
  }, LOCAL_BINDER);
  await page.goto(`${BASE}/binder`);
}

test('pagina pubblica: carte, totale, anteprima social, nessun dato personale', async ({ page, request }) => {
  const res = await page.goto(`${BASE}/s/${SEEDED_TOKEN}`);
  expect(res.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Il binder di prova');
  await expect(page.getByText('Valore stimato')).toBeVisible();
  // 101*2 + 105 + 110*3 centesimi, quantita' comprese.
  await expect(page.locator('main')).toContainText('6,37');
  await expect(page.locator('main')).toContainText('(6 copie)');
  await expect(page.locator('li:has(a[href="/card/900101"])')).toContainText('×2');

  const html = await page.content();
  for (const secret of SECRETS) expect(html).not.toContain(secret);
  await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', /noindex/);
  await expect(page.locator('meta[name=referrer]')).toHaveAttribute('content', 'no-referrer');
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Il binder di prova');
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute('content', /3 carte, 6 copie, valore stimato 6,37/);
  const ogImage = await page.locator('meta[property="og:image"]').getAttribute('content');
  expect(new URL(ogImage).pathname).toBe(`/s/${SEEDED_TOKEN}/og`);

  const og = await request.get(`${BASE}/s/${SEEDED_TOKEN}/og`);
  expect(og.status()).toBe(200);
  expect(og.headers()['content-type']).toContain('image/png');
  const bytes = await og.body();
  expect(bytes.length).toBeGreaterThan(5_000);
  expect(bytes.toString('latin1')).not.toContain('Segretissimo');
});

test('pagina pubblica: nessun overflow orizzontale su telefono', async ({ page }) => {
  await page.goto(`${BASE}/s/${SEEDED_TOKEN}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('indirizzi inventati o malformati: 404 senza anteprima', async ({ page, request }) => {
  for (const bad of ['abc', 'A'.repeat(32), `${SEEDED_TOKEN.slice(0, 31)}Z`]) {
    const res = await page.goto(`${BASE}/s/${bad}`);
    expect(res.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Questo link non è più valido');
    await expect(page.locator('meta[name=robots]').first()).toHaveAttribute('content', /noindex/);
    expect((await request.get(`${BASE}/s/${bad}/og`)).status()).toBe(404);
  }
});

test('API link: senza login 401', async ({ request }) => {
  expect((await request.get(`${BASE}/api/account/share`)).status()).toBe(401);
  expect((await request.post(`${BASE}/api/account/share`, { data: { kind: 'binder' } })).status()).toBe(401);
  expect((await request.delete(`${BASE}/api/account/share?kind=binder`)).status()).toBe(401);
});

test('Binder: crea il link, un altro lo apre senza login, rigenera e disattiva', async ({ page, context, browser }) => {
  // Parte pulita: il link del seed sul binder serve agli altri test, quindi si
  // lavora sulla lista desideri (un altro tipo, stesso codice).
  await login(context);
  await page.addInitScript(() => localStorage.setItem('ct-tracker:wishlist', JSON.stringify([900120, 900121])));
  await page.goto(`${BASE}/wishlist`);
  await expect(page.getByTestId('wishlist-total')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: /Condividi con un link/ }).tap();
  await page.getByLabel('Titolo (facoltativo)').fill('Cosa regalarmi');
  await page.getByRole('button', { name: 'Crea link' }).tap();
  const field = page.getByRole('textbox', { name: 'Link da condividere' });
  await expect(field).toHaveValue(/\/s\/[A-Za-z0-9_-]{32}$/);
  const url1 = await field.inputValue();
  await expect(page.getByRole('status').filter({ hasText: 'Link pronto' })).toBeVisible();

  // Altra persona, nessun cookie.
  const guest = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const gp = await guest.newPage();
  const res = await gp.goto(url1);
  expect(res.status()).toBe(200);
  await expect(gp.getByRole('heading', { level: 1 })).toHaveText('Cosa regalarmi');
  await expect(gp.getByText('Totale oggi')).toBeVisible();
  await expect(gp.locator('li')).toHaveCount(2);
  const html = await gp.content();
  for (const secret of SECRETS) expect(html).not.toContain(secret);

  // Nuovo link: il vecchio muore subito, il titolo resta.
  await page.getByRole('button', { name: 'Crea un nuovo link' }).tap();
  await page.getByRole('button', { name: 'Sì, nuovo link' }).tap();
  await expect(field).not.toHaveValue(url1);
  const url2 = await field.inputValue();
  expect((await gp.goto(url1)).status()).toBe(404);
  expect((await gp.request.get(`${url1}/og`)).status()).toBe(404);
  expect((await gp.goto(url2)).status()).toBe(200);
  await expect(gp.getByRole('heading', { level: 1 })).toHaveText('Cosa regalarmi');

  // Disattiva: annullare non fa nulla, confermare spegne tutto.
  await page.getByRole('button', { name: 'Disattiva il link' }).tap();
  await page.getByRole('button', { name: 'Annulla' }).tap();
  expect((await gp.goto(url2)).status()).toBe(200);
  await page.getByRole('button', { name: 'Disattiva il link' }).tap();
  await page.getByRole('button', { name: 'Sì, disattiva' }).tap();
  await expect(page.getByRole('button', { name: 'Crea link' })).toBeVisible();
  expect((await gp.goto(url2)).status()).toBe(404);
  expect((await gp.request.get(`${url2}/og`)).status()).toBe(404);
  await guest.close();
});

test('Binder: il pannello si apre con un tap e non fa uscire dalla pagina', async ({ page, context }) => {
  await openBinderLoggedIn(page, context);
  const toggle = page.getByRole('button', { name: /Link di condivisione|Condividi con un link/ });
  await expect(toggle).toBeVisible({ timeout: 30_000 });
  expect((await toggle.boundingBox()).height).toBeGreaterThanOrEqual(43);
  await toggle.tap();
  await expect(page.getByRole('textbox', { name: 'Link da condividere' })).toHaveValue(new RegExp(`/s/${SEEDED_TOKEN}$`));
  // Un tap dentro il pannello (campo del link) non lo richiude.
  await page.getByRole('textbox', { name: 'Link da condividere' }).tap();
  await expect(page.getByRole('button', { name: 'Copia link' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('Binder da sloggato: invito ad accedere, nessuna chiamata ai link', async ({ page }) => {
  let shareCalls = 0;
  await page.route('**/api/account/share', (r) => { shareCalls++; return r.continue(); });
  await page.addInitScript((entries) => localStorage.setItem('ct-tracker:binder:v2', JSON.stringify(entries)), LOCAL_BINDER);
  await page.goto(`${BASE}/binder`);
  await expect(page.getByText('per creare un link da condividere')).toBeVisible({ timeout: 30_000 });
  expect(shareCalls).toBe(0);
});

// Ultimo: consuma il limite per IP, poi aspetta che la finestra finisca
// cosi' i test dei file successivi non vedono 429.
test('aperture ripetute di /s/: dopo il limite risponde 429', async ({ request }) => {
  const statuses = [];
  for (let i = 0; i < 12; i++) {
    const batch = await Promise.all(Array.from({ length: 8 }, () => request.get(`${BASE}/s/${'B'.repeat(32)}`)));
    statuses.push(...batch.map((r) => r.status()));
  }
  expect(statuses[0]).toBe(404);
  expect(statuses).toContain(429);
  await new Promise((resolve) => setTimeout(resolve, 10_500));
});

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import fs from 'node:fs';

// Controllo automatico di accessibilita' (axe-core, regole WCAG 2.x A/AA):
// nessuna violazione "serious"/"critical" sulle pagine principali, in chiaro e
// in scuro, a larghezza PC e telefono. Misurato il 2026-10-15: l'unica
// violazione era label-content-name-mismatch (WCAG 2.5.3) sull'header mobile.
const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';
const require = createRequire(import.meta.url);
const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const PAGES = ['/', '/movers', '/card/900202', '/wishlist', '/binder?view=collection', '/binder-book', '/lots', '/scan', '/login'];
// Carte del seed (smoke-seed.sql) in desideri e binder: senza, queste pagine
// mostrerebbero solo lo stato vuoto e axe non vedrebbe campanelle, tessere e libro.
const SEED_IDS = [900202, 903001, 903002];
const VIEWPORTS = [
  { name: 'pc', width: 1280, height: 900 },
  { name: 'telefono', width: 390, height: 800 },
];

async function gravi(page) {
  await page.evaluate(axeSource);
  const res = await page.evaluate(() =>
    // eslint-disable-next-line no-undef
    axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }),
  );
  return res.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' ; ')}`);
}

for (const colorScheme of ['light', 'dark']) {
  for (const vp of VIEWPORTS) {
    test.describe(`axe ${colorScheme} ${vp.name}`, () => {
      test.use({ colorScheme, viewport: { width: vp.width, height: vp.height } });
      for (const path of PAGES) {
        test(`${path}: nessuna violazione serious/critical`, async ({ page }) => {
          await page.addInitScript((ids) => {
            localStorage.setItem('ct-tracker:wishlist', JSON.stringify(ids));
            localStorage.setItem('ct-tracker:binder:v2', JSON.stringify(ids.map((id) => ({
              blueprintId: id, language: 'it', quantity: 1, finish: 'normal', addedAt: '2026-08-01',
            }))));
          }, SEED_IDS);
          await page.route('**/api/auth/session', (route) =>
            route.fulfill({ status: 200, json: { user: { name: 'Test', email: 'axe@example.test' }, expires: '2099-01-01T00:00:00Z' } }),
          );
          await page.route('**/api/account/**', (route) => route.fulfill({ status: 200, json: [] }));
          await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
          await page.waitForTimeout(800); // animazioni di ingresso (libro, tessere) assestate
          expect(await gravi(page)).toEqual([]);
        });
      }
    });
  }
}

// Home con i pannelli aperti: suggerimenti della ricerca, Prezzo e Rarita'
// (sempre in vista dopo #184). Stati che al caricamento non esistono.
for (const colorScheme of ['light', 'dark']) {
  for (const vp of VIEWPORTS) {
    test.describe(`axe home aperta ${colorScheme} ${vp.name}`, () => {
      test.use({ colorScheme, viewport: { width: vp.width, height: vp.height } });
      test('suggerimenti ricerca', async ({ page }) => {
        await page.goto(BASE, { waitUntil: 'networkidle' });
        const input = page.getByLabel('Cerca una carta per nome o numero');
        await input.click();
        await page.keyboard.type('smoke');
        await expect(page.getByRole('listbox')).toBeVisible({ timeout: 20_000 });
        await page.waitForTimeout(600);
        expect(await gravi(page)).toEqual([]);
      });
      for (const nome of [/^Prezzo/, /Rarità/i]) {
        test(`pannello ${nome}`, async ({ page }) => {
          await page.goto(BASE, { waitUntil: 'networkidle' });
          await page.waitForTimeout(500);
          await page.getByRole('button', { name: nome }).first().click();
          await expect(page.locator('button[aria-pressed]:visible').first()).toBeVisible();
          // Le opzioni hanno transition sul colore: misurate a meta' animazione
          // axe vede colori intermedi (falso contrasto basso).
          await page.waitForTimeout(600);
          expect(await gravi(page)).toEqual([]);
        });
      }
    });
  }
}

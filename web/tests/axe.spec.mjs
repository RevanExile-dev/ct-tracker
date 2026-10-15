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

const PAGES = ['/', '/movers', '/card/900202', '/wishlist', '/binder', '/binder-book', '/lots', '/scan', '/login'];
const VIEWPORTS = [
  { name: 'pc', width: 1280, height: 900 },
  { name: 'telefono', width: 390, height: 800 },
];

for (const colorScheme of ['light', 'dark']) {
  for (const vp of VIEWPORTS) {
    test.describe(`axe ${colorScheme} ${vp.name}`, () => {
      test.use({ colorScheme, viewport: { width: vp.width, height: vp.height } });
      for (const path of PAGES) {
        test(`${path}: nessuna violazione serious/critical`, async ({ page }) => {
          await page.route('**/api/auth/session', (route) =>
            route.fulfill({ status: 200, json: { user: { name: 'Test', email: 'axe@example.test' }, expires: '2099-01-01T00:00:00Z' } }),
          );
          await page.route('**/api/account/**', (route) => route.fulfill({ status: 200, json: [] }));
          await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
          await page.evaluate(axeSource);
          const res = await page.evaluate(() =>
            // eslint-disable-next-line no-undef
            axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }),
          );
          const gravi = res.violations
            .filter((v) => v.impact === 'serious' || v.impact === 'critical')
            .map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' ; ')}`);
          expect(gravi).toEqual([]);
        });
      }
    });
  }
}

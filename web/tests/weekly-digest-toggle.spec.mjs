// Riepilogo settimanale Telegram: spento di default, si accende e si spegne con
// un tocco (telefono, tocchi veri) dalla pagina notifiche, e lo stato arriva
// all'API. Senza Telegram collegato l'interruttore non c'e'.
import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const SESSION = { user: { name: 'Test', email: 'digest@example.test' }, expires: '2099-01-01T00:00:00Z' };

async function mock(page, status) {
  const patches = [];
  await page.route('**/api/auth/session', (r) => r.fulfill({ status: 200, json: SESSION }));
  await page.route('**/api/account/telegram', async (r) => {
    if (r.request().method() === 'PATCH') {
      patches.push(r.request().postDataJSON());
      await r.fulfill({ status: 200, json: { ok: true } });
    } else {
      await r.fulfill({ status: 200, json: status });
    }
  });
  return patches;
}

test('spento di default; un tocco lo accende, un tocco lo spegne', async ({ page }) => {
  const patches = await mock(page, { linked: true, linkedAt: '2026-10-01T00:00:00Z', weeklyDigest: false });
  await page.goto(`${BASE}/account/telegram`);
  const toggle = page.getByRole('switch', { name: /riepilogo settimanale/i });
  await expect(toggle).toBeVisible({ timeout: 30_000 });
  await expect(toggle).not.toBeChecked();
  await toggle.tap();
  await expect(toggle).toBeChecked();
  await toggle.tap();
  await expect(toggle).not.toBeChecked();
  expect(patches).toEqual([{ weeklyDigest: true }, { weeklyDigest: false }]);
});

test('senza Telegram collegato non c\'e\' l\'interruttore', async ({ page }) => {
  await mock(page, { linked: false, linkedAt: null, weeklyDigest: false });
  await page.goto(`${BASE}/account/telegram`);
  await expect(page.getByRole('button', { name: 'Collega Telegram' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('switch')).toHaveCount(0);
});

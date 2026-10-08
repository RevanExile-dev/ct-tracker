import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';

// Sessione finta (come in lots.spec.mjs): basta a far comparire i pulsanti
// riservati a chi ha fatto login, senza toccare il database.
async function mockSession(page) {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({ status: 200, json: { user: { name: 'Test', email: 'a11y@example.test' }, expires: '2099-01-01T00:00:00Z' } }),
  );
  await page.route('**/api/account/**', (route) => route.fulfill({ status: 200, json: [] }));
}

test('skip link: primo Tab, Invio sposta il focus sul contenuto', async ({ page }) => {
  await page.goto(`${BASE}/movers`);
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Vai al contenuto' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#contenuto')).toBeFocused();
});

test('ogni pagina pubblica ha un solo h1', async ({ page }) => {
  for (const path of ['/', '/movers', '/login', '/scan', '/lots']) {
    await page.goto(`${BASE}${path}`);
    await expect(page.locator('h1'), path).toHaveCount(1);
  }
});

test('modale allarme: ruolo dialog, focus intrappolato, Esc restituisce il focus', async ({ page }) => {
  await mockSession(page);
  await page.goto(`${BASE}/card/900202`);
  const opener = page.getByRole('button', { name: /CREA ALLARME/i });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Crea allarme di prezzo' });
  await expect(dialog).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(true);
  for (let i = 0; i < 25; i += 1) {
    await page.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

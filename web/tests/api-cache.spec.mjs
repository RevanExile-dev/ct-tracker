import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';

test('le API pubbliche di sola lettura sono cacheabili dalla CDN', async ({ request }) => {
  for (const path of ['/api/expansions', '/api/meta', '/api/cards?limit=3', '/api/cards/count', '/api/movers']) {
    const res = await request.get(`${BASE}${path}`);
    expect(res.status(), path).toBe(200);
    expect(res.headers()['cache-control'], path).toMatch(/public.*s-maxage=\d+/);
  }
});

test('le API legate all\'utente non sono mai cacheabili', async ({ request }) => {
  for (const path of ['/api/account/lots', '/api/account/binder', '/api/account/wishlist']) {
    const res = await request.get(`${BASE}${path}`);
    expect(res.headers()['cache-control'] ?? '', path).not.toMatch(/s-maxage|public/);
  }
});

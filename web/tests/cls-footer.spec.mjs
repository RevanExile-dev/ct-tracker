import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

test.use({ viewport: { width: 1366, height: 900 } });

// Il footer saltava in vista quando i dati sostituivano lo scheletro:
// CLS 0,23 / 0,15 / 0,09 misurato su PC il 14/10/2026. Soglia "buona" di Google: 0,1;
// qui 0,1 (il CI oscilla: 0,055 visto su "/" mentre in produzione e' 0,013; la misura vera e' quella in produzione).
for (const path of ["/", "/movers", "/wishlist"]) {
  test(`CLS basso su ${path} (PC)`, async ({ page }) => {
    await page.addInitScript(() => {
      window.__cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto(`${BASE_URL}${path}`, { waitUntil: "load" });
    await page.waitForTimeout(3000);
    const cls = await page.evaluate(() => window.__cls);
    expect(cls).toBeLessThan(0.1);
  });
}

// Il sito resta installabile (manifest con icone PNG) ma non ha piu' un
// service worker: /sw.js e' solo lo script che ripulisce chi aveva il vecchio.
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 }, serviceWorkers: "allow" });

test("manifest installabile: icone PNG 192/512 e maskable raggiungibili", async ({ request }) => {
  const m = await (await request.get(`${BASE_URL}/manifest.webmanifest`)).json();
  expect(m.display).toBe("standalone");
  for (const [size, purpose] of [["192x192", "any"], ["512x512", "any"], ["512x512", "maskable"]]) {
    const icon = m.icons.find((i) => i.type === "image/png" && i.sizes === size && i.purpose === purpose);
    expect(icon, `icona ${size} ${purpose}`).toBeTruthy();
    const res = await request.get(`${BASE_URL}${icon.src}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
  }
  expect((await request.get(`${BASE_URL}/icons/apple-touch-icon.png`)).status()).toBe(200);
});

test("lo script di pulizia non intercetta richieste", async ({ request }) => {
  const sw = await (await request.get(`${BASE_URL}/sw.js`)).text();
  expect(sw).not.toMatch(/addEventListener\(\s*["']fetch["']/);
});

test("il sito non registra un service worker", async ({ page }) => {
  await page.goto(`${BASE_URL}/`);
  await page.waitForTimeout(1500);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
});

test("chi ha un vecchio service worker lo perde e le sue cache spariscono", async ({ page }) => {
  await page.goto(`${BASE_URL}/`);
  await page.evaluate(async () => {
    await caches.open("cv-images-v1");
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  });
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), { timeout: 15_000 })
    .toBe(0);
  expect(await page.evaluate(async () => (await caches.keys()).filter((n) => n.startsWith("cv-")))).toEqual([]);
});

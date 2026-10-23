// Tasto mostra/nascondi ricerca e filtri della home: decide solo l'utente,
// lo scroll (anche velocissimo, su e giu') non la riapre ne' la chiude, e la
// scelta e' ricordata. Segnalazione di Cri 16/10/2026: "se nascondo i filtri e
// scorro in alto veloce si riaprono".
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const KEY = "cartaviva:home-filters-open";
const TOGGLE = '[data-testid="filters-toggle"]';

async function ready(page) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  const toggle = page.locator(TOGGLE);
  await expect(toggle).toBeVisible({ timeout: 30_000 });
  await page.waitForSelector("a[href^='/card/']", { timeout: 30_000 });
  await page.waitForTimeout(400); // idratazione
  return toggle;
}
const wrapHeight = (page) => page.locator('[data-testid="toolbar-collapse"]').evaluate((el) => el.getBoundingClientRect().height);

async function fastScrollUpDown(page, touch) {
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    const swipe = async (fromY, toY) => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 200, y: fromY, id: 1 }] });
      for (let i = 1; i <= 6; i++) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 200, y: fromY + ((toY - fromY) * i) / 6, id: 1 }] });
        await page.waitForTimeout(8);
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    for (let i = 0; i < 4; i++) await swipe(740, 160);
    for (let i = 0; i < 6; i++) await swipe(160, 740);
  } else {
    for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 700); await page.waitForTimeout(20); }
    for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, -700); await page.waitForTimeout(15); }
  }
  await page.waitForTimeout(700);
}

for (const [label, opts, touch] of [
  ["PC con mouse", { viewport: { width: 1366, height: 900 } }, false],
  ["telefono con touch", { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, true],
  ["tablet con touch", { viewport: { width: 810, height: 1080 }, hasTouch: true, isMobile: true }, true],
]) {
  test.describe(label, () => {
    test.use(opts);
    const press = (loc) => (touch ? loc.tap() : loc.click());

    test("aperta di default; chiusa a mano resta chiusa dopo scroll veloce su e giu'", async ({ page }) => {
      const toggle = await ready(page);
      await expect(toggle).toContainText("Nascondi ricerca e filtri");
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(await wrapHeight(page)).toBeGreaterThan(100);

      await press(toggle);
      await expect(toggle).toContainText("Mostra ricerca e filtri");
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await page.waitForTimeout(450);
      const closed = await wrapHeight(page);
      expect(closed).toBeLessThan(90);

      await fastScrollUpDown(page, touch);
      expect(await page.evaluate(() => window.scrollY)).toBeLessThan(80); // tornati in cima
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(await wrapHeight(page)).toBeLessThan(90);

      // il tasto la riapre, e stavolta lo scroll non la richiude
      await press(toggle);
      await page.waitForTimeout(450);
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(await wrapHeight(page)).toBeGreaterThan(100);
      await fastScrollUpDown(page, touch);
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(await wrapHeight(page)).toBeGreaterThan(100);
    });

    test("la scelta e' ricordata; con filtri attivi da chiusa lo dice", async ({ page }) => {
      const toggle = await ready(page);
      await press(toggle);
      await page.waitForTimeout(400);
      expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe("0");

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator(TOGGLE)).toBeVisible({ timeout: 30_000 });
      await expect(page.locator(TOGGLE)).toHaveAttribute("aria-expanded", "false", { timeout: 10_000 });
      // campi nascosti non raggiungibili con Tab (inert)
      await expect(page.locator("[inert]").getByLabel("Cerca una carta per nome o numero", { includeHidden: true })).toHaveCount(1);

      await page.goto(`${BASE_URL}/?exp=smoketest`, { waitUntil: "domcontentloaded" });
      await expect(page.locator(TOGGLE)).toContainText("filtri attivi", { timeout: 30_000 });
    });
  });
}

test.describe("stato vecchio / storage non disponibile", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("valore sconosciuto o storage che lancia: resta aperta, nessun errore", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript((k) => { localStorage.setItem(k, "boh"); localStorage.setItem("cv-old-key", "{\"x\":1}"); }, KEY);
    const toggle = await ready(page);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await page.close();

    const ctxPage = await page.context().newPage();
    await ctxPage.addInitScript(() => {
      Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } });
    });
    ctxPage.on("pageerror", (e) => errors.push(e.message));
    await ctxPage.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const t2 = ctxPage.locator(TOGGLE);
    await expect(t2).toBeVisible({ timeout: 30_000 });
    await ctxPage.waitForTimeout(400);
    await t2.tap(); // anche senza storage si puo' chiudere (vale per la visita)
    await expect(t2).toHaveAttribute("aria-expanded", "false");
    expect(errors.filter((m) => !/blocked/.test(m))).toEqual([]);
  });
});

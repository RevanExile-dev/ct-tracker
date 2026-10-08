import { test, expect } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

// Gesti veri sul libro del Binder (vista "Sfoglia Binder"): eventi touch
// consegnati dal browser (CDP Input.dispatchTouchEvent), non click sintetici -
// un resize del viewport piu' .click() non attraversa il percorso
// pointerdown/pointermove/pointerup che il motore di sfoglio usa davvero
// (vedi CLAUDE.md, disciplina di verifica n.6).
const CARDS = Array.from({ length: 40 }, (_, i) => ({
  id: i + 1, name: `Carta ${i + 1}`, image_url: "/icon.svg", expansion_name: "Set di test",
  expansion_code: "test", version: null, rarity: "Rare", best_price_cents: 100 * (i + 1),
  latest_price_cents: 100 * (i + 1), best_price_currency: "EUR", latest_price_currency: "EUR",
}));

async function arrange(page) {
  await page.addInitScript((entries) => {
    localStorage.setItem("ct-tracker:binder:v2", JSON.stringify(entries));
  }, CARDS.map((c) => ({ blueprintId: c.id, language: "it", quantity: 1, finish: "normal", addedAt: "2026-08-01" })));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body = [];
    if (path === "/api/auth/session") body = {};
    else if (path === "/api/cards") body = CARDS;
    else if (path === "/api/cards/trend" || path === "/api/meta") body = {};
    await route.fulfill({ status: 200, json: body });
  });
}

async function openBook(page) {
  await arrange(page);
  await page.goto(`${BASE}/binder?view=book`);
  await expect(page.locator(".binder-flipbook")).toBeVisible({ timeout: 30_000 });
  // Aspetta che il motore abbia finito il layout iniziale.
  await page.waitForTimeout(800);
  await page.locator(".binder-controls").scrollIntoViewIfNeeded();
  await page.evaluate(() => document.querySelector(".binder-controls").scrollIntoView({ block: "end" }));
}

const indicator = (page) => page.locator(".binder-controls [aria-live]");

async function nextSpread(page) {
  await page.getByRole("button", { name: /succ|Avanti/ }).click();
  await expect(page.locator(".binder-center-spine")).toBeVisible();
  await page.waitForTimeout(900);
}

async function bookBox(page) {
  return page.locator(".binder-flipbook").boundingBox();
}

// Swipe a una dita con tempi realistici (totalMs), come farebbe un dito.
async function swipe(cdp, from, to, totalMs, steps = 10) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x, y: from.y, id: 1 }] });
  const t0 = Date.now();
  for (let i = 1; i <= steps; i += 1) {
    const wait = t0 + (totalMs / steps) * i - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps, id: 1 }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

test.describe("binder a libro - touch su telefono", () => {
  test.use({ viewport: { width: 390, height: 664 }, hasTouch: true, isMobile: true });

  test("uno swipe che parte su una carta gira la pagina e non apre la carta", async ({ page }) => {
    await openBook(page);
    await nextSpread(page);
    const before = await indicator(page).innerText();
    const cdp = await page.context().newCDPSession(page);
    const { x, width } = await bookBox(page);
    // Il punto di partenza e' il centro di una tasca (un link): e' il caso che
    // il motore, da solo, ignorava.
    const pocket = await page.locator(".stf__item.--shown .binder-pocket[aria-label]").last().boundingBox();
    const start = { x: pocket.x + pocket.width / 2, y: pocket.y + pocket.height / 2 };
    const startsOnCard = await page.evaluate(([px, py]) => !!document.elementFromPoint(px, py)?.closest("a[href]"), [start.x, start.y]);
    expect(startsOnCard).toBe(true);
    await swipe(cdp, start, { x: x + width * 0.2, y: start.y + 5 }, 160);
    await page.waitForTimeout(1100);
    expect(await indicator(page).innerText()).not.toBe(before);
    expect(new URL(page.url()).pathname).toBe("/binder");
  });

  test("uno swipe verticale sul libro scorre la pagina invece di girarla", async ({ page }) => {
    await openBook(page);
    await nextSpread(page);
    const before = await indicator(page).innerText();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    const cdp = await page.context().newCDPSession(page);
    const { x, y, width, height } = await bookBox(page);
    await swipe(cdp, { x: x + width * 0.6, y: y + height * 0.7 }, { x: x + width * 0.55, y: y + height * 0.7 - 110 }, 220);
    await page.waitForTimeout(800);
    expect(await indicator(page).innerText()).toBe(before);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(scrollBefore);
  });

  test("un trascinamento corto torna indietro e il libro resta usabile", async ({ page }) => {
    await openBook(page);
    await nextSpread(page);
    const before = await indicator(page).innerText();
    const cdp = await page.context().newCDPSession(page);
    const { x, y, width, height } = await bookBox(page);
    await swipe(cdp, { x: x + width * 0.9, y: y + height * 0.85 }, { x: x + width * 0.75, y: y + height * 0.85 }, 400, 8);
    await page.waitForTimeout(1100);
    expect(await indicator(page).innerText()).toBe(before);
    // Non resta bloccato a meta': il bottone gira ancora.
    await page.getByRole("button", { name: /succ|Avanti/ }).click();
    await page.waitForTimeout(1000);
    expect(await indicator(page).innerText()).not.toBe(before);
  });

  test("due dita (pinch) sul libro non girano la pagina", async ({ page }) => {
    await openBook(page);
    await nextSpread(page);
    const before = await indicator(page).innerText();
    const cdp = await page.context().newCDPSession(page);
    const { x, y, width, height } = await bookBox(page);
    await cdp.send("Input.synthesizePinchGesture", { x: x + width / 2, y: y + height / 2, scaleFactor: 2, relativeSpeed: 300, gestureSourceType: "touch" });
    await page.waitForTimeout(800);
    expect(await indicator(page).innerText()).toBe(before);
  });

  test("un tap su una carta apre il dettaglio", async ({ page }) => {
    await openBook(page);
    await nextSpread(page);
    await page.locator(".binder-pocket").first().tap();
    await expect(page).toHaveURL(/\/card\//, { timeout: 20_000 });
  });
});

test.describe("binder a libro - rotazione tablet", () => {
  test.use({ viewport: { width: 810, height: 1080 }, hasTouch: true, isMobile: true });

  test("ruotando tra verticale e orizzontale pagine e contatore restano coerenti", async ({ page }) => {
    await openBook(page);
    for (let i = 0; i < 3; i += 1) {
      await page.getByRole("button", { name: /succ|Avanti/ }).click();
      await page.waitForTimeout(900);
    }
    // Verticale: 4 tasche a foglio -> 40 carte = 10 fogli + copertina = 11.
    await expect(indicator(page)).toContainText("/11");
    await page.setViewportSize({ width: 1080, height: 810 });
    // Orizzontale: 9 tasche a foglio -> 5 fogli + copertina = 6.
    await expect(indicator(page)).toContainText("/6", { timeout: 10_000 });
    // E il libro funziona ancora fino in fondo.
    for (let i = 0; i < 6; i += 1) {
      const next = page.getByRole("button", { name: /succ|Avanti/ });
      if (await next.isDisabled()) break;
      await next.click();
      await page.waitForTimeout(900);
    }
    await expect(page.getByRole("button", { name: /succ|Avanti/ })).toBeDisabled();
    await page.setViewportSize({ width: 810, height: 1080 });
    await expect(indicator(page)).toContainText("/11", { timeout: 10_000 });
  });
});

test.describe("binder a libro - telefono in orizzontale", () => {
  test.use({ viewport: { width: 863, height: 360 }, hasTouch: true, isMobile: true });

  test("usa fogli da 4 tasche e il libro resta leggibile", async ({ page }) => {
    await openBook(page);
    await nextSpread(page);
    // Con fogli da 9 tasche il libro (dimensionato sull'altezza bassa) restava
    // largo poche centinaia di pixel con carte illeggibili.
    await expect(page.locator(".binder-sheet-grid-4").first()).toBeAttached();
    const pocket = await page.locator(".stf__item.--shown .binder-pocket[aria-label]").first().boundingBox();
    expect(pocket.width).toBeGreaterThanOrEqual(60);
  });
});

test.describe("binder a libro - dorso centrale su PC", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("il dorso sta tra i fogli fermi e il foglio che si gira, non sopra", async ({ page }) => {
    await openBook(page);
    await nextSpread(page);
    // Il dorso e' dentro il blocco del motore: i fogli fermi hanno z-index 1,
    // quello in volo 3-5, e il dorso deve cadere in mezzo (prima era fuori dal
    // blocco con z-index 5 e restava disegnato sopra il foglio che si girava).
    const spineZ = await page.evaluate(() => {
      const spine = document.querySelector(".binder-center-spine");
      return spine && spine.parentElement?.classList.contains("stf__block") ? Number(getComputedStyle(spine).zIndex) : null;
    });
    expect(spineZ).toBe(2);
    await page.getByRole("button", { name: /succ/ }).click();
    await page.waitForTimeout(250);
    const zs = await page.evaluate(() => {
      const list = [...document.querySelectorAll(".stf__block > .stf__item")].filter((e) => getComputedStyle(e).display !== "none");
      return list.filter((e) => e.classList.contains("--shown")).map((e) => Number(getComputedStyle(e).zIndex) || 0);
    });
    // Durante il giro esiste almeno un foglio sopra al dorso e uno sotto.
    expect(Math.max(...zs)).toBeGreaterThan(2);
    expect(Math.min(...zs)).toBeLessThan(2);
  });
});

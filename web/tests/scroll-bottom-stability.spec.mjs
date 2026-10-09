import { test, expect } from "@playwright/test";

// Regressione del bug "il sito vibra quando scrollo in fondo" (home).
// Causa: nascondere la barra filtri accorcia il documento; vicino al fondo il
// browser riporta scrollY indietro, useHideOnScrollDown lo leggeva come "l'utente
// sale", rimostrava la barra, e cosi' all'infinito, anche senza piu' input.
// Il test misura la cosa che l'utente percepisce: a riposo (nessun input) scrollY
// deve restare fermo.

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

async function startRecording(page) {
  await page.evaluate(() => {
    window.__scrollLog = [];
    (function tick() {
      window.__scrollLog.push(Math.round(window.scrollY));
      requestAnimationFrame(tick);
    })();
  });
}

async function expectAtRest(page) {
  await page.waitForTimeout(2500);
  const log = await page.evaluate(() => window.__scrollLog);
  // ultimi ~1.5s (circa 90 frame): nessun input in corso
  const rest = log.slice(-90);
  expect(new Set(rest).size, `scrollY a riposo non fermo: ${[...new Set(rest)].join(",")}`).toBe(1);
}

async function openHome(page) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("a[href^='/card/']", { timeout: 30_000 });
  await page.waitForTimeout(1500); // idratazione
  await startRecording(page);
}

test.describe("scroll in fondo alla home - PC con rotella", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("barra visibile al fondo: nessuna oscillazione", async ({ page }) => {
    await openHome(page);
    await page.mouse.move(640, 400);
    for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, 300); await page.waitForTimeout(60); }
    await page.waitForTimeout(800);
    // piccolo scroll verso l'alto: la barra riappare
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(600);
    // di nuovo giu' fino al fondo con la barra visibile (caso del bug)
    for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(40); }
    await expectAtRest(page);
  });

  test("passi piccoli verso il fondo: nessuna oscillazione", async ({ page }) => {
    await openHome(page);
    await page.mouse.move(640, 400);
    for (let i = 0; i < 80; i++) { await page.mouse.wheel(0, 90); await page.waitForTimeout(16); }
    await page.mouse.wheel(0, -200);
    await page.waitForTimeout(700);
    for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, 40); await page.waitForTimeout(16); }
    await expectAtRest(page);
  });
});

test.describe("scroll in fondo alla home - tablet con tocco", () => {
  // iPad: >= 640px, quindi la barra filtri segue ancora lo scroll (sotto, il tocco la
  // rende manuale) - e' il caso touch su cui il bug puo' ancora presentarsi.
  test.use({ viewport: { width: 810, height: 1080 }, hasTouch: true, isMobile: true });

  test("swipe fino al fondo e ritorno: nessuna oscillazione", async ({ page, context }) => {
    await openHome(page);
    const cdp = await context.newCDPSession(page);
    const vp = page.viewportSize();
    async function swipe(dy) {
      const dir = dy > 0 ? -1 : 1;
      let remaining = Math.abs(dy);
      while (remaining > 0) {
        const d = Math.min(remaining, 380);
        remaining -= d;
        const x = vp.width * 0.9;
        const y0 = dir < 0 ? vp.height * 0.8 : vp.height * 0.2;
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: y0, id: 1 }] });
        for (let i = 1; i <= 8; i++) {
          await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y0 + (dir * d * i) / 8, id: 1 }] });
          await page.waitForTimeout(12);
        }
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await page.waitForTimeout(40);
      }
    }
    await swipe(14000);
    await page.waitForTimeout(800);
    await swipe(-300);
    await page.waitForTimeout(600);
    await swipe(600);
    await expectAtRest(page);
  });
});

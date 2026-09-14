import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

// Trova, tra i link carta attualmente nel DOM, uno che sia GIA' dentro il
// viewport corrente: un .first() generico forzerebbe Playwright ad
// auto-scrollarlo in vista prima del tap/click (comportamento nativo di
// Playwright), corrompendo silenziosamente lo scenario "l'utente ha
// scrollato fino a un punto e tocca una carta li'" che questi test
// verificano.
async function inViewportCardLink(page, viewportHeight) {
  const links = page.locator("a[href^='/card/']");
  const count = await links.count();
  for (let i = 0; i < count; i++) {
    const box = await links.nth(i).boundingBox();
    if (box && box.y >= 0 && box.y + box.height <= viewportHeight) return links.nth(i);
  }
  throw new Error("nessuna carta visibile nel viewport corrente");
}

async function goToSecondPage(page) {
  const next = page.getByRole("button", { name: "Successiva →" }).first();
  await expect(next).toBeVisible({ timeout: 15_000 });
  return next;
}

for (const variant of [
  { name: "desktop", contextOptions: { viewport: { width: 1366, height: 900 } }, tap: false },
  {
    name: "mobile",
    contextOptions: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
    tap: true,
  },
]) {
  test.describe(`/movers paginazione e ripristino scroll - ${variant.name}`, () => {
    test.use(variant.contextOptions);

    test("cambiare pagina riporta in cima alla lista, non resta in fondo", async ({ page }) => {
      await page.goto(`${BASE_URL}/movers`, { waitUntil: "domcontentloaded" });
      const next = await goToSecondPage(page);

      // L'utente ha scrollato fino in fondo per trovare il bottone
      // "Successiva" (che sta sotto la griglia di carte) - e' li' che si
      // trova quando lo preme.
      await next.scrollIntoViewIfNeeded();
      await page.waitForTimeout(150);
      const yBeforeClick = await page.evaluate(() => window.scrollY);
      expect(yBeforeClick).toBeGreaterThan(200);

      if (variant.tap) await next.tap();
      else await next.click();

      // Attende l'assestamento dello scroll "smooth" innescato dal cambio
      // pagina.
      await page.waitForTimeout(900);

      const rises = page.locator("section", { has: page.getByText("Maggiori rialzi") }).first();
      const sectionTop = await rises.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
      const yAfterClick = await page.evaluate(() => window.scrollY);
      // La pagina 2 puo' avere pochissime carte (l'ultima pagina spesso non
      // e' piena) ed essere quindi troppo corta perche' il browser possa
      // scrollare fino a portare l'inizio della sezione esattamente in cima
      // al viewport - in quel caso lo scroll si ferma correttamente al
      // massimo raggiungibile, non e' un bug del fix.
      const maxScrollY = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
      const expectedY = Math.min(sectionTop, maxScrollY);

      // Bug reale segnalato dall'utente: senza il fix lo scroll restava
      // fermo sul valore di "yBeforeClick" (in fondo alla pagina precedente)
      // invece di tornare all'inizio della nuova lista di carte.
      expect(yAfterClick).toBeLessThan(yBeforeClick);
      expect(Math.abs(yAfterClick - expectedY)).toBeLessThan(5);

      await expect(page.locator("text=/2 \\/ \\d+/").first()).toBeVisible();
    });

    test("tornando indietro (pulsante nativo del browser) lo scroll torna dov'era", async ({ page }) => {
      await page.goto(`${BASE_URL}/movers`, { waitUntil: "domcontentloaded" });
      const next = await goToSecondPage(page);
      if (variant.tap) await next.tap();
      else await next.click();
      await page.waitForTimeout(900);

      // Scrolla ulteriormente, oltre il punto dove il cambio pagina si e'
      // fermato, per simulare un utente che ha continuato a guardare le
      // carte della pagina 2.
      await page.evaluate(() => window.scrollBy(0, 400));
      await page.waitForTimeout(400);
      const yBeforeLeaving = await page.evaluate(() => window.scrollY);

      const viewportHeight = variant.contextOptions.viewport?.height ?? 844;
      const card = await inViewportCardLink(page, viewportHeight);
      if (variant.tap) await card.tap();
      else await card.click();
      await page.waitForTimeout(800);
      await expect(page).toHaveURL(/\/card\//);

      await page.goBack();
      await page.waitForTimeout(900);

      await expect(page).toHaveURL(/risePage=2/);
      const yAfterBack = await page.evaluate(() => window.scrollY);
      expect(Math.abs(yAfterBack - yBeforeLeaving)).toBeLessThan(20);
    });
  });
}

// Telefono (tap veri): la maniglia dei filtri ha un'etichetta (non e' un
// riquadro vuoto con una freccia) e la riga dei link in alto, quando scorre,
// sfuma sul bordo destro invece di tagliare una pillola a meta'.
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

test("maniglia filtri con etichetta, anche con ricerca attiva", async ({ page }) => {
  await page.goto(BASE_URL);
  const handle = page.getByRole("button", { name: /(Nascondi|Mostra) ricerca e filtri/i });
  await expect(handle).toBeVisible({ timeout: 30_000 });
  await expect(handle).toContainText("Nascondi ricerca e filtri");

  await page.waitForTimeout(300); // idratazione
  await page.getByLabel("Cerca una carta per nome o numero").tap();
  await page.keyboard.type("mew");
  await expect(page.locator("body")).toContainText("carte trovate", { timeout: 20_000 });
  await expect(handle).toContainText("Nascondi ricerca e filtri");

  await handle.tap();
  await expect(handle).toContainText("Mostra ricerca e filtri");
  await handle.tap();
  await expect(handle).toContainText("Nascondi ricerca e filtri");
});

test("riga link in alto: dissolvenza a destra solo se c'e' altro da scorrere", async ({ page }) => {
  await page.goto(BASE_URL);
  const scroller = page.locator("nav[aria-label='Sezioni del sito'] > div").first();
  await expect(scroller).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(300);
  const state = () =>
    scroller.evaluate((el) => ({
      more: el.scrollWidth - el.scrollLeft - el.clientWidth > 2,
      mask: getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage || "none",
    }));
  const before = await state();
  expect(before.more).toBe(true);
  expect(before.mask).toContain("linear-gradient");

  await scroller.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
  await expect.poll(async () => (await state()).mask).toBe("none");
});

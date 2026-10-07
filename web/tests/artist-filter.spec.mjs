import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

// Seed (tests/fixtures/smoke-seed.sql): 8 carte "Akira Egawa", 8 "Mitsuhiro
// Arita", 40 carte in tutto.

test("API artisti: solo la lista curata, con il numero di carte", async ({ request }) => {
  const res = await request.get(`${BASE_URL}/api/artists`);
  expect(res.ok()).toBeTruthy();
  const artists = await res.json();
  expect(artists).toEqual([
    { name: "Akira Egawa", count: 8 },
    { name: "Mitsuhiro Arita", count: 8 },
  ]);
});

test("API carte: filtro per artista e conteggio coerenti", async ({ request }) => {
  const count = await request.get(`${BASE_URL}/api/cards/count?artists=Akira%20Egawa`);
  expect((await count.json()).count).toBe(8);
  const both = await request.get(`${BASE_URL}/api/cards/count?artists=Akira%20Egawa&artists=Mitsuhiro%20Arita`);
  expect((await both.json()).count).toBe(16);
  const none = await request.get(`${BASE_URL}/api/cards/count?artists=Nessuno%20Qualunque`);
  expect((await none.json()).count).toBe(0);
});

// Test con eventi touch veri (CLAUDE.md, regola 6): un click sintetico su un
// viewport stretto non esercita il percorso touchstart/pointerdown reale.
test.describe("filtro Artista - telefono", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("tap su un artista filtra, il pannello resta aperto, chip e URL coerenti", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const trigger = page.getByRole("button", { name: /Artista/i });
    await expect(trigger).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(300); // hydration su runner lenti (stesso motivo di mobile-toolbar)

    // Il catalogo di test ha altre carte oltre alle 40 "Smoke Card": il
    // totale iniziale si legge dalla pagina, non si assume.
    const counter = page.locator('[aria-live="polite"]').filter({ hasText: /trovat/ });
    await expect(counter).toBeVisible({ timeout: 30_000 });
    const initialCount = (await counter.innerText()).trim();

    await trigger.tap();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await page.waitForTimeout(500);
    await expect(trigger).toHaveAttribute("aria-expanded", "true");

    const sheet = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(sheet).toBeVisible();

    // La ricerca dentro al pannello non deve chiuderlo (tap su elemento
    // INTERNO al foglio in portale) e deve restringere l'elenco.
    const search = sheet.getByPlaceholder("Cerca…");
    await search.tap();
    await search.fill("egawa");
    await page.waitForTimeout(300);
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const option = sheet.locator("button[aria-pressed]", { hasText: "Akira Egawa" });
    await expect(option).toHaveCount(1);
    await expect(sheet.locator("button[aria-pressed]", { hasText: "Mitsuhiro Arita" })).toHaveCount(0);

    await option.tap();
    await page.waitForTimeout(400);
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(option).toHaveAttribute("aria-pressed", "true");

    await page.mouse.click(5, 5); // chiusura via backdrop
    await page.waitForTimeout(350);
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    await expect(page.getByText("8 carte trovate")).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/artist=Akira(%20|\+)Egawa/);
    const chip = page.getByRole("button", { name: /Akira Egawa/ });
    await expect(chip).toBeVisible();

    // Nessun overflow orizzontale con il nuovo filtro nella barra.
    const ov = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(ov.scrollWidth).toBeLessThanOrEqual(ov.clientWidth + 1);

    await chip.tap();
    await expect(counter).toHaveText(initialCount, { timeout: 15_000 });
  });

  test("l'artista nella URL ripristina il filtro al caricamento", async ({ page }) => {
    await page.goto(`${BASE_URL}/?artist=Mitsuhiro%20Arita`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("8 carte trovate")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /Mitsuhiro Arita/ })).toBeVisible();
  });
});

import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

const mobileViewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
];

for (const viewport of mobileViewports) {
  test(`catalog toolbar stays usable at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

    const search = page.getByPlaceholder("Cerca una carta per nome…");
    await expect(search).toBeVisible({ timeout: 30_000 });

    const expansion = page.getByRole("button", { name: /Tutte le espansioni/i });
    await expect(expansion).toBeVisible({ timeout: 30_000 });

    const sort = page.getByRole("combobox", { name: "Ordina carte" });
    await expect(sort).toBeVisible();

    const expansionBox = await expansion.boundingBox();
    const sortBox = await sort.boundingBox();
    expect(expansionBox).not.toBeNull();
    expect(sortBox).not.toBeNull();

    // Su telefono/tablet i due controlli non devono piu' essere compressi
    // uno accanto all'altro: entrambi occupano quasi tutta la toolbar e
    // l'ordinamento deve stare nella riga successiva.
    expect(expansionBox.width).toBeGreaterThan(viewport.width - 100);
    expect(sortBox.width).toBeGreaterThan(viewport.width - 100);
    expect(sortBox.y).toBeGreaterThan(expansionBox.y + expansionBox.height - 2);

    await expansion.click();
    const panel = page.locator(".filter-inline.is-open .filter-panel").first();
    await expect(panel).toBeVisible();
    await page.waitForTimeout(350);

    const panelBox = await panel.boundingBox();
    expect(panelBox).not.toBeNull();
    expect(panelBox.x).toBeGreaterThanOrEqual(-1);
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(viewport.width + 1);

    // Il bug mostrato dall'utente produceva un documento piu' largo della
    // viewport e contenuto tagliato. Controlliamo il caso peggiore: pannello
    // espansioni aperto.
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

    await search.click();
    const rarity = page.getByRole("button", { name: /Filtra per rarità/i });
    await expect(rarity).toBeVisible();
    const rarityBox = await rarity.boundingBox();
    expect(rarityBox).not.toBeNull();
    expect(rarityBox.width).toBeGreaterThan(viewport.width - 100);
  });
}

test("desktop keeps compact horizontal primary controls", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

  const search = page.getByPlaceholder("Cerca una carta per nome…");
  const expansion = page.getByRole("button", { name: /Tutte le espansioni/i });
  const sort = page.getByRole("combobox", { name: "Ordina carte" });
  await expect(expansion).toBeVisible({ timeout: 30_000 });

  const searchBox = await search.boundingBox();
  const expansionBox = await expansion.boundingBox();
  const sortBox = await sort.boundingBox();
  expect(searchBox).not.toBeNull();
  expect(expansionBox).not.toBeNull();
  expect(sortBox).not.toBeNull();

  expect(Math.abs(searchBox.y - expansionBox.y)).toBeLessThan(8);
  expect(Math.abs(expansionBox.y - sortBox.y)).toBeLessThan(8);
});

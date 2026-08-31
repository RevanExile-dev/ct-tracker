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

    if (viewport.width < 768) {
      // Telefono: niente due colonne compresse; entrambi i controlli usano
      // quasi tutta la toolbar e l'ordinamento scende sotto l'espansione.
      expect(expansionBox.width).toBeGreaterThan(viewport.width - 100);
      expect(sortBox.width).toBeGreaterThan(viewport.width - 100);
      expect(sortBox.y).toBeGreaterThan(expansionBox.y + expansionBox.height - 2);
    } else {
      // Tablet portrait: c'e' abbastanza spazio per una riga bilanciata a due
      // colonne, senza tornare al vecchio caso in cui uno dei due controlli
      // veniva schiacciato a ~170px e l'altro occupava una riga enorme da solo.
      expect(expansionBox.width).toBeGreaterThan(250);
      expect(sortBox.width).toBeGreaterThan(250);
      expect(Math.abs(sortBox.y - expansionBox.y)).toBeLessThan(8);
    }

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
    let overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

    // QA dello stato realmente usato: selezionando un'espansione compare il
    // pulsante X. Il trigger non deve invadere la sua area touch e il nome del
    // set non deve riallargare il documento.
    const firstExpansionOption = panel.locator("button[aria-pressed]").first();
    await expect(firstExpansionOption).toBeVisible();
    await firstExpansionOption.click();
    await page.waitForTimeout(350);

    const removeExpansion = page.getByRole("button", { name: "Rimuovi filtro espansione" });
    await expect(removeExpansion).toBeVisible();
    const selectedExpansionTrigger = page.locator(".filter-inline .filter-trigger").first();
    const selectedBox = await selectedExpansionTrigger.boundingBox();
    const removeBox = await removeExpansion.boundingBox();
    expect(selectedBox).not.toBeNull();
    expect(removeBox).not.toBeNull();
    expect(selectedBox.x + selectedBox.width).toBeLessThanOrEqual(removeBox.x + 1);

    overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

    await search.click();
    const rarity = page.getByRole("button", { name: /Filtra per rarità/i });
    await expect(rarity).toBeVisible();
    const rarityBox = await rarity.boundingBox();
    expect(rarityBox).not.toBeNull();
    if (viewport.width < 640) {
      expect(rarityBox.width).toBeGreaterThan(viewport.width - 100);
    } else {
      expect(rarityBox.width).toBeGreaterThan(120);
    }
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

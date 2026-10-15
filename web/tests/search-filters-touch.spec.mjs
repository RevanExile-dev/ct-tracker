// Ricerca e filtri su telefono con eventi touch veri (hasTouch/isMobile + .tap()):
// i suggerimenti propongono anche l'espansione, si chiudono da soli scorrendo,
// e Rarità/Prezzo si usano in 2 tocchi senza aprire "Filtri".
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

async function ready(page) {
  await page.goto(BASE_URL);
  await page.waitForFunction(() => {
    const el = document.querySelector("input[role=combobox]");
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps"));
  });
  return page.getByLabel("Cerca una carta per nome o numero");
}

test("suggerimenti: il nome del set compare e un tap lo applica come filtro", async ({ page }) => {
  const input = await ready(page);
  await input.tap();
  await page.keyboard.type("smoke test");
  const setOption = page.getByRole("listbox").getByRole("option").filter({ hasText: "espansione" });
  await expect(setOption).toHaveText(/Smoke Test Set/, { timeout: 20_000 });
  await setOption.tap();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(input).toHaveValue("");
  await expect(page).toHaveURL(/exp=smoketest/);
  await expect(page.getByRole("button", { name: /Smoke Test Set/ }).first()).toBeVisible();
});

test("suggerimenti: nomi + set insieme (\"card test\"), il tap su un nome tiene il set", async ({ page }) => {
  const input = await ready(page);
  await input.tap();
  await page.keyboard.type("card test");
  const options = page.getByRole("listbox").getByRole("option");
  await expect(options.filter({ hasText: "Card" }).first()).toBeVisible({ timeout: 20_000 });
  await expect(options.filter({ hasText: "espansione" })).toHaveCount(1);
  await options.filter({ hasNotText: "espansione" }).first().tap();
  await expect(page).toHaveURL(/exp=smoketest/);
  await expect(input).toHaveValue(/Card/);
});

test("suggerimenti: si chiudono scorrendo la pagina, senza toccare niente", async ({ page }) => {
  const input = await ready(page);
  await input.tap();
  await page.keyboard.type("smoke");
  await expect(page.getByRole("listbox")).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => window.scrollBy(0, 400));
  await expect(page.getByRole("listbox")).toHaveCount(0);
});

test("suggerimenti: un tap fuori dal campo li chiude", async ({ page }) => {
  const input = await ready(page);
  await input.tap();
  await page.keyboard.type("smoke");
  await expect(page.getByRole("listbox")).toBeVisible({ timeout: 20_000 });
  await page.getByText(/carte trovate|carta trovata/).first().tap();
  await expect(page.getByRole("listbox")).toHaveCount(0);
});

test("Prezzo: 2 tocchi dalla pagina, filtra, chip, URL e conteggio coerente", async ({ page }) => {
  await ready(page);
  await expect(page.locator("body")).toContainText("85 carte trovate", { timeout: 20_000 });
  let taps = 0;
  await page.getByRole("button", { name: /^Prezzo/ }).tap(); taps++;
  await page.getByRole("button", { name: "1 – 5 €" }).tap(); taps++;
  expect(taps).toBe(2);
  await expect(page).toHaveURL(/price=1-5/);
  await expect(page.locator("body")).not.toContainText("85 carte trovate");
  const count = await (await page.request.get(`${BASE_URL}/api/cards/count?minPriceCents=100&maxPriceCents=500`)).json();
  await expect(page.locator("body")).toContainText(`${count.count} carte trovate`);
  // il pannello si e' chiuso da solo (closeOnSelect) e la fascia e' rimovibile dalla pillola
  await expect(page.getByRole("button", { name: /^1 – 5 €/ }).first()).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/price=1-5/);
  await expect(page.locator("body")).toContainText(`${count.count} carte trovate`, { timeout: 20_000 });
});

test("Rarità: raggiungibile senza aprire \"Filtri\" (2 tocchi per applicare)", async ({ page }) => {
  await ready(page);
  const rarity = page.getByRole("button", { name: /Rarità/i });
  await expect(rarity).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(300);
  await rarity.tap();
  const option = page.locator("button[aria-pressed]:visible", { hasText: "Common" }).first();
  await expect(option).toBeVisible();
  await option.tap(); // secondo tocco: applicato
  await expect(page).toHaveURL(/rarity=/);
});

test("API prezzo con filtro lingua: coerente con l'elenco", async ({ page }) => {
  const base = `${BASE_URL}/api/cards`;
  const a = await (await page.request.get(`${base}/count?languages=it&minPriceCents=100&maxPriceCents=500`)).json();
  const list = await (await page.request.get(`${base}?languages=it&minPriceCents=100&maxPriceCents=500&limit=200`)).json();
  expect(list.length).toBe(a.count);
});

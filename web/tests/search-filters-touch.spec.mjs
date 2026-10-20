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
  const totalResponse = await page.request.get(`${BASE_URL}/api/cards/count`);
  expect(totalResponse.ok()).toBe(true);
  const total = await totalResponse.json();
  expect(total.count).toBeGreaterThan(0);
  await ready(page);
  await expect(page.locator("body")).toContainText(`${total.count} carte trovate`, { timeout: 20_000 });
  let taps = 0;
  await page.getByRole("button", { name: /^Prezzo/ }).tap(); taps++;
  await page.getByRole("button", { name: "1 – 5 €" }).tap(); taps++;
  expect(taps).toBe(2);
  await expect(page).toHaveURL(/price=1-5/);
  await expect(page.locator("body")).not.toContainText(`${total.count} carte trovate`);
  const count = await (await page.request.get(`${BASE_URL}/api/cards/count?minPriceCents=100&maxPriceCents=500`)).json();
  expect(count.count).toBeGreaterThan(0);
  expect(count.count).toBeLessThan(total.count);
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

test("barra filtri compatta: su 390x664 Rarità, Prezzo e Filtri stanno su una riga e la maniglia sale sopra i 480 px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await ready(page);
  const y = async (loc) => (await loc.boundingBox()).y;
  const rarity = await y(page.getByRole("button", { name: /Rarità/i }));
  const price = await y(page.getByRole("button", { name: /^Prezzo/ }));
  const more = await y(page.getByRole("button", { name: /^Filtri/ }));
  expect(Math.abs(rarity - price)).toBeLessThan(4);
  expect(Math.abs(rarity - more)).toBeLessThan(4);
  const handle = await y(page.getByRole("button", { name: "Nascondi ricerca e filtri" }));
  expect(handle).toBeLessThan(480);
});

test("Invio non sceglie mai un'espansione e tiene il testo se c'e' un numero", async ({ page }) => {
  const input = await ready(page);
  await input.tap();
  await page.keyboard.type("smoke card 1");
  await expect(page.getByRole("listbox")).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press("Enter");
  await expect(input).toHaveValue("smoke card 1");
  await expect(page).not.toHaveURL(/exp=/);
  await expect(page.getByRole("listbox")).toHaveCount(0);

  const fresh = page.waitForResponse((r) => /\/api\/cards\/suggest\?search=smoke(&|$)/.test(r.url()), { timeout: 20_000 });
  await input.fill("smoke");
  await fresh;
  const nameOption = page.getByRole("listbox").getByRole("option").filter({ hasText: /Card/ });
  await expect(nameOption.first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("listbox").getByRole("option").first()).not.toHaveText(/espansione/i);
  await page.keyboard.press("Enter");
  await expect(page).not.toHaveURL(/exp=/);
  await expect(input).toHaveValue(/Card/);
});

test("nessun risultato: pulsanti per togliere i filtri e l'ultima parola", async ({ page }) => {
  await page.goto(`${BASE_URL}/?exp=smoketest&q=smoke%20zzqqxx`);
  await expect(page.getByText("Nessuna carta trovata.")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Cerca «smoke»" }).tap();
  await expect(page.locator("body")).toContainText(/carte? trovat/);
  await expect(page.getByText("Nessuna carta trovata.")).toHaveCount(0);
  await page.goto(`${BASE_URL}/?exp=smoketest&q=zzqqxx`);
  await expect(page.getByText("Nessuna carta trovata.")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Togli i filtri" }).tap();
  await expect(page).not.toHaveURL(/exp=/);
});

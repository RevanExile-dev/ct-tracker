// Riga "Ultime uscite, full art" della home: solo vere full art (rarita'
// speciale + numero oltre il totale del set) e solo con il prezzo che la tile
// mostra. Dati: fine di tests/fixtures/smoke-seed.sql (set "fatest").
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

test("la riga ultime uscite mostra solo full art vere con prezzo, la piu' cara prima", async ({ page, request }) => {
  const rows = await (await request.get(`${BASE_URL}/api/cards?onlyPremium=1&minPriceCents=1&sortBy=expansion_price&limit=10`)).json();
  const names = rows.map((c) => c.name);
  expect(names.slice(0, 2)).toEqual(["FA Secret Cara", "FA Vera Illustration"]);
  for (const bad of ["FA Pinsir", "FA Ex Regolare", "FA Senza Prezzo IT", "FA Promo Fuori Numero"]) {
    expect(names, bad).not.toContain(bad);
  }

  await page.goto(BASE_URL);
  const section = page.locator("div.mt-6").filter({ has: page.getByRole("heading", { name: "Ultime uscite, full art" }) });
  await expect(section.getByText("FA Vera Illustration").first()).toBeVisible({ timeout: 30_000 });
  await expect(section.getByText("FA Pinsir")).toHaveCount(0);
  await expect(section.getByText("FA Ex Regolare")).toHaveCount(0);
});

test("il badge premium segue il criterio full art, non le parole nel nome", async ({ request }) => {
  const all = await (await request.get(`${BASE_URL}/api/cards?search=FA&limit=20`)).json();
  const byName = Object.fromEntries(all.map((c) => [c.name, c.is_premium]));
  expect(byName["FA Pinsir"]).toBe(0);
  expect(byName["FA Ex Regolare"]).toBe(0);
  expect(byName["FA Promo Fuori Numero"]).toBe(0);
  expect(byName["FA Vera Illustration"]).toBe(1);
  expect(byName["FA Senza Prezzo IT"]).toBe(1);
});

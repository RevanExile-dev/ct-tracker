// Lista desideri: la campanella su ogni carta crea l'allarme senza uscire
// dalla lista (tap veri, iPhone-like). Conta i tocchi: campanella -> preset
// Affare -> Traccia = 3, prima servivano scheda carta + crea allarme + preset
// + Traccia = 4 e un ritorno alla lista.
import { test, expect } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

const card = (id, name, cents) => ({
  id, name, image_url: "/icon.svg", expansion_name: "Set di test", expansion_code: "t", version: null,
  rarity: "Rare", best_price_cents: cents, latest_price_cents: cents, best_price_currency: "EUR", latest_price_currency: "EUR",
});

test("desideri: campanella crea l'allarme in 3 tocchi", async ({ page }) => {
  const posts = [];
  const alerts = [{ id: 1, blueprintId: 903001, state: "armed" }];
  await page.addInitScript(() => localStorage.setItem("ct-tracker:wishlist", JSON.stringify([903001, 903002])));
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path === "/api/auth/session") return route.fulfill({ json: { user: { name: "T", email: "t@example.test" }, expires: "2099-01-01T00:00:00Z" } });
    if (path === "/api/cards") return route.fulfill({ json: [card(903001, "Carta con allarme", 2000), card(903002, "Carta senza allarme", 3000)] });
    if (path === "/api/languages") return route.fulfill({ json: ["it", "en"] });
    if (path === "/api/conditions") return route.fulfill({ json: ["Near Mint", "Played"] });
    if (path === "/api/account/alerts" && req.method() === "GET") return route.fulfill({ json: alerts });
    if (path === "/api/account/alerts" && req.method() === "POST") {
      posts.push(req.postDataJSON());
      return route.fulfill({ status: 201, json: { id: 2, blueprintId: 903002, state: "armed" } });
    }
    return route.continue();
  });
  await page.goto(`${BASE}/wishlist`);
  await expect(page.getByTestId("wishlist-no-alert")).toHaveText("1", { timeout: 20_000 });
  await expect(page.getByRole("link", { name: /Allarme attivo/ })).toHaveCount(1);

  await page.getByRole("button", { name: /Crea allarme di prezzo/ }).tap(); // tocco 1
  await page.getByRole("button", { name: /Affare/ }).tap(); // tocco 2
  await page.getByRole("button", { name: "Traccia" }).tap(); // tocco 3
  await expect(page.getByText("Allarme creato")).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ blueprintId: 903002, targetType: "percent_drop", targetValue: 25 });

  await page.getByRole("button", { name: "Chiudi" }).tap();
  await expect(page.getByTestId("wishlist-no-alert")).toHaveText("0");
  await expect(page.getByRole("link", { name: /Allarme attivo/ })).toHaveCount(2);
});

test("desideri da sloggato: nessuna campanella", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ct-tracker:wishlist", JSON.stringify([903001])));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/session") return route.fulfill({ json: {} });
    if (path === "/api/cards") return route.fulfill({ json: [card(903001, "Carta", 2000)] });
    return route.continue();
  });
  await page.goto(`${BASE}/wishlist`);
  await expect(page.locator("body")).toContainText("Carte in lista", { timeout: 20_000 });
  await expect(page.getByRole("button", { name: /Crea allarme/ })).toHaveCount(0);
  await expect(page.getByTestId("wishlist-no-alert")).toHaveCount(0);
});

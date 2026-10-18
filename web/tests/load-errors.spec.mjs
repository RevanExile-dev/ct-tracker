// Errore di caricamento (API in errore): ogni pagina mostra un messaggio chiaro
// con "Riprova" (non "Richiesta a /api/... fallita"), e dopo il ripristino
// dell'API il tap su "Riprova" carica davvero i dati. Eventi touch veri.
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

// Fa fallire (500) le richieste che combaciano finche' state.broken e' true.
async function breakApi(page, pattern) {
  const state = { broken: true };
  await page.route(pattern, (route) =>
    state.broken ? route.fulfill({ status: 500, body: "{}" }) : route.continue(),
  );
  return state;
}

async function expectFriendlyError(page, title) {
  const alert = page.getByTestId("load-error");
  await expect(alert).toContainText(title, { timeout: 20_000 });
  await expect(alert.locator("details")).not.toHaveAttribute("open", ""); // il testo tecnico sta nei dettagli chiusi
  await expect(alert.getByRole("button", { name: "Riprova" })).toBeVisible();
  return alert;
}

test("movers: errore chiaro e Riprova", async ({ page }) => {
  const api = await breakApi(page, /\/api\/movers/);
  await page.goto(`${BASE_URL}/movers`);
  const alert = await expectFriendlyError(page, "Non riesco a caricare le carte in movimento");
  api.broken = false;
  await alert.getByRole("button", { name: "Riprova" }).tap();
  await expect(page.getByTestId("load-error")).toHaveCount(0);
  await expect(page.locator("a[href^='/card/']").first()).toBeVisible({ timeout: 20_000 });
});

test("desideri: errore chiaro e Riprova", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ct-tracker:wishlist", JSON.stringify([903001])));
  const api = await breakApi(page, /\/api\/cards/);
  await page.goto(`${BASE_URL}/wishlist`);
  const alert = await expectFriendlyError(page, "Non riesco a caricare la lista desideri");
  api.broken = false;
  await alert.getByRole("button", { name: "Riprova" }).tap();
  await expect(page.getByTestId("load-error")).toHaveCount(0);
  await expect(page.getByTestId("wishlist-total")).toBeVisible({ timeout: 20_000 });
});

test("binder: errore chiaro e Riprova", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ct-tracker:binder", JSON.stringify([903001])));
  const api = await breakApi(page, /\/api\/cards/);
  await page.goto(`${BASE_URL}/binder?view=collection`);
  const alert = await expectFriendlyError(page, "Non riesco a caricare la collezione");
  api.broken = false;
  await alert.getByRole("button", { name: "Riprova" }).tap();
  await expect(page.getByTestId("load-error")).toHaveCount(0);
  await expect(page.locator("a[href^='/card/']").first()).toBeVisible({ timeout: 20_000 });
});

test("scheda carta: API in errore non diventa 'carta non trovata'; carta inesistente resta tale", async ({ page }) => {
  // ID positivo/safe integer ma oltre il tipo INTEGER di Postgres: la
  // lettura server fallisce davvero, senza flag di produzione o mock RSC.
  const id = 2147483648;
  const fixture = await (await page.request.get(`${BASE_URL}/api/cards/950001`)).json();
  const history = await (await page.request.get(`${BASE_URL}/api/cards/950001/history`)).json();
  const listings = await (await page.request.get(`${BASE_URL}/api/cards/950001/listings`)).json();
  const api = { broken: true };
  const attempts = { card: 0, history: 0, listings: 0 };
  await page.route(new RegExp(`/api/cards/${id}(/history|/listings)?$`), (route) => {
    const path = new URL(route.request().url()).pathname;
    const resource = path.endsWith("/history") ? "history" : path.endsWith("/listings") ? "listings" : "card";
    attempts[resource]++;
    return api.broken
      ? route.fulfill({ status: 500, body: "{}" })
      : route.fulfill({ json: resource === "history" ? history : resource === "listings" ? listings : { ...fixture, id } });
  });
  await page.goto(`${BASE_URL}/card/${id}`);
  const alert = await expectFriendlyError(page, "Non riesco a caricare questa carta");
  await expect.poll(() => attempts).toEqual({ card: 1, history: 1, listings: 1 });
  await expect(page.locator("body")).not.toContainText("Carta non trovata");
  api.broken = false;
  await alert.getByRole("button", { name: "Riprova" }).tap();
  await expect(page.getByTestId("load-error")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: fixture.name })).toBeVisible();
  await expect(page.locator("svg[aria-label^='Andamento prezzo']")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Migliori inserzioni" })).toBeVisible();
  expect(attempts).toEqual({ card: 2, history: 2, listings: 2 });

  await page.goto(`${BASE_URL}/card/99999999`);
  await expect(page.locator("body")).toContainText("Carta non trovata", { timeout: 20_000 });
});

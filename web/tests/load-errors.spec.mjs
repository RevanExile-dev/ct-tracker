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
  const api = await breakApi(page, /\/api\/cards\/903001$/);
  await page.goto(`${BASE_URL}/card/903001`);
  const alert = await expectFriendlyError(page, "Non riesco a caricare questa carta");
  await expect(page.locator("body")).not.toContainText("Carta non trovata");
  api.broken = false;
  await alert.getByRole("button", { name: "Riprova" }).tap();
  await expect(page.getByTestId("load-error")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Carta non trovata");

  await page.goto(`${BASE_URL}/card/99999999`);
  await expect(page.locator("body")).toContainText("Carta non trovata", { timeout: 20_000 });
});

// Progetti di desideri (sottocartelle della lista desideri): da loggati,
// telefono con tocchi veri (CLAUDE.md). (1) Selezione multipla dalla ricerca
// -> "Metti in un progetto" -> progetto nuovo; (2) tre puntini su una carta ->
// progetto esistente; (3) la pagina del progetto somma SOLO quello che manca
// (le carte gia' nel binder non contano); (4) togliere una carta aggiorna il
// totale; (5) senza login la pagina invita ad accedere.
import { test, expect } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

// Uguale al binder seminato (smoke-seed.sql), come in share-link.spec.mjs.
const LOCAL_BINDER = [
  { blueprintId: 900101, language: null, quantity: 2, finish: "foil", addedAt: "2026-10-01" },
  { blueprintId: 900105, language: null, quantity: 1, finish: "normal", addedAt: "2026-10-01" },
  { blueprintId: 900110, language: null, quantity: 3, finish: "unknown", addedAt: "2026-10-01" },
];

test("progetti: selezione multipla, tre puntini, totale di quello che manca", async ({ page, context }) => {
  await context.addCookies([{ name: "authjs.session-token", value: "share-smoke-session", url: BASE }]);
  await page.addInitScript((entries) => {
    if (!localStorage.getItem("ct-tracker:binder:v2")) localStorage.setItem("ct-tracker:binder:v2", JSON.stringify(entries));
  }, LOCAL_BINDER);
  const name = `Prova ${Date.now()}`;

  await page.goto(`${BASE}/?q=Smoke%20Card`);
  await expect(page.getByRole("link", { name: /Smoke Card 2/ }).first()).toBeVisible({ timeout: 20_000 });

  // (1) selezione multipla: 900101 (gia' nel binder), 900102, 900103.
  await page.getByTestId("select-toggle").tap();
  await page.getByRole("button", { name: "Seleziona Smoke Card 1", exact: true }).tap();
  await page.getByRole("button", { name: "Seleziona Smoke Card 2", exact: true }).tap();
  await page.getByRole("button", { name: "Seleziona Smoke Card 3", exact: true }).tap();
  await expect(page.getByTestId("select-bar")).toContainText("3 selezionate");
  await page.getByRole("button", { name: "Metti in un progetto" }).tap();
  await page.getByLabel("Nome del nuovo progetto").fill(name);
  await page.getByRole("button", { name: "Crea", exact: true }).tap();
  await expect(page.getByTestId("project-result")).toContainText("Aggiunte 3 carte", { timeout: 10_000 });
  await page.getByRole("button", { name: "Chiudi" }).tap();

  // (2) tre puntini su una singola carta -> progetto esistente.
  await page.getByRole("button", { name: "Aggiungi a un progetto" }).nth(3).tap();
  await page.getByRole("button", { name: new RegExp(name) }).tap();
  await expect(page.getByTestId("project-result")).toContainText(/Aggiunte 1 carta|Erano già/);
  await page.getByRole("button", { name: "Chiudi" }).tap();

  // (3) pagina progetti e dettaglio.
  await page.goto(`${BASE}/wishlist/progetti`);
  const link = page.getByTestId("project-link").filter({ hasText: name });
  await expect(link).toBeVisible({ timeout: 20_000 });
  await link.tap();
  await expect(page.getByTestId("project-total")).toBeVisible({ timeout: 20_000 });
  // 900101 e' nel binder: non conta. Mancano 900102 (1,02) e 900103 (1,03), piu' la carta del punto (2).
  await expect(page.getByTestId("project-missing")).toContainText(/\b[34]\b/);
  const before = await page.getByTestId("project-total").innerText();

  // (4) tolta una carta il totale cala.
  await page.getByRole("button", { name: "Togli dal progetto" }).first().tap();
  await expect(page.getByTestId("project-total")).not.toHaveText(before);
});

test("progetti: senza login invita ad accedere", async ({ page }) => {
  await page.goto(`${BASE}/wishlist/progetti`);
  await expect(page.locator("main")).toContainText("Accedi", { timeout: 20_000 });
});

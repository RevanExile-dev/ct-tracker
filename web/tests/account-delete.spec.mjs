import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

test.use({ hasTouch: true, isMobile: true });

// Sessione e DELETE mockati: qui si verifica solo la pagina (conferma
// obbligatoria + cosa viene inviato). La cancellazione vera dei dati e'
// stata provata a mano su Postgres con utenti di prova.
test("Elimina account: il tasto resta spento finche' non scrivi ELIMINA", async ({ page }) => {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ status: 200, json: { user: { name: "Test", email: "test@example.test", id: "x" }, expires: "2099-01-01T00:00:00Z" } }));
  let sent = null;
  await page.route("**/api/account", async (route) => {
    if (route.request().method() === "DELETE") {
      sent = route.request().postDataJSON();
      await route.fulfill({ status: 500, json: { error: "x" } }); // niente signOut: si guarda solo l'errore
    } else await route.continue();
  });
  await page.goto(`${BASE_URL}/account/delete`, { waitUntil: "domcontentloaded" });
  const del = page.getByRole("button", { name: "Elimina definitivamente" });
  await expect(del).toBeDisabled({ timeout: 30_000 });
  await page.getByLabel(/Per confermare/).fill("elim");
  await expect(del).toBeDisabled();
  await page.getByLabel(/Per confermare/).fill("ELIMINA");
  await expect(del).toBeEnabled();
  await del.tap();
  await expect(page.getByText("Non è stato cancellato nulla")).toBeVisible();
  expect(sent).toEqual({ confirm: "ELIMINA" });
});

test("Menu account: c'è 'Scarica i miei dati' che punta all'esportazione", async ({ page }) => {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ status: 200, json: { user: { name: "Test", email: "test@example.test", id: "x" }, expires: "2099-01-01T00:00:00Z" } }));
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  const avatar = page.getByRole("button", { name: "Menu account" });
  await expect(avatar).toBeVisible({ timeout: 30_000 });
  await expect(async () => {
    await avatar.tap();
    await expect(page.getByRole("menuitem", { name: "Scarica i miei dati" })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await expect(page.getByRole("menuitem", { name: "Scarica i miei dati" })).toHaveAttribute("href", "/api/account/export");
});

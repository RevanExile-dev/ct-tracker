// App installabile e uso offline: manifest con icone PNG vere e, dopo una
// prima visita, desideri/binder si riaprono anche senza rete, con l'avviso
// che i prezzi possono essere cambiati. Eventi touch veri (CLAUDE.md).
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 }, serviceWorkers: "allow" });

test("manifest installabile: icone PNG 192/512 e maskable raggiungibili", async ({ request }) => {
  const m = await (await request.get(`${BASE_URL}/manifest.webmanifest`)).json();
  expect(m.display).toBe("standalone");
  for (const [size, purpose] of [["192x192", "any"], ["512x512", "any"], ["512x512", "maskable"]]) {
    const icon = m.icons.find((i) => i.type === "image/png" && i.sizes === size && i.purpose === purpose);
    expect(icon, `icona ${size} ${purpose}`).toBeTruthy();
    const res = await request.get(`${BASE_URL}${icon.src}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
  }
  expect((await request.get(`${BASE_URL}/icons/apple-touch-icon.png`)).status()).toBe(200);
});

test("desideri: dopo una visita si riapre senza rete e avvisa", async ({ page, context }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("ct-tracker:wishlist")) {
      localStorage.setItem("ct-tracker:wishlist", JSON.stringify([903001, 903002]));
    }
  });
  await page.goto(`${BASE_URL}/wishlist`);
  await expect(page.getByTestId("wishlist-total")).toContainText("48,00", { timeout: 20_000 });
  // Il service worker prende il controllo, poi una seconda visita riempie la copia salvata.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect(page.getByTestId("wishlist-total")).toContainText("48,00", { timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("status")).toContainText("Sei offline");
  await expect(page.getByRole("status")).toContainText("prezzi possono essere cambiati");
  await expect(page.getByTestId("wishlist-total")).toContainText("48,00", { timeout: 20_000 });

  await context.setOffline(false);
  // Tornata la rete l'avviso "offline" sparisce. Se i dati sul video sono ancora
  // quelli salvati resta un avviso con "Aggiorna" (dipende dai tempi della
  // risposta salvata): lo si usa, poi non deve restare nulla.
  await expect(page.getByText("Sei offline")).toHaveCount(0);
  const aggiorna = page.getByRole("button", { name: "Aggiorna" });
  if (await aggiorna.count()) await aggiorna.tap();
  await expect(page.getByTestId("wishlist-total")).toContainText("48,00", { timeout: 20_000 });
  await expect(page.getByRole("status")).toHaveCount(0);
});

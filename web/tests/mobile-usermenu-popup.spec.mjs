import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

/** Stessa sessione mockata di lots.spec.mjs: qui serve solo per far
 * comparire l'avatar (menu a tendina) invece del link "Accedi" - il resto
 * delle chiamate API prosegue verso il vero server/Postgres seedato. */
async function mockLoggedIn(page) {
  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({
      status: 200,
      json: { user: { name: "Test Utente", email: "test@example.test" }, expires: "2099-01-01T00:00:00Z" },
    });
  });
}

// Le stesse sezioni raggiungibili dall'header (SiteHeader): ognuna nasconde
// il proprio link ("!onMovers", "!onBinder", ecc.), quindi il numero e
// l'ordine dei bottoni prima dell'avatar cambiano da pagina a pagina - e con
// essi la riga di "flex flex-wrap" su cui l'avatar finisce a schermo stretto
// (il bug segnalato: l'avatar "si sposta" e, quando finisce vicino al bordo
// sinistro, il menu ancorato a destra del bottone sborda fuori viewport).
const sections = [
  { name: "Prezzi (home)", path: "/" },
  { name: "Carte in movimento", path: "/movers" },
  { name: "Binder", path: "/binder?view=collection" },
  { name: "Desideri", path: "/wishlist" },
  { name: "Scanner", path: "/scan" },
  { name: "Lotti", path: "/lots" },
];

const mobileViewports = [
  { name: "360px", viewport: { width: 360, height: 800 } },
  { name: "390px", viewport: { width: 390, height: 844 } },
  { name: "412px", viewport: { width: 412, height: 915 } }, // larghezza tipica Android
];

for (const device of mobileViewports) {
  test.describe(`menu account: nessun overflow a ${device.name}`, () => {
    test.use({ viewport: device.viewport, hasTouch: true, isMobile: true });

    for (const section of sections) {
      test(`${section.name} - il menu a tendina resta dentro il viewport`, async ({ page }) => {
        await mockLoggedIn(page);
        await page.goto(`${BASE_URL}${section.path}`, { waitUntil: "domcontentloaded" });

        const avatar = page.getByRole("button", { name: "Menu account" });
        await expect(avatar).toBeVisible({ timeout: 30_000 });
        // Stessa cautela di mobile-toolbar.spec.mjs: un tap troppo precoce
        // puo' precedere l'hydration React (l'onClick non e' ancora
        // agganciato), causando un flake dove aria-expanded resta "false".
        await page.waitForTimeout(300);

        // TAP reale, non un click sintetico - e' proprio la sequenza touch
        // reale (non un resize+click da mouse) quella rilevante per bug di
        // posizionamento legati a getBoundingClientRect() calcolato in un
        // useLayoutEffect innescato dall'apertura.
        await avatar.tap();
        await expect(avatar).toHaveAttribute("aria-expanded", "true");

        const menu = page.getByRole("menu");
        await expect(menu).toBeVisible();
        const menuBox = await menu.boundingBox();
        expect(menuBox).not.toBeNull();

        // Il cuore del bug segnalato: la finestrella (allarmi prezzo,
        // notifiche Telegram, esci) non deve MAI uscire dal viewport, né a
        // sinistra né a destra, qualunque sia la posizione dell'avatar dopo
        // il wrap dei bottoni dell'header su questa sezione specifica.
        expect(menuBox.x).toBeGreaterThanOrEqual(-1);
        expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(device.viewport.width + 1);

        // Le voci del menu devono restare cliccabili/visibili (non solo il
        // box esterno "per caso" dentro viewport con contenuto tagliato).
        await expect(page.getByRole("menuitem", { name: "Allarmi prezzo" })).toBeVisible();
        await expect(page.getByRole("menuitem", { name: "Notifiche Telegram" })).toBeVisible();
        await expect(page.getByRole("menuitem", { name: "Esci" })).toBeVisible();

        // Tap REALE (non un click sintetico da mouse) fuori dal menu -
        // angolo in alto a sinistra, lontano da avatar e menu - lo richiude:
        // stesso meccanismo click-fuori gia' testato altrove, ma verificato
        // sul vero percorso touch (il listener e' su "pointerdown").
        await page.touchscreen.tap(2, 2);
        await page.waitForTimeout(150);
        await expect(avatar).toHaveAttribute("aria-expanded", "false");
      });
    }
  });
}

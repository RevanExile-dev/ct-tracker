import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

async function overflow(page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

// Locator strutturale per il trigger dell'espansione: la sua etichetta
// cambia da "Tutte le espansioni" al nome del set selezionato, quindi un
// locator per testo smetterebbe di matchare dopo una selezione.
function expansionTrigger(page) {
  return page.locator(".filter-inline").first().locator(".filter-trigger");
}

const mobileDevices = [
  { name: "360px", viewport: { width: 360, height: 800 } },
  { name: "390px", viewport: { width: 390, height: 844 } },
  { name: "430px", viewport: { width: 430, height: 932 } },
];

for (const device of mobileDevices) {
  test.describe(`modale filtri centrato - telefono ${device.name}`, () => {
    test.use({ viewport: device.viewport, hasTouch: true, isMobile: true });

    test(`nessun overflow e nessuna chiusura automatica a ${device.name}`, async ({ page }) => {
      await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

      const search = page.getByPlaceholder("Cerca una carta per nome…");
      await expect(search).toBeVisible({ timeout: 30_000 });

      // Da chiuso, i filtri non devono MAI occupare spazio ne' allargare la
      // pagina - il bug originale segnalato dall'utente ("coprono l'intera
      // schermata anche da chiusi").
      let ov = await overflow(page);
      expect(ov.scrollWidth).toBeLessThanOrEqual(ov.clientWidth + 1);

      // Guardia di regressione per un secondo bug reale, stesso reclamo:
      // .filter-toolbar aveva flex-col+items-stretch sotto sm (ogni
      // trigger a piena larghezza, impilati) E le etichette erano troppo
      // lunghe ("Filtra per rarità" ecc.) per affiancarsi anche dopo aver
      // tolto flex-col - a 360px il blocco restava comunque a ~274px con
      // un controllo per riga. Accorciate le etichette (solo "Rarità" ecc.)
      // cosi' entrano piu' controlli per riga anche sul telefono piu'
      // stretto testato qui. Soglia sotto la vecchia altezza rotta.
      const toolbarBox = await page.locator(".filter-toolbar").boundingBox();
      expect(toolbarBox).not.toBeNull();
      expect(toolbarBox.height).toBeLessThan(200);

      const expansion = expansionTrigger(page);
      await expect(expansion).toBeVisible({ timeout: 30_000 });

      // TAP reale (non un click sintetico): e' proprio la sequenza touch a
      // essere stata segnalata come rotta ("appena li clicco si auto
      // chiudono"). Il pannello deve restare aperto ben oltre l'istante del
      // tap, non richiudersi da solo nello stesso giro di eventi.
      await expansion.tap();
      await page.waitForTimeout(80);
      await expect(expansion).toHaveAttribute("aria-expanded", "true");
      await page.waitForTimeout(500);
      await expect(expansion).toHaveAttribute("aria-expanded", "true");

      const sheet = page.locator('[role="dialog"][aria-modal="true"]');
      await expect(sheet).toBeVisible();
      const sheetBox = await sheet.boundingBox();
      expect(sheetBox).not.toBeNull();
      expect(sheetBox.x).toBeGreaterThanOrEqual(-1);
      expect(sheetBox.x + sheetBox.width).toBeLessThanOrEqual(device.viewport.width + 1);

      // Richiesto esplicitamente dall'utente: un modale centrato, non un
      // bottom sheet ancorato in fondo allo schermo ("quando apro un
      // filtro nn si posiziona in centro"). Guardia di regressione: il
      // centro del dialogo deve restare vicino al centro del viewport.
      const dialogCenterX = sheetBox.x + sheetBox.width / 2;
      const dialogCenterY = sheetBox.y + sheetBox.height / 2;
      expect(Math.abs(dialogCenterX - device.viewport.width / 2)).toBeLessThan(10);
      expect(Math.abs(dialogCenterY - device.viewport.height / 2)).toBeLessThan(device.viewport.height * 0.15);

      ov = await overflow(page);
      expect(ov.scrollWidth).toBeLessThanOrEqual(ov.clientWidth + 1);

      // Selezione di un'opzione: applica il filtro e chiude (closeOnSelect).
      const firstOption = sheet.locator("button[aria-pressed]").first();
      await expect(firstOption).toBeVisible();
      await firstOption.tap();
      await page.waitForTimeout(400);
      await expect(expansion).toHaveAttribute("aria-expanded", "false");
      await expect(expansion).not.toContainText("Tutte le espansioni");

      const removeExpansion = page.getByRole("button", { name: "Rimuovi filtro espansione" });
      await expect(removeExpansion).toBeVisible();

      ov = await overflow(page);
      expect(ov.scrollWidth).toBeLessThanOrEqual(ov.clientWidth + 1);
      await removeExpansion.tap();
      await page.waitForTimeout(200);

      // Filtro rarita: stesso controllo anti-auto-chiusura, poi chiusura via
      // tap sul backdrop (l'unico meccanismo di chiusura su mobile, niente
      // piu' listener document-level duplicati mousedown+touchstart).
      const rarity = page.getByRole("button", { name: /Rarità/i });
      await rarity.tap();
      await page.waitForTimeout(100);
      await expect(rarity).toHaveAttribute("aria-expanded", "true");
      await page.waitForTimeout(400);
      await expect(rarity).toHaveAttribute("aria-expanded", "true");

      ov = await overflow(page);
      expect(ov.scrollWidth).toBeLessThanOrEqual(ov.clientWidth + 1);

      // Bug reale trovato in review (Gemini): il foglio mobile e' in portale
      // su document.body, quindi NON e' un discendente DOM del trigger - un
      // tap su una pillola AL SUO INTERNO (senza closeOnSelect) veniva
      // scambiato dal listener "fuori dal pannello chiudi" per un tap fuori,
      // richiudendo il foglio all'istante prima ancora che la selezione
      // "contasse" agli occhi dell'utente.
      const raritySheet = page.locator('[role="dialog"][aria-modal="true"]');
      const rarityPill = raritySheet.locator("button[aria-pressed]").first();
      await rarityPill.tap();
      await page.waitForTimeout(300);
      await expect(rarity).toHaveAttribute("aria-expanded", "true");
      await expect(rarityPill).toHaveAttribute("aria-pressed", "true");

      await page.mouse.click(5, 5); // tap sul backdrop, lontano dal foglio
      await page.waitForTimeout(350);
      await expect(rarity).toHaveAttribute("aria-expanded", "false");

      // A transizione di chiusura finita il pannello deve essere smontato
      // del tutto (zero impatto sul layout), non solo invisibile.
      await page.waitForTimeout(300);
      await expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(0);
      ov = await overflow(page);
      expect(ov.scrollWidth).toBeLessThanOrEqual(ov.clientWidth + 1);
    });
  });
}

test.describe("barra filtri: si nasconde scrollando giu, torna scrollando su", () => {
  test.use({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });

  test("scroll giu nasconde, scroll su mostra, la maniglia funziona, lo scrollY si assesta", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const wrap = page.locator('[data-testid="toolbar-collapse"]');
    await expect(wrap).toBeVisible({ timeout: 30_000 });

    const topHeight = (await wrap.boundingBox()).height;
    expect(topHeight).toBeGreaterThan(100);

    // Bug reale trovato durante lo sviluppo: comprimere la barra (sticky
    // ma nel flusso del documento) cambia l'altezza della pagina, e senza
    // overflow-anchor:none lo "scroll anchoring" nativo del browser
    // compensava da solo scrollY per tenere fermo il contenuto sotto -
    // generando un nuovo evento scroll che il hook interpretava come un
    // gesto dell'utente, in un loop infinito che non si assestava mai.
    await page.mouse.wheel(0, 600);
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(1500);
    const y1 = await page.evaluate(() => window.scrollY);
    await page.waitForTimeout(300);
    const y2 = await page.evaluate(() => window.scrollY);
    expect(y1).toBe(y2); // scrollY assestato, non ancora in oscillazione

    const hiddenHeight = (await wrap.boundingBox()).height;
    expect(hiddenHeight).toBeLessThan(40); // resta solo la maniglia

    await page.mouse.wheel(0, -200);
    await page.waitForTimeout(400);
    const shownHeight = (await wrap.boundingBox()).height;
    expect(shownHeight).toBeGreaterThan(100);

    // Maniglia manuale, indipendente dallo scroll.
    const handle = page.getByRole("button", { name: /Nascondi filtri|Mostra filtri/i });
    await handle.tap();
    await page.waitForTimeout(400);
    expect((await wrap.boundingBox()).height).toBeLessThan(40);
    await handle.tap();
    await page.waitForTimeout(400);
    expect((await wrap.boundingBox()).height).toBeGreaterThan(100);

    const ov = await overflow(page);
    expect(ov.scrollWidth).toBeLessThanOrEqual(ov.clientWidth + 1);
  });
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1366, height: 900 } });

  test("popover ancorato al trigger, chiusura con click fuori, nessun auto-chiusura", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

    const search = page.getByPlaceholder("Cerca una carta per nome…");
    const expansion = expansionTrigger(page);
    const sort = page.getByRole("combobox", { name: "Ordina carte" });
    await expect(expansion).toBeVisible({ timeout: 30_000 });

    const searchBox = await search.boundingBox();
    const expansionBox = await expansion.boundingBox();
    const sortBox = await sort.boundingBox();
    expect(Math.abs(searchBox.y - expansionBox.y)).toBeLessThan(8);
    expect(Math.abs(expansionBox.y - sortBox.y)).toBeLessThan(8);

    const rarity = page.getByRole("button", { name: /Rarità/i });
    await rarity.click();
    await page.waitForTimeout(300);
    await expect(rarity).toHaveAttribute("aria-expanded", "true");

    let ov = await overflow(page);
    expect(ov.scrollWidth).toBeLessThanOrEqual(ov.clientWidth + 1);

    await page.mouse.click(5, 5);
    await page.waitForTimeout(350);
    await expect(rarity).toHaveAttribute("aria-expanded", "false");
  });
});

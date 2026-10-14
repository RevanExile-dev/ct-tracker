// Scheda carta su telefono: la miniatura (34% di larghezza) si ingrandisce con un
// tap, si chiude con "Chiudi", con tap fuori o con Escape; un trascinamento
// (tilt) non la apre. Tap veri (hasTouch/isMobile). Le immagini esterne non si
// raggiungono in modo affidabile dal runner (nel seed sono URL finti di
// cardtrader.com): la richiesta dell'immagine riceve un PNG locale.
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAOCAIAAACZwRr8AAAAE0lEQVR4nGPQiFqABzGMSg82aQA2xJ6ZNRyA1QAAAABJRU5ErkJggg==",
  "base64",
);

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

async function openCard(page) {
  await page.route(/cardtrader\.com\/uploads|\/_next\/image/, (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.goto(`${BASE_URL}/card/903001`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(500); // idratazione
}

test("tap sulla miniatura: immagine grande, si chiude in 3 modi", async ({ page }) => {
  await openCard(page);
  const thumb = page.getByRole("button", { name: "Ingrandisci immagine" });
  const thumbBox = await thumb.boundingBox();
  expect(thumbBox.width).toBeLessThan(200); // miniatura piccola

  await thumb.tap();
  const dialog = page.getByRole("dialog", { name: /Immagine ingrandita/ });
  await expect(dialog).toBeVisible();
  const big = await dialog.locator("img").boundingBox();
  expect(big.width).toBeGreaterThan(300); // grande, quasi a tutta larghezza
  expect(big.height).toBeGreaterThan(big.width); // proporzioni carta (5:7)

  await dialog.getByRole("button", { name: "Chiudi" }).tap();
  await expect(dialog).toHaveCount(0);

  await thumb.tap();
  await expect(dialog).toBeVisible();
  await page.getByTestId("lightbox-backdrop").tap({ position: { x: 5, y: 5 } });
  await expect(dialog).toHaveCount(0);

  await thumb.tap();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // Dopo la chiusura la pagina e' ancora usabile con un tap vero.
  await page.getByRole("button", { name: /aggiungi ai desideri/i }).tap();
  await expect(page.getByRole("button", { name: /nella lista desideri/i })).toBeVisible();
});

test("un trascinamento sull'immagine non apre l'ingrandimento", async ({ page }) => {
  await openCard(page);
  const box = await page.getByRole("button", { name: "Ingrandisci immagine" }).boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 6; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + i * 6, y: y + i * 3 }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(400);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

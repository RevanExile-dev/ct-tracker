import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

// PNG 1x1: forza il detector nel fallback full-frame senza fixture binarie.
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z9ZkAAAAASUVORK5CYII=",
  "base64",
);

test.describe("scanner CartaViva", () => {
  test("route visibile, upload e fallback manuale funzionano anche senza OCR CDN", async ({ page }) => {
    await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());

    await page.goto(`${BASE_URL}/scan`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Inquadra/i })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /Carica una foto/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Apri la fotocamera/i })).toBeVisible();

    const input = page.locator('input[type="file"]').first();
    await input.setInputFiles({ name: "scanner-test.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG });
    await expect(page.getByText(/Nessun bordo sicuro|carta rilevata/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Sessione/i)).toBeVisible();

    const manual = page.getByPlaceholder(/Correggi:/i);
    await expect(manual).toBeVisible({ timeout: 30_000 });
    await manual.fill("Pikachu");
    await page.getByRole("button", { name: "Cerca", exact: true }).click();

    const pikachuCandidate = page.getByRole("button", { name: /Pikachu/i }).first();
    await expect(pikachuCandidate).toBeVisible({ timeout: 30_000 });
    await pikachuCandidate.click();
    await expect(page.getByRole("heading", { name: /^Pikachu$/i }).first()).toBeVisible({ timeout: 30_000 });

    const binder = page.getByRole("button", { name: /Binder/i }).last();
    await expect(binder).toBeEnabled();
    await binder.click();
    await expect(page.getByRole("button", { name: "Nel Binder ✓", exact: true })).toBeVisible();
  });

  test("OCR zonale + collector number corregge O/1 e sceglie la ristampa esatta", async ({ page }) => {
    // Stub locale del worker: esercita il vero pipeline UI/catalogo senza rete
    // Tesseract. Il numero contiene apposta I al posto di 1, errore tipico OCR.
    await page.addInitScript(() => {
      window.Tesseract = {
        createWorker: async () => {
          let params = {};
          return {
            setParameters: async (next) => { params = next; },
            recognize: async () => {
              if (String(params.tessedit_char_whitelist ?? "").includes("0123456789")) {
                return { data: { text: "I95/I82", confidence: 96 } };
              }
              if (String(params.tessedit_pageseg_mode ?? "") === "7") {
                return { data: { text: "Blitzle", confidence: 97 } };
              }
              return { data: { text: "debolezza resistenza ritirata", confidence: 94 } };
            },
            terminate: async () => {},
          };
        },
      };
    });

    await page.goto(`${BASE_URL}/scan`, { waitUntil: "domcontentloaded" });
    const input = page.locator('input[type="file"]').first();
    await input.setInputFiles({ name: "blitzle-test.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG });

    await expect(page.getByRole("heading", { name: /Blitzle/i }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Italiano/i).first()).toBeVisible({ timeout: 30_000 });

    const cardImage = page.locator('img[alt*="Blitzle" i]').first();
    await expect(cardImage).toBeVisible();
    await expect(cardImage).toHaveAttribute("src", /195-182/i);
  });

  test("la home espone un ingresso Scanner navigabile", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const scannerLink = page.getByRole("link", { name: /Scanner/i }).first();
    await expect(scannerLink).toBeVisible({ timeout: 30_000 });
    await expect(scannerLink).toHaveAttribute("href", "/scan");
  });

  test.describe("mobile touch", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test("nessun overflow e target principali tappabili", async ({ page }) => {
      await page.goto(`${BASE_URL}/scan`, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: /Inquadra/i })).toBeVisible({ timeout: 30_000 });
      const metrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
      await expect(page.getByRole("button", { name: /Carica una foto/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /Apri la fotocamera/i })).toBeVisible();
    });
  });
});

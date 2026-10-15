import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';

// 1x1 PNG valido: basta a far considerare "caricata" l'immagine.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

test('se la miniatura /api/img non risponde la tile mostra l\'immagine intera, mai un riquadro vuoto', async ({ page }) => {
  const fullRequests = [];
  await page.route(/\/api\/img\?/, (route) => route.fulfill({ status: 500, body: 'errore' }));
  await page.route(/cardtrader\.com\/uploads\/blueprints\/image\/900000\/(?!preview_)/, (route) => {
    fullRequests.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
  });
  await page.goto(BASE_URL + '/');
  const tile = page.locator("img[alt='Mover Card 1'][sizes='174px']").first();
  await expect(tile).toBeVisible();
  // opacity 1 = la tile ha dato l'immagine per caricata (onLoad dell'intera).
  await expect(tile).toHaveCSS('opacity', '1');
  await expect(tile).not.toHaveAttribute('srcset', /.+/);
  await expect(page.getByText('immagine non disponibile')).toHaveCount(0);
  expect(fullRequests.length).toBeGreaterThan(0);
});

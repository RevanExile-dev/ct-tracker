import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const LEGACY_KEY = "ct-tracker:binder";
const V2_KEY = "ct-tracker:binder:v2";

test.describe("Binder v2: migrazione dal formato legacy", () => {
  test("migra Set<id> legacy in entry v2 senza toccare/cancellare il dato vecchio", async ({ page }) => {
    // Seeding PRIMA che qualunque script della pagina giri, cosi' la
    // migrazione lazy in lib/binder.ts la trova gia' li' al primo mount.
    await page.addInitScript(([key, ids]) => {
      window.localStorage.setItem(key, JSON.stringify(ids));
    }, [LEGACY_KEY, [101, 202, 303]]);

    await page.goto(`${BASE_URL}/binder`, { waitUntil: "domcontentloaded" });
    // Il caricamento carte fallisce (id inventati, non nel catalogo reale) -
    // non e' il punto di questo test, ci interessa solo lo storage.
    await page.waitForTimeout(500);

    const state = await page.evaluate(([legacyKey, v2Key]) => ({
      legacy: window.localStorage.getItem(legacyKey),
      v2: window.localStorage.getItem(v2Key),
    }), [LEGACY_KEY, V2_KEY]);

    expect(state.legacy).toBe(JSON.stringify([101, 202, 303]));
    expect(state.v2).not.toBeNull();
    const entries = JSON.parse(state.v2);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.blueprintId).sort((a, b) => a - b)).toEqual([101, 202, 303]);
    for (const entry of entries) {
      expect(entry.quantity).toBe(1);
      expect(entry.finish).toBe("unknown");
      expect(entry.language).toBeNull();
      expect(typeof entry.addedAt).toBe("string");
    }
  });

  test("idempotente: una seconda visita non duplica le entry ne' resetta modifiche v2", async ({ page }) => {
    await page.addInitScript(([key, ids]) => {
      window.localStorage.setItem(key, JSON.stringify(ids));
    }, [LEGACY_KEY, [55]]);

    await page.goto(`${BASE_URL}/binder`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);

    // Simula una modifica v2 successiva alla migrazione (es. lo scanner ha
    // registrato la lingua) - una ri-migrazione non deve MAI sovrascriverla.
    await page.evaluate(([v2Key]) => {
      const entries = JSON.parse(window.localStorage.getItem(v2Key));
      entries[0].language = "it";
      entries[0].quantity = 2;
      window.localStorage.setItem(v2Key, JSON.stringify(entries));
    }, [V2_KEY]);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);

    const entries = await page.evaluate(([v2Key]) => JSON.parse(window.localStorage.getItem(v2Key)), [V2_KEY]);
    expect(entries).toHaveLength(1);
    expect(entries[0].language).toBe("it");
    expect(entries[0].quantity).toBe(2);
  });

  test("il bottone stella nel catalogo continua a funzionare come prima (nessuna regressione v1)", async ({ page }) => {
    await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("article, [class*='card']", { timeout: 30_000 }).catch(() => {});

    const starButton = page.locator('button[aria-label*="binder" i]').first();
    await expect(starButton).toBeVisible({ timeout: 30_000 });
    await starButton.click();

    const v2 = await page.evaluate(([v2Key]) => window.localStorage.getItem(v2Key), [V2_KEY]);
    expect(v2).not.toBeNull();
    const entries = JSON.parse(v2);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].quantity).toBe(1);
    expect(entries[0].finish).toBe("unknown");
  });
});

// Ricerca per nome: "mew" trova anche Mewtwo, ma i nomi che combaciano meglio
// vengono per primi; il filtro "Nome esatto" esclude Mewtwo. Eventi touch veri
// (hasTouch/isMobile + .tap()), come richiesto in CLAUDE.md.
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

const cardNames = (page) =>
  page.locator("a[href^='/card/']").evaluateAll((links) =>
    links.map((a) => a.innerText.split("\n").filter(Boolean).pop()),
  );

test("mew: pertinenza prima, poi Nome esatto esclude Mewtwo", async ({ page }) => {
  await page.goto(BASE_URL);
  await page.getByLabel("Cerca una carta per nome o numero").tap();
  await page.keyboard.type("mew");
  await expect(page.locator("body")).toContainText("4 carte trovate");
  expect(await cardNames(page)).toEqual(["Mew", "Mew ex", "Mewtwo", "Mewtwo ex"]);

  await page.getByRole("button", { name: "Nome esatto" }).first().tap();
  await expect(page.locator("body")).toContainText("2 carte trovate");
  await expect(page).toHaveURL(/exact=1/);
  expect(await cardNames(page)).toEqual(["Mew", "Mew ex"]);

  await page.reload();
  await expect(page.getByRole("button", { name: "Nome esatto" }).first()).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("body")).toContainText("2 carte trovate");
});

test("suggerimenti: \"char\" propone i nomi, tap e Invio filtrano", async ({ page }) => {
  await page.goto(BASE_URL);
  const input = page.getByLabel("Cerca una carta per nome o numero");
  await input.tap();
  await page.keyboard.type("char");
  const options = page.getByRole("listbox").getByRole("option");
  await expect(options).toHaveText(["Charizard", "Charmeleon", "Charizard ex"]);

  // Tap su un suggerimento: filtra su quel nome e chiude l'elenco.
  await options.nth(1).tap();
  await expect(input).toHaveValue("Charmeleon");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page.locator("body")).toContainText("1 carta trovata");

  // Invio senza scegliere: prende il suggerimento piu' vicino (il primo).
  await input.fill("char");
  await expect(page.getByRole("listbox").getByRole("option").first()).toHaveText("Charizard");
  await page.keyboard.press("Enter");
  await expect(input).toHaveValue("Charizard");
  await expect(page.locator("body")).toContainText("2 carte trovate");
});

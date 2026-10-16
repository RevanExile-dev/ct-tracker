#!/usr/bin/env node
/**
 * Controllo immagini rotte e tempi in produzione, con un browser vero.
 *
 * Nasce dalla lezione del 15/10/2026: una modifica "verde" in CI aveva rotto
 * le immagini solo per chi aveva gia' visitato il sito (service worker vecchio).
 * Per ogni pagina pubblica principale e per ogni profilo (PC, telefono emulato
 * con touch) conta le immagini rotte in due situazioni:
 *   - "pulito": browser nuovo, nessuno stato;
 *   - "stato vecchio": localStorage precompilato, cache del vecchio service
 *     worker e vecchio sw.js installato (come un visitatore del 14/10), poi
 *     ricarica con la cache HTTP gia' calda.
 * Fallisce se: piu' del 5% delle immagini e' rotto, la pagina non ne mostra
 * nessuna dove ce ne devono essere, resta un service worker registrato, o i
 * tempi superano le soglie. Non scrive nulla sul sito (solo letture GET).
 * Uso: node site_images_check.mjs [URL_BASE]
 * Variabili: SITE_URL, BROKEN_MAX_RATIO, LOAD_MAX_S, IMAGES_MAX_S,
 *            SIMULATE_BROKEN=1 (prova: rompe ~1 immagine su 3 nel browser),
 *            CHROMIUM_PATH (solo prove locali).
 */
import { chromium, devices } from "@playwright/test";
import fs from "node:fs";

const BASE = (process.argv[2] ?? process.env.SITE_URL ?? "https://ct-tracker-eight.vercel.app").replace(/\/$/, "");
const BROKEN_MAX_RATIO = Number(process.env.BROKEN_MAX_RATIO ?? 0.05);
const LOAD_MAX_S = Number(process.env.LOAD_MAX_S ?? 10); // pagina pronta (load)
const IMAGES_MAX_S = Number(process.env.IMAGES_MAX_S ?? 20); // tutte le immagini tentate

// minImages: sotto questa soglia la pagina e' considerata vuota/rotta.
const PAGES = [
  { name: "Home", path: "/", minImages: 8 },
  { name: "Scheda carta", path: "/card/402962", minImages: 1 },
  { name: "Movers", path: "/movers", minImages: 8 },
  // Il binder vero richiede il login: qui si controlla solo che la pagina
  // (o il suo invito ad accedere) si carichi senza immagini rotte.
  { name: "Binder", path: "/binder", minImages: 0 },
];
const PROFILES = [
  { name: "PC", opts: { viewport: { width: 1280, height: 800 } } },
  { name: "Telefono", opts: { ...devices["iPhone 13"] } },
];

const OLD_STATE = async (page) => {
  // Eseguito sulla pagina del sito prima del controllo: ricrea cio' che aveva
  // un visitatore di prima del 15/10 (preset filtri, cache cv-*, sw.js).
  await page.evaluate(async () => {
    try {
      localStorage.setItem("carta-viva:filter-preset:v1:home", JSON.stringify({ q: "", lang: "it" }));
      localStorage.setItem("carta-viva:filter-preset:v1:movers", JSON.stringify({ period: "7d" }));
      localStorage.setItem("cv-old-key", "1");
    } catch {}
    try {
      const c = await caches.open("cv-images-v1");
      await c.put("/old-entry", new Response("x"));
    } catch {}
    try {
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    } catch {}
  });
  await page.waitForTimeout(2500); // il vecchio sw.js si ripulisce da solo
};

// Solo le immagini davvero disegnate: quelle in contenitori nascosti
// (display:none, varianti per un'altra larghezza) o fuori schermo in un
// carosello orizzontale con loading=lazy non partono mai.
const SHOWN_SRC = "const shown = (i) => { const r = i.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth; };";

async function measure(page, url) {
  const imgResponses = [];
  const imgFailures = [];
  const onResponse = (r) => {
    if (r.request().resourceType() === "image") imgResponses.push({ url: r.url(), status: r.status() });
  };
  const onFailed = (r) => {
    if (r.resourceType() === "image") imgFailures.push({ url: r.url(), error: r.failure()?.errorText });
  };
  page.on("response", onResponse);
  page.on("requestfailed", onFailed);
  const t0 = Date.now();
  await page.addInitScript(SHOWN_SRC.replace("const shown", "window.__shown")); // definita ad ogni navigazione
  await page.goto(url, { waitUntil: "load", timeout: 30_000 });
  const loadS = (Date.now() - t0) / 1000;
  // scorre la pagina per far partire il caricamento pigro delle immagini
  await page.evaluate(async () => {
    const step = Math.max(300, innerHeight * 0.8);
    for (let y = 0; y < document.body.scrollHeight && y < 12000; y += step) {
      scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    scrollTo(0, 0);
  });
  // attende che ogni <img> abbia finito (ok o errore), con tetto
  const settled = await page
    .waitForFunction(() => [...document.images].filter(window.__shown).every((i) => i.complete), null, { timeout: IMAGES_MAX_S * 1000 })
    .then(() => true, () => false);
  const imagesS = (Date.now() - t0) / 1000;
  const imgs = await page.evaluate(() =>
    [...document.images]
      .filter(window.__shown)
      .filter((i) => (i.currentSrc || i.src) && !i.src.startsWith("data:"))
      .map((i) => ({ src: i.currentSrc || i.src, ok: i.complete && i.naturalWidth > 0 }))
  );
  const swCount = await page.evaluate(async () => (await navigator.serviceWorker?.getRegistrations?.())?.length ?? 0);
  page.off("response", onResponse);
  page.off("requestfailed", onFailed);
  const brokenDom = imgs.filter((i) => !i.ok);
  const badHttp = imgResponses.filter((r) => r.status >= 400);
  const reqTotal = imgResponses.length + imgFailures.length;
  return { total: imgs.length, reqTotal, brokenDom, badHttp, imgFailures, loadS, imagesS, settled, swCount };
}

function judge(page, r) {
  const problems = [];
  const broken = r.brokenDom.length;
  if (r.total < page.minImages) problems.push(`solo ${r.total} immagini (minimo ${page.minImages})`);
  if (r.total > 0 && broken / r.total > BROKEN_MAX_RATIO)
    problems.push(`${broken}/${r.total} immagini rotte (${((100 * broken) / r.total).toFixed(0)}%, soglia ${BROKEN_MAX_RATIO * 100}%)`);
  // Il sito sostituisce con un segnaposto le immagini che falliscono (fallback):
  // il DOM sembra a posto, quindi si contano anche le richieste immagine fallite.
  const failedReq = r.badHttp.length + r.imgFailures.length;
  if (r.reqTotal > 0 && failedReq / r.reqTotal > BROKEN_MAX_RATIO)
    problems.push(`${failedReq}/${r.reqTotal} richieste immagine fallite (soglia ${BROKEN_MAX_RATIO * 100}%)`);
  if (r.swCount > 0) problems.push(`${r.swCount} service worker ancora registrato`);
  if (r.loadS > LOAD_MAX_S) problems.push(`pagina lenta: ${r.loadS.toFixed(1)} s (soglia ${LOAD_MAX_S} s)`);
  if (!r.settled || r.imagesS > IMAGES_MAX_S) problems.push(`immagini lente: ${r.imagesS.toFixed(1)} s (soglia ${IMAGES_MAX_S} s)`);
  return problems;
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const rows = [];
let failed = 0;
for (const prof of PROFILES) {
  for (const mode of ["pulito", "stato vecchio"]) {
    // sw "allow" cosi' un eventuale service worker nuovo verrebbe visto
    const ctx = await browser.newContext({ ...prof.opts, serviceWorkers: "allow" });
    if (process.env.SIMULATE_BROKEN === "1") {
      // Prova del controllo: fa fallire in locale ~1 immagine su 3 (solo nel
      // browser di prova, il sito non viene toccato).
      let n = 0;
      await ctx.route(/\.(jpe?g|png|webp)(\?|$)|\/_next\/image/, (route) =>
        route.request().resourceType() === "image" && n++ % 3 === 0 ? route.abort() : route.continue()
      );
    }
    const page = await ctx.newPage();
    if (mode === "stato vecchio") {
      await page.goto(BASE + "/", { waitUntil: "load" });
      await OLD_STATE(page);
      await page.goto(BASE + "/", { waitUntil: "load" }); // seconda visita: cache calda
    }
    for (const pg of PAGES) {
      let r, problems;
      try {
        r = await measure(page, BASE + pg.path);
        problems = judge(pg, r);
      } catch (e) {
        r = { total: 0, reqTotal: 0, brokenDom: [], badHttp: [], imgFailures: [], loadS: 0, imagesS: 0, settled: false, swCount: 0 };
        problems = [`errore: ${e.message.split("\n")[0]}`];
      }
      if (problems.length) {
        // un solo secondo tentativo (avvio a freddo, rete), come site_check.py
        try {
          r = await measure(page, BASE + pg.path);
          problems = judge(pg, r);
        } catch (e) {
          problems = [`errore: ${e.message.split("\n")[0]}`];
        }
      }
      failed += problems.length ? 1 : 0;
      rows.push({ prof: prof.name, mode, pg, r, problems });
      console.log(
        `${problems.length ? "FAIL" : "OK  "} ${prof.name.padEnd(8)} ${mode.padEnd(13)} ${pg.path.padEnd(14)} img ${r.total} rotte ${r.brokenDom.length} richieste ${r.reqTotal} fallite ${r.badHttp.length + r.imgFailures.length} load ${r.loadS.toFixed(1)}s img ${r.imagesS.toFixed(1)}s ${problems.join("; ")}`
      );
      for (const b of r.brokenDom.slice(0, 5)) console.log(`     rotta: ${b.src}`);
    }
    await ctx.close();
  }
}
await browser.close();

const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary) {
  let md = `### Immagini e tempi in produzione ${BASE}\n\n| Profilo | Stato | Pagina | Immagini | Rotte | Richieste fallite | Pagina pronta | Immagini pronte | Esito |\n|---|---|---|---|---|---|---|---|---|\n`;
  for (const { prof, mode, pg, r, problems } of rows)
    md += `| ${prof} | ${mode} | ${pg.name} | ${r.total} | ${r.brokenDom.length} | ${r.badHttp.length + r.imgFailures.length}/${r.reqTotal} | ${r.loadS.toFixed(1)} s | ${r.imagesS.toFixed(1)} s | ${problems.length ? "ERRORE: " + problems.join("; ") : "OK"} |\n`;
  fs.appendFileSync(summary, md);
}
if (process.env.FAIL_REPORT) {
  const lines = rows.filter((x) => x.problems.length).map((x) => `${x.prof} (${x.mode}) ${x.pg.path}: ${x.problems.join("; ")}`);
  fs.writeFileSync(process.env.FAIL_REPORT, lines.join("\n"));
}
if (failed) {
  console.log(`::error::${failed} controlli immagini su ${rows.length} falliti su ${BASE}`);
  process.exit(1);
}
console.log(`Tutti i ${rows.length} controlli immagini sono ok`);

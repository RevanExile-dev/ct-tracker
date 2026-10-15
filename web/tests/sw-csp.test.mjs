// Il service worker legge le immagini di CardTrader con fetch(): per la CSP
// quella richiesta e' governata da connect-src, non solo da img-src. Se un host
// di IMAGE_HOSTS (public/sw.js) non e' in connect-src, ogni immagine passata dal
// worker fallisce e le tile mostrano "immagine non disponibile" (successo reale
// in produzione il 15/10/2026, dopo la PR #211).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);

async function productionCsp() {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const config = require("../next.config.js");
    const [{ headers }] = await config.headers();
    return headers.find((h) => h.key === "Content-Security-Policy").value;
  } finally {
    process.env.NODE_ENV = previous;
  }
}

function directive(csp, name) {
  const part = csp.split(";").map((s) => s.trim()).find((s) => s.startsWith(`${name} `));
  assert.ok(part, `direttiva ${name} mancante`);
  return part.split(/\s+/).slice(1);
}

// Come il browser: una sorgente "https://*.host" copre i sottodomini, non l'apex.
function allows(sources, origin) {
  const { hostname } = new URL(origin);
  return sources.some((src) => {
    const host = src.replace(/^https:\/\//, "");
    return host.startsWith("*.") ? hostname.endsWith(host.slice(1)) : hostname === host;
  });
}

test("gli host immagine del service worker sono in connect-src oltre che in img-src", async () => {
  const csp = await productionCsp();
  const sw = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.ok(/IMAGE_HOSTS/.test(sw), "IMAGE_HOSTS non trovato in sw.js");
  // Host realmente richiesti dalle tile: apex (redirect 301), www e CloudFront.
  const origins = ["https://cardtrader.com", "https://www.cardtrader.com", "https://d2rq8wty021h6h.cloudfront.net"];
  const connect = directive(csp, "connect-src");
  const img = directive(csp, "img-src");
  for (const origin of origins) {
    assert.ok(allows(img, origin), `${origin} non in img-src`);
    assert.ok(allows(connect, origin), `${origin} non in connect-src: il service worker non puo' caricare le immagini`);
  }
});

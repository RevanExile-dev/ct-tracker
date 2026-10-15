/* Service worker di CartaViva: serve a far aprire le pagine gia' viste
 * (binder, desideri, ecc.) anche senza rete o con rete lenta.
 *
 * Regole pensate per non aumentare il consumo di Vercel/Neon:
 *  - non fa mai richieste in piu' di quelle che farebbe il browser: prima
 *    prova la rete; la copia salvata serve solo se la rete fallisce o e' lenta;
 *  - non salva nulla di personale (account, login, POST, allarmi, Telegram).
 *
 * Prezzi: quando una risposta dei dati viene servita dalla copia salvata il
 * worker avvisa la pagina (messaggio "stale" con la data), che mostra
 * l'avviso "prezzi salvati il ...". Cosi' non si vedono prezzi vecchi senza
 * saperlo. */
const VERSION = "v1";
const PAGES = `cv-pages-${VERSION}`;
const STATIC = `cv-static-${VERSION}`;
const DATA = `cv-data-${VERSION}`;
const IMAGES = `cv-images-${VERSION}`;
const KEEP = [PAGES, STATIC, DATA, IMAGES];

// Oltre questa attesa si passa alla copia salvata (rete lenta).
const SLOW_MS = 4000;
const MAX_IMAGES = 400;
const MAX_DATA = 150;

// Pagine apribili offline (solo le non personali lato server: binder e
// desideri leggono i dati dal telefono, non dal server).
const PAGE_PATHS = new Set(["/", "/binder", "/binder-book", "/wishlist", "/lots", "/movers", "/scan"]);
const IMAGE_HOSTS = [/(^|\.)cardtrader\.com$/, /^d2rq8wty021h6h\.cloudfront\.net$/];

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith("cv-") && !KEEP.includes(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function notifyStale(cachedResponse) {
  const clients = await self.clients.matchAll({ type: "window" });
  const date = cachedResponse.headers.get("sw-cached-at") || cachedResponse.headers.get("date");
  for (const c of clients) c.postMessage({ type: "stale-data", date });
}

/** Rete per prima; copia salvata se la rete fallisce o supera SLOW_MS. */
function networkFirst(event, cacheName, { staleNotice = false, max = 0 } = {}) {
  const req = event.request;
  return (async () => {
    const cache = await caches.open(cacheName);
    const network = fetch(req).then(async (res) => {
      if (res && res.ok && res.type !== "opaque") {
        // Salva anche la data, per dire "prezzi del ..." se serviranno dopo.
        const headers = new Headers(res.headers);
        headers.set("sw-cached-at", new Date().toISOString());
        const body = await res.clone().blob();
        cache.put(req, new Response(body, { status: res.status, statusText: res.statusText, headers }));
        if (max) event.waitUntil(trim(cacheName, max));
      }
      return res;
    });
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), SLOW_MS));
    try {
      const first = await Promise.race([network, timeout]);
      if (first) return first;
      // Rete lenta: se c'e' una copia la si usa, altrimenti si aspetta la rete.
      const cached = await cache.match(req);
      if (cached) {
        if (staleNotice) event.waitUntil(notifyStale(cached));
        return cached;
      }
      return await network;
    } catch (err) {
      const cached = await cache.match(req);
      if (cached) {
        if (staleNotice) event.waitUntil(notifyStale(cached));
        return cached;
      }
      throw err;
    }
  })();
}

function cacheFirst(event, cacheName, max = 0) {
  const req = event.request;
  return caches.open(cacheName).then(async (cache) => {
    const hit = await cache.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res && (res.ok || res.type === "opaque")) {
      cache.put(req, res.clone());
      if (max) event.waitUntil(trim(cacheName, max));
    }
    return res;
  });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Immagini delle carte (host esterni): prima la copia salvata, nessuna
  // richiesta ripetuta ai server di CardTrader.
  if (req.destination === "image" && IMAGE_HOSTS.some((re) => re.test(url.hostname))) {
    event.respondWith(cacheFirst(event, IMAGES, MAX_IMAGES));
    return;
  }

  if (url.origin !== self.location.origin) return;

  // File dell'app con nome a impronta (immutabili) e icone.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(event, STATIC));
    return;
  }

  // Dati pubblici di catalogo e prezzi (mai account, login, telegram, allarmi).
  if (/^\/api\/(cards|movers|expansions|meta|scanner-catalog)(\/|$)/.test(url.pathname)) {
    event.respondWith(networkFirst(event, DATA, { staleNotice: true, max: MAX_DATA }));
    return;
  }

  // Pagine: solo l'elenco permesso e le schede carta.
  if (req.mode === "navigate" && (PAGE_PATHS.has(url.pathname) || /^\/card\/\d+$/.test(url.pathname))) {
    event.respondWith(
      networkFirst(event, PAGES, { max: 60 }).catch(
        () =>
          new Response(
            '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CartaViva</title><body style="font-family:sans-serif;background:#0d0f12;color:#e8eaed;padding:2rem"><h1>Sei offline</h1><p>Questa pagina non è ancora salvata sul telefono. Riprova quando torna la connessione.</p>',
            { status: 503, headers: { "content-type": "text/html; charset=utf-8" } }
          )
      )
    );
  }
});

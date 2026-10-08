// CSP solo in produzione: in sviluppo Turbopack/Fast Refresh usano eval e
// websocket per l'HMR, che uno script-src 'self' rigido bloccherebbe -
// verificato che qui non c'e' alcun bisogno reale di CSP durante `next dev`
// (nessun utente reale coinvolto), quindi tanto vale non complicarla con
// eccezioni dev-only che andrebbero comunque escluse dal build di prod.
const contentSecurityPolicy = [
  "default-src 'self'",
  // 'unsafe-inline': Next.js inietta script inline essenziali per
  // l'idratazione React e lo streaming dei Server Components
  // (`self.__next_f.push(...)`) - senza, un script-src 'self' rigido li
  // bloccherebbe e l'app apparirebbe rotta/non interattiva in produzione
  // (verificato: e' la stessa forma dell'esempio ufficiale "Without
  // Nonces" nei doc Next.js installati). Un nonce per-richiesta
  // eliminerebbe 'unsafe-inline' ma richiede rendering dinamico ovunque
  // (niente pagine statiche/ISR) - sproporzionato per l'hardening
  // richiesto qui.
  // Scanner /scan: il motore OCR (tesseract.js) viene caricato da jsdelivr,
  // insieme al worker, al core WASM e ai dati lingua. 'wasm-unsafe-eval'
  // serve solo a compilare il WASM, non abilita eval() JavaScript.
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net",
  "worker-src 'self' blob:",
  // 'unsafe-inline' per style-src: alcuni componenti usano style={{...}}
  // inline (valori dinamici, es. percentuali/colori calcolati) - CSP tratta
  // l'attributo style come style-src alla pari di un tag <style>. Rischio
  // di XSS via style e' comunque molto piu' basso che via script.
  "style-src 'self' 'unsafe-inline'",
  // Immagini: CardTrader (catalogo), CloudFront (CDN CardTrader) e gli
  // avatar Google mostrati nel menu account dopo il login - stessi host
  // gia' whitelisted in images.remotePatterns qui sotto.
  "img-src 'self' data: https://cardtrader.com https://*.cardtrader.com https://d2rq8wty021h6h.cloudfront.net https://*.googleusercontent.com",
  "font-src 'self' data:",
  "connect-src 'self' https://cdn.jsdelivr.net",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Sovrappone X-Frame-Options: alcuni browser piu' vecchi non leggono
  // ancora frame-ancestors dalla CSP.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Lo scanner (/scan) usa la fotocamera dal vivo (getUserMedia): va
  // consentita alla sola origine del sito (`self`), mai a iframe di terzi.
  // Con `camera=()` il browser rifiutava la fotocamera anche dopo il
  // permesso dell'utente (verificato con Chromium: NotAllowedError).
  // Le altre API non sono usate dal sito: le si nega esplicitamente.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), browsing-topics=()" },
  // 2 anni, sottodomini inclusi - il sito e' servito solo su Vercel via
  // HTTPS, non c'e' un caso d'uso HTTP da preservare.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Content-Security-Policy", value: contentSecurityPolicy }]
    : []),
];

// Cache della CDN di Vercel sulle API pubbliche di sola lettura: le risposte
// non dipendono dall'utente (nessun cookie/sessione) e cambiano solo quando
// gira un sync, quindi una copia di pochi minuti evita di rieseguire la
// funzione e la query su Neon per ogni visita identica. La CDN risponde anche
// prima del proxy, quindi queste richieste non consumano nemmeno il limite di
// richieste. Mai su /api/account, /api/auth, /api/telegram e su
// /api/cards/language-prices (POST con gli id delle carte dell'utente).
const publicApiCache = (sMaxAge, swr) => [
  { key: "Cache-Control", value: `public, max-age=0, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}` },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Gli elenchi (espansioni, rarita', lingue, condizioni, artisti,
      // statistiche, meta) mandano gia' il proprio Cache-Control da
      // lib/apiCache.ts: qui restano le rotte che non lo facevano.
      { source: "/api/scanner-catalog", headers: publicApiCache(600, 3600) },
      // Prezzi: si aggiornano a ogni sync prioritario, 2 minuti bastano a
      // togliere i picchi senza rendere i prezzi visibilmente vecchi.
      {
        source: "/api/:name(cards|movers)",
        headers: publicApiCache(120, 600),
      },
      { source: "/api/cards/:name(count|summary|trend)", headers: publicApiCache(120, 600) },
      { source: "/api/cards/:id(\\d+)", headers: publicApiCache(120, 600) },
    ];
  },
  images: {
    // Il piano gratuito Vercel concede solo 5.000 Image Optimization
    // Transformations al mese: con ~29.315 carte nel catalogo, ogni
    // combinazione carta+larghezza responsive vista per la prima volta ne
    // consuma una - il tetto si esaurisce in fretta anche con poco
    // traffico (successo reale: "Exceeded free resources" su
    // Transformations, 5K/5K). Le immagini arrivano gia' pronte da
    // CardTrader; disattivare l'ottimizzazione le serve cosi' come sono
    // (nessuna conversione webp/avif ne' resize lato Vercel) invece di
    // continuare a esaurire quel tetto. Con URL esterni e unoptimized,
    // il browser scarica direttamente da CardTrader: le immagini non
    // transitano dall'Image Optimizer ne' dal traffico dati di Vercel.
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cardtrader.com",
      },
      {
        protocol: "https",
        hostname: "**.cardtrader.com",
      },
      {
        protocol: "https",
        hostname: "d2rq8wty021h6h.cloudfront.net",
      },
      {
        // Foto profilo Google mostrata nel menu account dopo il login.
        // Wildcard (non solo lh3): Google distribuisce gli avatar anche da
        // altri sottodomini (lh4/lh5/lh6...), stesso pattern gia' usato
        // sopra per i sottodomini di cardtrader.com.
        protocol: "https",
        hostname: "**.googleusercontent.com",
      },
    ],
  },
};

module.exports = nextConfig;

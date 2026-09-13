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
  "script-src 'self' 'unsafe-inline'",
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
  "connect-src 'self'",
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
  // Nessuna di queste API e' usata dal sito: le si nega esplicitamente.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  // 2 anni, sottodomini inclusi - il sito e' servito solo su Vercel via
  // HTTPS, non c'e' un caso d'uso HTTP da preservare.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Content-Security-Policy", value: contentSecurityPolicy }]
    : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
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

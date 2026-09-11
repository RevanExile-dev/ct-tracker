/** @type {import('next').NextConfig} */
const nextConfig = {
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

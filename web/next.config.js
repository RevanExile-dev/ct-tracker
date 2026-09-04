/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
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
  webpack: (config) => {
    // sql.js carica un file .wasm a runtime: lo trattiamo come asset statico
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false, crypto: false };
    // Lo showcase /cosmos usa shader WGSL come moduli. Il loader risolve e
    // minimizza lo shader a build-time; l'esecuzione resta confinata alla
    // route sperimentale, quindi il percorso principale non scarica vgpu.
    config.module.rules.push({
      test: /\.wgsl$/,
      loader: "@vgpu/wgsl/loader-webpack",
      options: { minify: process.env.NODE_ENV === "production" },
    });
    return config;
  },
};

module.exports = nextConfig;

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
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
  webpack: (config) => {
    // sql.js carica un file .wasm a runtime: lo trattiamo come asset statico
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false, crypto: false };
    return config;
  },
};

module.exports = nextConfig;

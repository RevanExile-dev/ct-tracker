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
};

module.exports = nextConfig;

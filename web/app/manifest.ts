import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CartaViva",
    short_name: "CartaViva",
    description: "Tracker e Binder personale per carte collezionabili.",
    id: "/",
    start_url: "/",
    scope: "/",
    lang: "it",
    display: "standalone",
    orientation: "any",
    background_color: "#0d0f12",
    theme_color: "#0d0f12",
    // PNG veri: Chrome/Android li richiedono (192 e 512) per proporre
    // l'installazione, iOS ignora le icone SVG. La "maskable" ha il disegno
    // nella zona sicura centrale, cosi' il telefono puo' ritagliarla tonda.
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    shortcuts: [
      { name: "Binder", url: "/binder" },
      { name: "Desideri", url: "/wishlist" },
      { name: "Scanner", url: "/scan" },
    ],
  };
}

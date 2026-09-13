import type { MetadataRoute } from "next";

// Deterrente di cortesia, non una vera protezione: robots.txt è solo una
// convenzione che i crawler "onesti" (Google, Bing...) rispettano - uno
// scraper scritto apposta per copiare il catalogo lo ignora comunque.
// La vera prima linea di difesa contro lo scraping massivo resta il rate
// limiting in web/proxy.ts.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // /api/*: dati grezzi, nessun valore a farli indicizzare. /account/*
      // e /login: pagine funzionali senza contenuto pubblico da mostrare
      // nei risultati di ricerca.
      disallow: ["/api/", "/account/", "/login"],
      // Rallenta i bot che rispettano la direttiva (non tutti la
      // supportano) - un secondo tra una richiesta e l'altra non incide
      // sull'esperienza di un utente reale, che naviga tramite browser e
      // non tramite questo file.
      crawlDelay: 1,
    },
  };
}

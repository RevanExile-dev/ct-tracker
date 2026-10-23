/**
 * Immagini carta CardTrader: l'URL salvato nel catalogo punta a
 * `cardtrader.com`, che risponde con un 301 verso `www.cardtrader.com` (un
 * giro di rete in piu' per ogni immagine), e serve sempre il file intero
 * (734x1024, ~150 KB). Esiste anche la variante `preview_` (180x251, ~13 KB):
 * nella home bastano ~5 MB di JPG a 70 miniature.
 */
const CT_HOST = /^https:\/\/(?:www\.)?cardtrader\.com\//;
const BLUEPRINT_FILE = /^https:\/\/www\.cardtrader\.com\/uploads\/blueprints\/image\/(\d+\/[\w.()%+-]+\.(?:jpe?g|png|webp))$/i;

// Cambia quando cambia la qualita' delle miniature: la risposta di /api/img e'
// immutabile (un anno) e i browser terrebbero per sempre la versione vecchia
// dello stesso URL.
const IMG_VERSION = 2;

function withFilePrefix(url: string, prefix: string): string {
  const slash = url.lastIndexOf("/");
  return `${url.slice(0, slash + 1)}${prefix}${url.slice(slash + 1)}`;
}

export type CardImageSources = { src: string; srcSet?: string };

/** Sorgenti per una miniatura: `src` completo (senza redirect) e, per le sole
 * immagini CardTrader, `srcSet` con la variante leggera per schermi 1x. Altri
 * host passano invariati. */
export function cardImageSources(url: string): CardImageSources {
  if (!CT_HOST.test(url)) return { src: url };
  const full = url.replace(/^https:\/\/cardtrader\.com\//, "https://www.cardtrader.com/");
  const preview = `${withFilePrefix(full, "preview_")} 180w`;
  const blueprint = BLUEPRINT_FILE.exec(full)?.[1];
  // Per gli schermi 2x/3x una variante a misura (360/540 px) al posto
  // dell'intera in JPG; l'originale resta per le tile che ne chiedono di piu'.
  const sized = blueprint
    ? [...[360, 540].map((w) => `/api/img?p=${encodeURIComponent(blueprint)}&w=${w}&v=${IMG_VERSION} ${w}w`), `${full} 734w`]
    : [`${full} 734w`];
  return { src: full, srcSet: [preview, ...sized].join(", ") };
}

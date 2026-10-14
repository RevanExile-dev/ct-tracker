/**
 * Immagini carta CardTrader: l'URL salvato nel catalogo punta a
 * `cardtrader.com`, che risponde con un 301 verso `www.cardtrader.com` (un
 * giro di rete in piu' per ogni immagine), e serve sempre il file intero
 * (734x1024, ~150 KB). Esiste anche la variante `preview_` (180x251, ~13 KB):
 * nella home bastano ~5 MB di JPG a 70 miniature.
 */
const CT_HOST = /^https:\/\/(?:www\.)?cardtrader\.com\//;

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
  return { src: full, srcSet: `${withFilePrefix(full, "preview_")} 180w, ${full} 734w` };
}

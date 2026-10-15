import { preload } from "react-dom";
import { fetchCards } from "@/lib/db.server";
import { cardImageSources } from "@/lib/cardImage";
import { HIGHLIGHT_ROWS, type InitialHighlights } from "@/lib/homeHighlights";
import HomeClient from "./HomeClient";

// Pagina statica rigenerata ogni minuto (stessa freschezza della cache CDN
// delle API prezzi): le righe in evidenza arrivano gia' nei dati della pagina
// e la prima immagine parte in preload dall'HTML, invece di aspettare JS +
// idratazione + tre chiamate API (misurato: immagini a ~3,5 s su rete lenta).
export const revalidate = 60;

async function readHighlights(): Promise<InitialHighlights | undefined> {
  try {
    const rows = await Promise.all(HIGHLIGHT_ROWS.map((def) => fetchCards(def.opts)));
    return Object.fromEntries(HIGHLIGHT_ROWS.map((def, i) => [def.key, rows[i]]));
  } catch {
    // DB irraggiungibile (o build senza database): il client ripiega sulle API.
    return undefined;
  }
}

export default async function Home() {
  const initial = await readHighlights();
  // Le prime tile della prima riga non vuota: stesse sorgenti e `sizes` della tile
  // (CardTile, riga a scorrimento) cosi' il browser riusa l'immagine gia' scaricata.
  const firstRow = HIGHLIGHT_ROWS.map((def) => initial?.[def.key]).find((cards) => cards && cards.length > 0);
  for (const card of firstRow?.slice(0, 3) ?? []) {
    if (!card.image_url) continue;
    const { src, srcSet } = cardImageSources(card.image_url);
    preload(src, { as: "image", imageSrcSet: srcSet, imageSizes: "174px", fetchPriority: "high" });
  }
  return <HomeClient initialHighlights={initial} />;
}

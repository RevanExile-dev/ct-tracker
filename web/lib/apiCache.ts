import { NextResponse } from "next/server";

/** Risposta JSON per elenchi che cambiano raramente (rarita', lingue,
 * condizioni, espansioni, artisti, statistiche): la CDN di Vercel la serve
 * dalla cache invece di interrogare Postgres ad ogni visita (la home ne
 * chiede 7 per ogni apertura). `max-age` breve per il browser,
 * `s-maxage` per la CDN, `stale-while-revalidate` per non far mai
 * aspettare nessuno mentre si rinnova. */
export function cachedJson(data: unknown, opts: { maxAge?: number; sMaxAge: number; staleWhileRevalidate: number }) {
  const { maxAge = 60, sMaxAge, staleWhileRevalidate } = opts;
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": `public, max-age=${maxAge}, s-maxage=${sMaxAge}, stale-while-revalidate=${staleWhileRevalidate}`,
    },
  });
}

/** Elenchi che cambiano solo con un sync del catalogo (al piu' giornaliero). */
export const LISTS_CACHE = { sMaxAge: 3600, staleWhileRevalidate: 86400 } as const;
/** Valori aggiornati dai sync dei prezzi (ogni 15 minuti): cache corta. */
export const STATS_CACHE = { sMaxAge: 300, staleWhileRevalidate: 3600 } as const;
/** Prezzi e offerte: i sync girano ogni ~15 minuti, quindi una risposta uguale
 * per tutti puo' stare in CDN 60 s (piu' 120 s servita mentre si rinnova:
 * al massimo ~3 minuti di ritardo). La stessa query ripetuta da piu' utenti
 * (la home di default) non sveglia piu' il database. */
export const PRICES_CACHE = { maxAge: 30, sMaxAge: 60, staleWhileRevalidate: 120 } as const;

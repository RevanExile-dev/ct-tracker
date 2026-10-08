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

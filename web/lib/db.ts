"use client";

// Client per le API routes di CartaViva (web/app/api/**), che interrogano
// il Postgres condiviso con login/profili (vedi web/lib/db.server.ts).
// Fino a questa migrazione queste stesse funzioni giravano interamente nel
// browser via sql.js su due file .db scaricati interi (catalogo/prezzi
// scritti da un sync che poi faceva commit+push degli 85MB su main,
// causa del limite di Deployment Storage Vercel raggiunto - vedi
// CLAUDE.md). Le firme pubbliche restano IDENTICHE apposta: i componenti
// che le chiamano (app/page.tsx, app/movers, app/card/[id], Toolbar,
// CardTile, ...) non cambiano, solo l'implementazione qui dentro.

export type {
  CardRow, SortOption, CardsFilterOpts, CardsSummary, MoversDirection,
  MoversSort, MoversPageOpts, MoversPageResult, CardDetail, PricePoint,
  Listing, ExpansionInfo,
} from "./types";
export { MOVERS_PAGE_SIZE } from "./types";
export { normalizeRarity } from "./rarity";

import type {
  CardRow, CardsFilterOpts, CardsSummary, MoversPageOpts, MoversPageResult,
  CardDetail, PricePoint, Listing, ExpansionInfo, SortOption,
} from "./types";

async function apiFetch<T>(path: string, params?: Record<string, unknown>): Promise<T> {
  const qs = new URLSearchParams();
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const v of value) qs.append(key, String(v));
      } else if (typeof value === "boolean") {
        if (value) qs.set(key, "1");
      } else {
        qs.set(key, String(value));
      }
    }
  }
  const url = qs.toString() ? `${path}?${qs}` : path;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Richiesta a ${url} fallita (${res.status})`);
  }
  return res.json() as Promise<T>;
}

function cardsFilterParams(opts: CardsFilterOpts): Record<string, unknown> {
  return {
    search: opts.search,
    expansionCode: opts.expansionCode,
    rarities: opts.rarities,
    languages: opts.languages,
    conditions: opts.conditions,
    onlyZero: opts.onlyZero,
    ids: opts.ids,
    // Un array ids vuoto non appende nessun parametro "ids" alla query
    // string (il loop su Array.isArray in apiFetch non ha nulla da
    // iterare): senza questo flag esplicito, un binder/wishlist vuoto
    // arriverebbe al server indistinguibile da "nessun filtro ids" e
    // restituirebbe l'intero catalogo invece di un elenco vuoto (bug
    // reale, trovato in verifica confrontando /api/cards?ids= con
    // /api/cards senza parametri).
    idsProvided: opts.ids !== undefined ? "1" : undefined,
  };
}

/** Elenco carte con l'ultimo prezzo noto e quello precedente (per la freccina su/giù). */
export async function fetchCards(opts: CardsFilterOpts & {
  sortBy?: SortOption;
  limit?: number;
}): Promise<CardRow[]> {
  return apiFetch<CardRow[]>("/api/cards", {
    ...cardsFilterParams(opts),
    sortBy: opts.sortBy,
    limit: opts.limit,
  });
}

/** Conteggio delle carte che soddisfano gli stessi filtri di fetchCards. */
export async function fetchCardsCount(opts: CardsFilterOpts): Promise<number> {
  const { count } = await apiFetch<{ count: number }>("/api/cards/count", cardsFilterParams(opts));
  return count;
}

/** Media delle variazioni giorno-su-giorno delle carte che soddisfano i filtri correnti. */
export async function fetchCardsSummary(opts: CardsFilterOpts): Promise<CardsSummary | null> {
  return apiFetch<CardsSummary | null>("/api/cards/summary", cardsFilterParams(opts));
}

export async function fetchMoversPage(opts: MoversPageOpts): Promise<MoversPageResult> {
  return apiFetch<MoversPageResult>("/api/movers", {
    direction: opts.direction,
    rarities: opts.rarities,
    minCents: opts.minCents,
    maxCents: opts.maxCents,
    sort: opts.sort,
    page: opts.page,
  });
}

export async function fetchCardDetail(id: number): Promise<CardDetail | null> {
  return apiFetch<CardDetail | null>(`/api/cards/${id}`);
}

/** Storico completo di una carta (per il grafico). */
export async function fetchPriceHistory(blueprintId: number): Promise<PricePoint[]> {
  return apiFetch<PricePoint[]>(`/api/cards/${blueprintId}/history`);
}

/** Le migliori (piu' economiche) inserzioni live per una carta. */
export async function fetchBestListings(blueprintId: number): Promise<Listing[]> {
  return apiFetch<Listing[]>(`/api/cards/${blueprintId}/listings`);
}

/** Media mobile degli ultimi `days` giorni per piu' carte in una sola
 * richiesta (es. tutte le carte del Binder) - vedi fetchCardsTrend lato
 * server, evita una fetchPriceHistory per carta (N+1) solo per calcolare
 * un confronto "vs media Ngg" su una lista. */
export async function fetchCardsTrend(
  blueprintIds: number[],
  days = 30
): Promise<Record<number, { avgCents: number; days: number }>> {
  if (blueprintIds.length === 0) return {};
  return apiFetch<Record<number, { avgCents: number; days: number }>>("/api/cards/trend", {
    ids: blueprintIds,
    days,
  });
}

export async function fetchExpansions(): Promise<ExpansionInfo[]> {
  return apiFetch<ExpansionInfo[]>("/api/expansions");
}

/** Statistiche generali del catalogo (carte tracciate, quante hanno un prezzo noto). */
export async function fetchCatalogStats(): Promise<{ totalCards: number; pricedCards: number }> {
  return apiFetch<{ totalCards: number; pricedCards: number }>("/api/catalog-stats");
}

/** Condizioni distinte tra le inserzioni salvate, ordinate dalla migliore alla peggiore. */
export async function fetchConditions(): Promise<string[]> {
  return apiFetch<string[]>("/api/conditions");
}

export async function fetchRarities(): Promise<string[]> {
  return apiFetch<string[]>("/api/rarities");
}

export async function fetchLanguages(): Promise<string[]> {
  return apiFetch<string[]>("/api/languages");
}

export async function fetchMeta(): Promise<Record<string, string>> {
  return apiFetch<Record<string, string>>("/api/meta");
}

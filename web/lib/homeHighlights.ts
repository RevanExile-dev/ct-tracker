import type { CardRow, SortOption } from "@/lib/types";

/** Le tre righe in evidenza della home: stesse query lato server (pagina) e
 * lato client (fallback), cosi' non possono divergere. `opts` e' l'argomento
 * di fetchCards. */
export const HIGHLIGHT_ROW_LIMIT = 10;
export type HighlightRowKey = "trending" | "it-premium" | "new-premium";
type RowOpts = { sortBy: SortOption; limit: number; onlyPremium?: boolean; languages?: string[] };
export const HIGHLIGHT_ROWS: { key: HighlightRowKey; opts: RowOpts }[] = [
  { key: "trending", opts: { sortBy: "rise_first", limit: HIGHLIGHT_ROW_LIMIT } },
  { key: "it-premium", opts: { onlyPremium: true, languages: ["it"], sortBy: "price_desc", limit: HIGHLIGHT_ROW_LIMIT } },
  { key: "new-premium", opts: { onlyPremium: true, sortBy: "expansion", limit: HIGHLIGHT_ROW_LIMIT } },
];

/** Carte delle righe gia' lette dal server (assente = il client le chiede). */
export type InitialHighlights = Partial<Record<HighlightRowKey, CardRow[]>>;

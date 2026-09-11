import type { BinderValuePoint } from "./types";

/** Presentation only: never invent points or reconstruct past holdings. */
export function normalizeCollectionHistory(points: BinderValuePoint[]): BinderValuePoint[] {
  const byDate = new Map<string, BinderValuePoint>();
  for (const point of points) {
    if (!point || typeof point.captured_at !== "string") continue;
    const timestamp = Date.parse(point.captured_at);
    if (!Number.isFinite(timestamp) || !Number.isFinite(point.total_cents)
      || point.total_cents < 0 || !Number.isFinite(point.cards_count)
      || !Number.isFinite(point.priced_count)) continue;
    // Se captured_at e' gia' una data pura (es. "2026-09-11" dalla colonna
    // Postgres DATE, vedi web/lib/account.server.ts), usarla cosi' com'e':
    // passare per Date/toISOString() la sposterebbe di un giorno per un
    // timestamp con offset orario positivo (rilievo review Gemini su PR
    // #52) - non riproducibile con i dati reali di oggi, ma un input futuro
    // con offset non deve poter rompere silenziosamente l'aggregazione per
    // giorno sotto. Fallback a toISOString() solo per formati non standard.
    const date = /^\d{4}-\d{2}-\d{2}/.test(point.captured_at)
      ? point.captured_at.slice(0, 10)
      : new Date(timestamp).toISOString().slice(0, 10);
    byDate.set(date, { ...point, captured_at: date });
  }
  return [...byDate.values()].sort((a, b) => a.captured_at.localeCompare(b.captured_at));
}

export function historyInRange(points: BinderValuePoint[], from: string, to: string): BinderValuePoint[] {
  return points.filter((point) => point.captured_at >= from && point.captured_at <= to);
}

export function collectionHistoryCsv(points: BinderValuePoint[]): string {
  const cell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
  return [
    "data,valore_stimato_centesimi,valuta,tipi_carta,tipi_con_prezzo",
    ...points.map((point) => [point.captured_at, point.total_cents,
      /^[A-Z]{3}$/.test(point.currency ?? "") ? point.currency : "",
      point.cards_count, point.priced_count].map((value) => cell(value ?? "")).join(",")),
  ].join("\r\n");
}

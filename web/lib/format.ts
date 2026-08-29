export function formatCents(cents: number | null | undefined, currency = "EUR"): string {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat("it-IT", { style: "currency", currency }).format(cents / 100);
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "short" }).format(
    new Date(iso)
  );
}

export function formatDateLong(iso: string): string {
  return new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "long", year: "numeric" }).format(
    new Date(iso)
  );
}

export function priceDeltaPct(latest: number | null, prev: number | null): number | null {
  if (!latest || !prev) return null;
  return ((latest - prev) / prev) * 100;
}

export type TrendVsAverage = { avgCents: number; deltaPct: number; days: number };

/**
 * Confronta il prezzo attuale con la media mobile degli ultimi `days` giorni
 * di storico gia' scaricato (niente richieste aggiuntive). Se lo storico
 * disponibile e' piu' corto di `days`, usa tutto quello che c'e'.
 */
export function trendVsMovingAverage(
  history: { captured_at: string; min_price_cents: number | null }[],
  currentCents: number | null,
  days = 30
): TrendVsAverage | null {
  if (currentCents === null || currentCents === undefined) return null;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const withPrice = history.filter((p) => p.min_price_cents !== null);
  const windowed = withPrice.filter((p) => new Date(p.captured_at) >= cutoff);
  const points = windowed.length > 0 ? windowed : withPrice;
  if (points.length === 0) return null;

  const avgCents =
    points.reduce((sum, p) => sum + (p.min_price_cents as number), 0) / points.length;
  if (avgCents === 0) return null;

  return {
    avgCents,
    deltaPct: ((currentCents - avgCents) / avgCents) * 100,
    days: windowed.length > 0 ? days : points.length,
  };
}

const LANGUAGE_FLAGS: Record<string, string> = {
  en: "🇬🇧",
  it: "🇮🇹",
  fr: "🇫🇷",
  de: "🇩🇪",
  es: "🇪🇸",
  pt: "🇵🇹",
  jp: "🇯🇵",
  kr: "🇰🇷",
  id: "🇮🇩",
  th: "🇹🇭",
  ru: "🇷🇺",
  nl: "🇳🇱",
  "zh-cn": "🇨🇳",
  "zh-tw": "🇹🇼",
};

const LANGUAGE_LABELS: Record<string, string> = {
  en: "EN", it: "IT", fr: "FR", de: "DE", es: "ES", pt: "PT",
  jp: "JP", kr: "KR", id: "ID", th: "TH", ru: "RU", nl: "NL",
  "zh-cn": "ZH", "zh-tw": "ZH",
};

export function languageFlag(code: string | null | undefined): string {
  if (!code) return "";
  return LANGUAGE_FLAGS[code.toLowerCase()] ?? "🏳️";
}

export function languageLabel(code: string): string {
  return LANGUAGE_LABELS[code.toLowerCase()] ?? code.toUpperCase();
}

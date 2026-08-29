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

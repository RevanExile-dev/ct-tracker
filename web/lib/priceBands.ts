// Fasce di prezzo del filtro "Prezzo" in home: una scelta sola, 1 tocco per
// aprire + 1 per scegliere. Chiave = valore nell'URL (?price=5-20).
export type PriceBand = { key: string; label: string; minCents?: number; maxCents?: number };

export const PRICE_BANDS: PriceBand[] = [
  { key: "0-1", label: "Fino a 1 €", maxCents: 100 },
  { key: "1-5", label: "1 – 5 €", minCents: 100, maxCents: 500 },
  { key: "5-20", label: "5 – 20 €", minCents: 500, maxCents: 2000 },
  { key: "20-100", label: "20 – 100 €", minCents: 2000, maxCents: 10000 },
  { key: "100-", label: "Oltre 100 €", minCents: 10000 },
];

export function priceBandByKey(key: string | null | undefined): PriceBand | undefined {
  return PRICE_BANDS.find((b) => b.key === key);
}

/** Estremi in centesimi per le query; vuoto se la chiave non esiste. */
export function priceBandRange(key: string | null | undefined): { minPriceCents?: number; maxPriceCents?: number } {
  const b = priceBandByKey(key);
  return b ? { minPriceCents: b.minCents, maxPriceCents: b.maxCents } : {};
}

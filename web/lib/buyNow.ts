// "Conviene comprare ora?" per la scheda carta. Solo calcoli sui dati che la
// pagina ha gia' (storico + migliori inserzioni): nessuna richiesta nuova.
// Nessun import: resta testabile da solo (tests/buy-now.test.mjs).

export type HistoryPoint = {
  captured_at: string;
  min_price_cents: number | null;
  best_price_cents?: number | null;
};

/** Sotto questo numero di rilevazioni nella finestra il "minimo" e' solo il
 * prezzo di ieri: meglio non dare un verdetto (stessa soglia del trend). */
export const MIN_VERDICT_POINTS = 3;

export type BuyVerdict = {
  tone: "good" | "near" | "wait";
  /** Minimo del periodo (stesso tipo di prezzo di `currentCents`). */
  minCents: number;
  /** Quanto il prezzo attuale e' sopra il minimo, in % (0 = e' il minimo). */
  abovePct: number;
  days: number;
  points: number;
};

/** Confronta il prezzo attuale con il MINIMO degli ultimi `days` giorni di
 * storico. Null se i punti nella finestra sono troppo pochi. Il valore di uno
 * snapshot e' best_price_cents con ripiego su min_price_cents, come per il
 * trend vs media. Un prezzo attuale sotto il minimo storico conta come minimo. */
export function buyVerdict(
  history: HistoryPoint[],
  currentCents: number | null,
  days = 30,
  now: Date = new Date(),
): BuyVerdict | null {
  if (currentCents === null || currentCents === undefined || currentCents <= 0) return null;
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  const values = history
    .filter((p) => new Date(p.captured_at) >= cutoff)
    .map((p) => p.best_price_cents ?? p.min_price_cents)
    .filter((v): v is number => v !== null && v > 0);
  if (values.length < MIN_VERDICT_POINTS) return null;
  const minCents = Math.min(...values, currentCents);
  const abovePct = ((currentCents - minCents) / minCents) * 100;
  const tone = abovePct <= 3 ? "good" : abovePct <= 15 ? "near" : "wait";
  return { tone, minCents, abovePct, days, points: values.length };
}

// Paesi UE (ISO 2): le inserzioni da fuori UE (USA, Regno Unito, ...) non
// entrano nel confronto "Italia/UE": dogana e tempi diversi.
const EU = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
  "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);
export function isEuCountry(code: string | null | undefined): boolean {
  return !!code && EU.has(code.toUpperCase());
}

export type ListingLike = {
  price_cents: number;
  price_currency: string | null;
  condition: string | null;
  language: string | null;
  quantity: number | null;
  seller_username: string | null;
  can_sell_via_hub: number;
  ships_from_country: string | null;
};

export type RankedListing<L extends ListingLike> = { listing: L; totalCents: number; shippingCents: number };

export type BuyComparison<L extends ListingLike> = {
  /** Inserzioni CardTrader Zero in UE, per prezzo + spedizione hub stimata. */
  ranked: RankedListing<L>[];
  /** Miglior inserzione NON Zero (UE) piu' economica del miglior totale Zero:
   * la sua spedizione la decide il venditore e non la conosciamo. */
  cheaperNoHub: L | null;
  /** Inserzioni scartate per paese fuori UE / paese ignoto. */
  excluded: number;
};

/** Ordina per prezzo totale stimato le inserzioni EUR dell'UE. Solo per Zero
 * la spedizione e' nota (tariffa hub, una per ordine: qui 1 carta). Le altre
 * non hanno una stima verificata: non entrano in classifica, ma se una costa
 * gia' meno del miglior totale Zero la segnaliamo a parte. */
export function compareListings<L extends ListingLike>(
  listings: L[],
  hubShippingCents: number | null,
  limit = 3,
): BuyComparison<L> {
  const eu = listings.filter(
    (l) => (l.price_currency ?? "EUR") === "EUR" && isEuCountry(l.ships_from_country),
  );
  const excluded = listings.length - eu.length;
  const ranked: RankedListing<L>[] =
    hubShippingCents === null
      ? []
      : eu
          .filter((l) => l.can_sell_via_hub === 1)
          .map((l) => ({ listing: l, shippingCents: hubShippingCents, totalCents: l.price_cents + hubShippingCents }))
          .sort((a, b) => a.totalCents - b.totalCents)
          .slice(0, limit);
  const bestTotal = ranked[0]?.totalCents ?? null;
  const noHub = eu.filter((l) => l.can_sell_via_hub !== 1).sort((a, b) => a.price_cents - b.price_cents)[0] ?? null;
  const cheaperNoHub = noHub && (bestTotal === null || noHub.price_cents < bestTotal) ? noHub : null;
  return { ranked, cheaperNoHub, excluded };
}

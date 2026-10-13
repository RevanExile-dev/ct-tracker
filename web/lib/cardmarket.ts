// Prezzi di riferimento Cardmarket (euro, via TCGdex) per la scheda carta.
// Sono MEDIE per carta, senza lingua ne' condizione: non sono offerte e non
// vanno mai mescolate ai prezzi CardTrader (griglia, filtri, ordinamenti,
// storico, allarmi, valore del Binder). Nessun import: testabile da solo.

export type CardmarketPrices = {
  trend_cents: number | null;
  low_cents: number | null;
  avg_cents: number | null;
  avg1_cents: number | null;
  avg7_cents: number | null;
  avg30_cents: number | null;
};

export type CardmarketReference = {
  /** Quando Cardmarket ha aggiornato questi prezzi (se noto), altrimenti
   * quando li abbiamo letti noi. ISO 8601. */
  updated_at: string;
  base: CardmarketPrices | null;
  holo: CardmarketPrices | null;
};

/** Oltre questa eta' il dato non si mostra: meglio niente che un riferimento
 * vecchio. Deve restare PIU' LUNGA del giro piu' lento del sync: le carte
 * sotto i 10 euro si riscaricano a rotazione ogni 7 giorni
 * (ROTATION_DAYS in scripts/sync_cardmarket_prices.py) e il prezzo ha gia' un
 * giorno di ritardo rispetto allo scarico (TCGdex aggiorna alle ~22:54 UTC),
 * quindi il caso normale arriva a ~7,2 giorni e un giro saltato a ~8,2.
 * Con 3 giorni (valore iniziale) piu' della meta' delle carte sarebbe sparita
 * a rotazione. La data di aggiornamento e' sempre scritta nel riquadro. */
export const CARDMARKET_MAX_AGE_DAYS = 9;

export function isCardmarketFresh(updatedAt: string, nowMs: number = Date.now()): boolean {
  const ts = Date.parse(updatedAt);
  if (!Number.isFinite(ts)) return false;
  return nowMs - ts <= CARDMARKET_MAX_AGE_DAYS * 86_400_000;
}

function hasAnyPrice(p: CardmarketPrices | null): p is CardmarketPrices {
  return !!p && Object.values(p).some((v) => typeof v === "number" && v > 0);
}

/** Il riferimento da mostrare, o null se non c'e' nulla di utilizzabile o e' vecchio. */
export function visibleCardmarketReference(
  ref: CardmarketReference | null | undefined,
  nowMs: number = Date.now(),
): CardmarketReference | null {
  if (!ref || !isCardmarketFresh(ref.updated_at, nowMs)) return null;
  const base = hasAnyPrice(ref.base) ? ref.base : null;
  const holo = hasAnyPrice(ref.holo) ? ref.holo : null;
  if (!base && !holo) return null;
  return { updated_at: ref.updated_at, base, holo };
}

/** Il valore su cui stimare la spedizione: il trend della versione normale,
 * altrimenti (carte solo holo, o trend assente) il primo prezzo disponibile. */
export function referenceValueCents(ref: CardmarketReference): number | null {
  for (const p of [ref.base, ref.holo]) {
    if (!p) continue;
    const v = p.trend_cents ?? p.avg_cents ?? p.low_cents ?? p.avg7_cents ?? p.avg30_cents ?? p.avg1_cents;
    if (typeof v === "number" && v > 0) return v;
  }
  return null;
}

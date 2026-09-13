// Aggregazione costo/valore/plusvalenza su un insieme di lotti (binder_lots) -
// estratta da web/app/lots/page.tsx cosi' web/app/binder/page.tsx puo' mostrare
// lo stesso identico calcolo (stessa euristica di prezzo, stesso guard sulla
// valuta) senza duplicarlo: due implementazioni indipendenti dello stesso
// "quanto ho speso vs quanto vale ora" avrebbero rischiato di divergere in un
// dettaglio (es. una gestita la valuta diversa, l'altra no) mostrando due
// numeri diversi per lo stesso identico dato.
import type { CardRow } from "./types";
import type { Lot } from "./types";

export type LanguagePriceMap = Record<string, { price_cents: number; price_currency: string | null }>;

/** Prezzo unitario per un lotto: nella lingua del lotto quando nota e
 * disponibile sul mercato (chiave "blueprintId:lingua", non solo
 * blueprintId - due lotti della stessa carta in lingue diverse non devono
 * sovrascriversi il prezzo a vicenda), altrimenti il "best" generale della
 * carta. */
export function resolveLotUnitPrice(
  lot: Lot,
  card: CardRow | undefined,
  languagePrices: LanguagePriceMap
): { cents: number; currency: string | null } | null {
  const key = lot.language ? `${lot.blueprintId}:${lot.language}` : null;
  if (key && languagePrices[key]) {
    const p = languagePrices[key];
    return { cents: p.price_cents, currency: p.price_currency };
  }
  const bestCents = card?.best_price_cents ?? card?.latest_price_cents ?? null;
  if (bestCents === null || bestCents === undefined) return null;
  return { cents: bestCents, currency: card?.best_price_currency ?? card?.latest_price_currency ?? "EUR" };
}

export type LotEconomicsSummary = {
  totalLots: number;
  costCents: number; costKnownCount: number; costUnknownCount: number;
  valueCents: number; valueKnownCount: number; valueUnknownCount: number;
  gainCents: number; gainCount: number; gainExcluded: number;
};

/** Somma costo dichiarato, valore di mercato attuale e plusvalenza non
 * realizzata su un elenco di lotti - la plusvalenza si somma SOLO quando
 * costo e valore sono nella stessa valuta (di norma sempre EUR): un
 * confronto tra valute diverse spacciato per un unico totale sarebbe un
 * numero sbagliato, non solo impreciso, quindi viene escluso e conteggiato
 * a parte in gainExcluded invece di essere sommato "cosi' com'e'". */
export function summarizeLotEconomics(
  lots: Lot[],
  cardsById: Map<number, CardRow>,
  languagePrices: LanguagePriceMap
): LotEconomicsSummary {
  let costCents = 0, costKnownCount = 0;
  let valueCents = 0, valueKnownCount = 0;
  let gainCents = 0, gainCount = 0, gainExcluded = 0;
  for (const lot of lots) {
    const card = cardsById.get(lot.blueprintId);
    const priceInfo = resolveLotUnitPrice(lot, card, languagePrices);
    const lotValue = priceInfo ? priceInfo.cents * lot.quantity : null;
    if (lot.costTotalCents !== null) { costCents += lot.costTotalCents; costKnownCount++; }
    if (lotValue !== null) { valueCents += lotValue; valueKnownCount++; }
    if (lot.costTotalCents !== null && lotValue !== null) {
      const costCurrency = lot.costCurrency ?? "EUR";
      if (costCurrency === (priceInfo?.currency ?? "EUR")) {
        gainCents += lotValue - lot.costTotalCents;
        gainCount++;
      } else {
        gainExcluded++;
      }
    }
  }
  return {
    totalLots: lots.length,
    costCents, costKnownCount, costUnknownCount: lots.length - costKnownCount,
    valueCents, valueKnownCount, valueUnknownCount: lots.length - valueKnownCount,
    gainCents, gainCount, gainExcluded,
  };
}

/** Il lotto "principale" di una carta ai fini del pulsante "Dettagli
 * acquisto" nel binder (web/app/binder/page.tsx): quello con provenance
 * "acquisto" piu' recente se esiste, altrimenti il lotto piu' recente in
 * assoluto - una carta puo' avere piu' lotti nel tempo (vedi
 * web/lib/types.ts su Lot), ma il pulsante ne mostra/modifica sempre e solo
 * uno, coerente con l'idea che il popup allo starring ne crea al massimo
 * uno. `lots` deve arrivare gia' ordinato piu' recente prima (stesso ordine
 * di GET /api/account/lots, vedi web/lib/account.server.ts). */
export function primaryLotFor(lots: Lot[], blueprintId: number): Lot | null {
  const forCard = lots.filter((l) => l.blueprintId === blueprintId);
  if (forCard.length === 0) return null;
  return forCard.find((l) => l.provenance === "acquisto") ?? forCard[0];
}

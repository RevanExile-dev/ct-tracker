// Stima della spedizione su Cardmarket per un acquirente in Italia, SOLO per
// il riquadro "Riferimento Cardmarket" della scheda carta. Nessun import:
// resta testabile da solo (tests/cardmarket-shipping.test.mjs).
//
// I costi li decide Cardmarket (non il venditore), per ORDINE verso un
// venditore e non per carta; includono francobollo + imballaggio. I valori
// sotto sono copiati A MANO dall'elenco ufficiale che la loro pagina
// https://help.cardmarket.com/en/ShippingCosts mostra (letto il 2026-10-09,
// rapporto in docs/cardmarket_prices_2026-10-09.md): non vengono letti in
// automatico dal sito (termini d'uso dell'indirizzo non verificati). Cardmarket
// li aggiorna, quindi vanno ricontrollati ogni mese e CARDMARKET_SHIPPING_CHECKED_AT
// aggiornata: e' la data che il riquadro mostra all'utente.

export const CARDMARKET_SHIPPING_CHECKED_AT = "2026-10-09";
export const CARDMARKET_SHIPPING_SOURCE_URL = "https://help.cardmarket.com/en/ShippingCosts";

type Tier = {
  /** Valore massimo dell'ordine (centesimi) coperto da questo scaglione. */
  maxValueCents: number;
  /** Venditore italiano: costo (centesimi) fino a N carte, in ordine crescente. */
  italy: ReadonlyArray<readonly [maxCards: number, cents: number]>;
  /** Costo piu' alto osservato da un venditore estero (DE/FR/ES) nello stesso
   * scaglione, solo dove verificato; null = non verificato. */
  abroadMaxCents: number | null;
  method: string;
};

export const ITALY_SHIPPING_TIERS: ReadonlyArray<Tier> = [
  { maxValueCents: 2_500, abroadMaxCents: null, method: "lettera non tracciata",
    italy: [[4, 160], [17, 825], [40, 885]] },
  { maxValueCents: 5_000, abroadMaxCents: 1_604, method: "raccomandata",
    italy: [[4, 650], [17, 825], [40, 885]] },
  { maxValueCents: 7_500, abroadMaxCents: null, method: "raccomandata con ricevuta di ritorno",
    italy: [[4, 755], [17, 930], [40, 990]] },
  { maxValueCents: 25_000, abroadMaxCents: null, method: "assicurata fino a 250 €",
    italy: [[17, 1_140], [40, 1_195]] },
  { maxValueCents: 200_000, abroadMaxCents: null, method: "assicurata fino a 2.000 €",
    italy: [[Infinity, 2_170]] },
  { maxValueCents: 300_000, abroadMaxCents: null, method: "assicurata fino a 3.000 €",
    italy: [[Infinity, 2_440]] },
];

export type ShippingEstimate = {
  /** Costo dell'ordine da un venditore italiano. */
  italyCents: number;
  /** Costo massimo osservato da un venditore estero, se verificato. */
  abroadMaxCents: number | null;
  method: string;
};

/** Costo dell'ordine verso un venditore italiano per `cards` carte da
 * `valueCents` in totale; null se fuori dalla tabella (valore non valido, o
 * oltre 3.000 €: non stimiamo). Con piu' carte dello stesso venditore la
 * spedizione e' una sola. */
export function estimateShipping(valueCents: number, cards = 1): ShippingEstimate | null {
  if (!Number.isFinite(valueCents) || valueCents <= 0 || !Number.isFinite(cards) || cards < 1) return null;
  const tier = ITALY_SHIPPING_TIERS.find((t) => valueCents <= t.maxValueCents);
  if (!tier) return null;
  const step = tier.italy.find(([maxCards]) => cards <= maxCards);
  if (!step) return null;
  return { italyCents: step[1], abroadMaxCents: tier.abroadMaxCents, method: tier.method };
}

/** Esempio "piu' carte, una sola spedizione": la busta da 17 carte
 * (raccomandata fino a 50 g), costo totale e per carta. */
export function bundleExample(): { cards: number; totalCents: number; perCardCents: number } {
  const cards = 17;
  const totalCents = 825;
  return { cards, totalCents, perCardCents: Math.round(totalCents / cards) };
}

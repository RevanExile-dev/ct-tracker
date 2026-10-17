import { MIN_MOVER_LISTINGS, type CardRow } from "@/lib/db";
import { priceDeltaPct } from "@/lib/format";

// Colori dei tipi: servono solo per le carte d'esempio (il database non ha il tipo).
export const TYPE_COLORS = {
  fuoco: "#e8663d", acqua: "#3f8fd6", erba: "#5baa5f", elettro: "#f0c63c", psico: "#a66bd0", buio: "#5a6272", drago: "#c9a24a",
} as const;
export type TypeKey = keyof typeof TYPE_COLORS;

/** 0 = comune, 1 = non comune, 2 = rara o superiore. */
export type Tier = 0 | 1 | 2;
/** Intensita' della lamina: nessuna, rara normale, rare speciali. */
export type Foil = "none" | "rara" | "holo";

export type DCard = {
  id: number | string;
  name: string;
  set: string;
  /** Numero della carta (d'esempio) o sigla dell'espansione (dati veri). */
  tag: string;
  rarityLabel: string | null;
  tier: Tier | null;
  foil: Foil;
  img: string | null;
  type: TypeKey | null;
  price: number | null;
  delta: number | null;
  listings: number | null;
  spark: number[] | null;
  sample: boolean;
};

export function rarityInfo(raw: string | null): { tier: Tier | null; foil: Foil } {
  if (!raw) return { tier: null, foil: "none" };
  const r = raw.toLowerCase();
  if (/\buncommon\b|non comune/.test(r)) return { tier: 1, foil: "none" };
  if (/\bcommon\b|comune/.test(r)) return { tier: 0, foil: "none" };
  if (/^(rare|rara)$/.test(r.trim())) return { tier: 2, foil: "rara" };
  if (/promo/.test(r)) return { tier: 1, foil: "none" };
  return { tier: 2, foil: "holo" };
}

export const TIER_GLYPH = ["●", "◆", "★"] as const;
export const TIER_NAME = ["Comune", "Non comune", "Rara o superiore"] as const;

/** In `version` CardTrader mette il numero della carta, a volte dopo la rarita'
 *  ("Shiny Rare | SV49/SV94", "140/202"): prende l'ultimo pezzo se sembra un numero. */
export function cardNumber(version: string | null): string | null {
  if (!version) return null;
  const v = version.split("|").pop()?.trim() ?? "";
  return v && v.length <= 14 && /\d/.test(v) ? v : null;
}

/** Trasforma una riga del catalogo vero nella forma usata dalla demo. Il prezzo
 *  e' quello "esatto" del sito (italiano, Near Mint, CardTrader Zero), la
 *  variazione compare solo con abbastanza inserzioni, come nella pagina Movimenti. */
export function fromRow(row: CardRow): DCard {
  const { tier, foil } = rarityInfo(row.rarity);
  const cents = row.it_nm_zero_price_cents;
  const reliable = (row.it_nm_zero_listings_count ?? 0) >= MIN_MOVER_LISTINGS;
  const pct = reliable ? priceDeltaPct(cents, row.prev_it_nm_zero_price_cents) : null;
  return {
    id: row.id,
    name: row.name,
    set: row.expansion_name,
    tag: cardNumber(row.version) ?? row.expansion_code.toUpperCase(),
    rarityLabel: row.rarity,
    tier,
    foil,
    img: row.image_url,
    type: null,
    price: cents != null ? cents / 100 : null,
    delta: pct,
    listings: row.it_nm_zero_listings_count ?? null,
    spark: null,
    sample: false,
  };
}

const S = (
  id: string, name: string, set: string, tag: string, rarityLabel: string, type: TypeKey,
  price: number, delta: number, spark: number[],
): DCard => {
  const { tier, foil } = rarityInfo(rarityLabel);
  return { id, name, set, tag, rarityLabel, tier, foil, img: null, type, price, delta, listings: 12, spark, sample: true };
};

/** Carte d'esempio, usate solo se il catalogo vero non risponde. */
export const SAMPLE: DCard[] = [
  S("s0", "Gyarados", "Evoluzioni", "034/108", "Rara", "acqua", 7.1, 4.2, [6.4, 6.5, 6.4, 6.7, 6.8, 6.9, 7.1]),
  S("s1", "Charizard ex", "Ossidiana Infuocata", "125/197", "Rara Ultra", "fuoco", 38.5, 12.4, [30, 31, 33, 33, 35, 37, 38.5]),
  S("s2", "Pikachu", "Scintille Folgoranti", "058/102", "Non comune", "elettro", 2.9, 1.8, [2.7, 2.8, 2.7, 2.8, 2.8, 2.9, 2.9]),
  S("s3", "Foongus", "Assedio Vapore", "012/098", "Comune", "erba", 0.35, -2.1, [0.4, 0.4, 0.38, 0.37, 0.36, 0.35, 0.35]),
  S("s4", "Gengar", "Destino Cangiante", "066/165", "Rara", "psico", 9.4, -6.3, [10.6, 10.4, 10.2, 10, 9.8, 9.6, 9.4]),
  S("s5", "Umbreon", "Evoluzioni Prismatiche", "094/189", "Rara Ultra", "buio", 61, 3.5, [57, 58, 58, 59, 60, 60, 61]),
  S("s6", "Starmie", "Evoluzioni", "045/108", "Non comune", "acqua", 1.2, 8.7, [1, 1, 1.05, 1.1, 1.1, 1.15, 1.2]),
  S("s7", "Ninetales", "Cronache Antiche", "021/102", "Rara", "fuoco", 4.8, -3.9, [5.3, 5.2, 5.1, 5, 4.9, 4.9, 4.8]),
  S("s8", "Rayquaza", "Cieli Lontani", "076/203", "Rara Ultra", "drago", 24, 5.1, [21, 21.5, 22, 22.5, 23, 23.5, 24]),
];

export function eur(n: number | null): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n);
}
export function pct(d: number): string {
  const v = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.abs(d));
  return `${d >= 0 ? "+" : "−"}${v} %`;
}

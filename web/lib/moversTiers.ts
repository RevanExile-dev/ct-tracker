/** Fasce di prezzo per "carte in movimento" (vedi fetchMoversPage in db.ts).
 * Il limite superiore di ogni fascia e' un centesimo sotto il limite
 * inferiore della fascia successiva (mai null tranne l'ultima) cosi' una
 * carta al confine esatto (es. 5,00€) cade in una fascia sola ("5-20€", non
 * anche "0-5€") - la duplicazione al confine e' un caso di test esplicito. */
export type MoversTier = {
  key: string;
  label: string;
  minCents: number;
  maxCents: number | null;
};

export const MOVERS_TIERS: MoversTier[] = [
  { key: "0-5", label: "0–5€", minCents: 0, maxCents: 499 },
  { key: "5-20", label: "5–20€", minCents: 500, maxCents: 1999 },
  { key: "20-50", label: "20–50€", minCents: 2000, maxCents: 4999 },
  { key: "50-150", label: "50–150€", minCents: 5000, maxCents: 14999 },
  { key: "150+", label: "150€+", minCents: 15000, maxCents: null },
];

export function findMoversTier(key: string | null): MoversTier | undefined {
  if (!key) return undefined;
  return MOVERS_TIERS.find((t) => t.key === key);
}

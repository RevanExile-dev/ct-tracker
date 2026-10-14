/** Finestre di tempo per "Carte in movimento": quanto puo' essere vecchio il
 * prezzo con cui si confronta quello di oggi. Il catalogo si aggiorna a
 * rotazione, quindi senza una finestra un "ribasso" puo' essere un confronto
 * con un prezzo di un mese fa (visto in produzione il 2026-10-14). */
export type MoversPeriod = { key: string; label: string; days: number | null };

export const MOVERS_PERIODS: MoversPeriod[] = [
  { key: "3", label: "3 giorni", days: 3 },
  { key: "7", label: "7 giorni", days: 7 },
  { key: "30", label: "30 giorni", days: 30 },
  { key: "all", label: "Tutto", days: null },
];

// 30 giorni e non 7: il catalogo si aggiorna a rotazione (circa una volta ogni
// 1-3 settimane per carta), quindi con 7 giorni la lista sarebbe quasi vuota. Il
// confronto resta onesto perche' ogni carta dice di quanti giorni e' la
// variazione; quando la rotazione sara' piu' fitta si potra' stringere.
export const DEFAULT_MOVERS_PERIOD = "30";

/** Chiave non riconosciuta = predefinita, mai un errore. */
export function findMoversPeriod(key: string | null | undefined): MoversPeriod {
  return MOVERS_PERIODS.find((p) => p.key === key) ?? MOVERS_PERIODS.find((p) => p.key === DEFAULT_MOVERS_PERIOD)!;
}

/** "oggi", "ieri", "5 giorni fa": l'eta' del prezzo con cui si confronta. */
export function formatCompareAge(days: number | null | undefined): string | null {
  if (days == null || !Number.isFinite(days) || days < 0) return null;
  if (days === 0) return "da oggi";
  if (days === 1) return "da ieri";
  return `in ${days} gg`;
}

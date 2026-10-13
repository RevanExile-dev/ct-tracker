// Piani dell'account: Gratis e Plus. Struttura preparata il 2026-10-13 per
// un futuro abbonamento facoltativo (report
// strategia-concorrenza-2026-10-09/report-strategia.md, sezione 5), restando
// sui piani gratuiti di Vercel e Neon: il piano Hobby di Vercel vieta
// qualunque incasso, quindi OGGI non si vende nulla e nessuno perde nulla.
//
// Finche' PLUS_FOR_EVERYONE e' true ("fase gratuita") ogni account ha i
// limiti del Plus, che coincidono con i tetti tecnici gia' in vigore
// (accountLimits.ts, PR #127): il comportamento del sito e' identico a prima
// e la tabella user_plans non viene nemmeno letta. Il giorno in cui ci
// saranno l'ok scritto di CardTrader, Vercel Pro e un fornitore di pagamenti,
// basta mettere PLUS_FOR_EVERYONE a false e far scrivere user_plans dal
// webhook dei pagamenti: i limiti del Gratis entrano in vigore solo per le
// righe NUOVE (exceedsLimit), chi e' gia' sopra non perde niente.
//
// I numeri del Gratis sono una proposta, non ancora decisa con Cri.
//
// Modulo senza import apposta: lo caricano anche i test unitari
// (web/tests/plans.test.mjs).

export type PlanId = "free" | "plus";

export interface PlanLimits {
  binderCards: number;
  wishlistCards: number;
  lots: number;
  priceAlerts: number;
  filterPresets: number;
}

/** Fase gratuita: tutti hanno il Plus senza pagare. */
export const PLUS_FOR_EVERYONE = true;

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  free: { binderCards: 300, wishlistCards: 300, lots: 100, priceAlerts: 3, filterPresets: 3 },
  // Uguali ai tetti di accountLimits.ts (il test lo controlla): il Plus non
  // puo' superare i tetti tecnici scelti per proteggere il database condiviso.
  plus: { binderCards: 5_000, wishlistCards: 2_000, lots: 5_000, priceAlerts: 100, filterPresets: 10 },
};

export interface StoredPlan {
  plan: string;
  validUntil: Date | null;
}

/** Il piano che vale adesso. Senza riga, piano sconosciuto o Plus scaduto
 * vale il Gratis; valid_until NULL = Plus senza scadenza (es. dato a mano). */
export function effectivePlan(stored: StoredPlan | null, now: Date = new Date()): PlanId {
  if (PLUS_FOR_EVERYONE) return "plus";
  if (!stored || stored.plan !== "plus") return "free";
  if (stored.validUntil && stored.validUntil.getTime() <= now.getTime()) return "free";
  return "plus";
}

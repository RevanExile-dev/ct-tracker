// Tetti per account, applicati lato server (web/lib/account.server.ts e le
// route sotto web/app/api/account/**). Senza, un solo account poteva
// scrivere quante righe voleva nel database condiviso (1 GB sul piano
// gratuito di Neon): riempirlo ferma anche i sync dei prezzi per tutti.
//
// Valori scelti con ampio margine sull'uso reale piu' alto letto su Neon il
// 2026-10-09 (binder 152, desideri 74, lotti 98, allarmi 27, filtri 0): un
// collezionista vero non li nota, un abuso si. Il tetto blocca solo
// l'AGGIUNTA di righe nuove oltre la soglia: aggiornare, togliere o
// ricaricare righe che l'utente ha gia' non e' mai limitato, quindi chi e'
// gia' oltre (oggi nessuno) non perde nulla.
//
// Modulo senza import apposta: lo caricano anche i test unitari
// (web/tests/account-limits.test.mjs).

export const MAX_BINDER_CARDS = 5_000;
export const MAX_WISHLIST_CARDS = 2_000;
export const MAX_LOTS = 5_000;
export const MAX_PRICE_ALERTS = 100;
export const MAX_FILTER_PRESETS = 10;
/** Un filtro salvato reale pesa poche centinaia di byte. */
export const MAX_FILTER_PRESET_BYTES = 8_192;
export const MAX_PRESET_SCOPE_LENGTH = 40;
export const MAX_BINDER_TEXT_LENGTH = 40;

export class AccountLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountLimitError";
  }
}

/** true se aggiungere `adding` righe nuove a `current` supera `max`.
 * Se non si aggiunge nulla non e' mai un superamento, anche con `current`
 * gia' sopra il tetto. */
export function exceedsLimit(current: number, adding: number, max: number): boolean {
  return adding > 0 && current + adding > max;
}

export function limitMessage(what: string, max: number): string {
  return `Hai raggiunto il massimo di ${max.toLocaleString("it-IT")} ${what}. Elimina qualcosa per aggiungerne altre.`;
}

/** Un id carta valido: intero positivo nel range di un INTEGER Postgres. */
export function isValidBlueprintId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 2_147_483_647;
}

function isShortTextOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length <= MAX_BINDER_TEXT_LENGTH);
}

/** Tiene SOLO i campi che il binder usa davvero (lingua, quantita',
 * condizione, finitura): prima il patch finiva cosi' com'era nel JSONB di
 * binder_cards, con chiavi e dimensione a piacere. I campi sconosciuti
 * (es. addedAt, che il client invia ma il server ignora gia' in lettura)
 * vengono scartati senza errore, cosi' nessun client esistente si rompe;
 * un valore dei campi noti con forma sbagliata o troppo lungo e' un errore. */
export function pickBinderPatch(patch: unknown): { patch: Record<string, unknown> } | { error: string } {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return { patch: {} };
  const v = patch as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ["language", "condition", "finish"] as const) {
    if (v[key] === undefined) continue;
    if (!isShortTextOrNull(v[key])) {
      return { error: `Campo "${key}" non valido: testo di massimo ${MAX_BINDER_TEXT_LENGTH} caratteri oppure null.` };
    }
    out[key] = v[key];
  }
  if (v.quantity !== undefined) out.quantity = v.quantity; // validata a parte (isValidBinderQuantity)
  return { patch: out };
}

/** Nome di un filtro salvato: lettere, cifre, trattino e underscore. */
export function isValidPresetScope(scope: string): boolean {
  return scope.length >= 1 && scope.length <= MAX_PRESET_SCOPE_LENGTH && /^[A-Za-z0-9_-]+$/.test(scope);
}

export function isValidPresetSize(data: unknown): boolean {
  try {
    const json = JSON.stringify(data);
    return typeof json === "string" && json.length <= MAX_FILTER_PRESET_BYTES;
  } catch {
    return false;
  }
}

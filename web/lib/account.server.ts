import "server-only";
import { randomBytes } from "crypto";
import { getPgPool } from "./pgPool";
import type { BinderEntry } from "./binder";
import type { FilterPreset } from "./filterPreset";
import type {
  BinderValuePoint, Lot, LotEvent, LotInput, LotProvenance, PriceAlert, PriceAlertFireMode,
  PriceAlertInput, PriceAlertState, PriceAlertTargetType, TelegramLinkStatus,
} from "./types";

// Query Postgres per i dati collegati all'account (binder/wishlist/filtri
// salvati) - solo lato server (Route Handler in web/app/api/account/**),
// stesso pattern di web/lib/db.server.ts per il catalogo. "import type"
// verso lib/binder.ts e lib/filterPreset.ts (entrambi "use client") e'
// sicuro: e' eliminato del tutto in fase di compilazione, non porta
// nessun import a runtime del codice client in questo modulo server.

// Limite applicativo, non tecnico: previene sia un fat-finger (es. "99999"
// per errore) sia un valore che spingerebbe (bc.data->>'quantity')::int in
// scripts/db.py fuori dal range che il suo controllo a regex accetta
// ('^[1-9][0-9]{0,2}$', 1-999) - le due soglie vanno tenute allineate.
export const MAX_BINDER_QUANTITY = 999;

export function isValidBinderQuantity(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_BINDER_QUANTITY;
}

function toBinderEntry(row: { blueprint_id: number; added_at: Date | string; data: Partial<BinderEntry> }): BinderEntry {
  const data = row.data ?? {};
  return {
    blueprintId: row.blueprint_id,
    language: data.language ?? null,
    quantity: isValidBinderQuantity(data.quantity) ? data.quantity : 1,
    condition: data.condition,
    finish: data.finish ?? "unknown",
    addedAt: row.added_at instanceof Date ? row.added_at.toISOString() : row.added_at,
  };
}

export async function getBinderEntries(userId: string): Promise<BinderEntry[]> {
  const pool = getPgPool();
  const { rows } = await pool.query(
    "SELECT blueprint_id, added_at, data FROM binder_cards WHERE user_id = $1 ORDER BY added_at",
    [userId]
  );
  return rows.map(toBinderEntry);
}

/** Aggiorna (o crea) una singola entry: sul conflitto unisce solo i campi
 * passati in patch dentro il "data" JSONB gia' presente (mai un rimpiazzo
 * totale) - stessa identica semantica "mai rimuove, aggiorna solo i campi
 * dati" di upsertBinderEntry lato client (web/lib/binder.ts), cosi' un
 * push in background dopo un patch parziale (es. solo la lingua rilevata
 * dallo scanner) non cancella quantita'/condizione/finitura gia' salvate. */
export async function upsertBinderEntry(
  userId: string,
  blueprintId: number,
  patch: Partial<Omit<BinderEntry, "blueprintId" | "addedAt">>
): Promise<BinderEntry> {
  const pool = getPgPool();
  const cleanPatch = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const insertData = { language: null, quantity: 1, finish: "unknown", ...cleanPatch };
  const { rows } = await pool.query(
    `INSERT INTO binder_cards (user_id, blueprint_id, data)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (user_id, blueprint_id)
     DO UPDATE SET data = binder_cards.data || $4::jsonb
     RETURNING blueprint_id, added_at, data`,
    [userId, blueprintId, JSON.stringify(insertData), JSON.stringify(cleanPatch)]
  );
  return toBinderEntry(rows[0]);
}

export async function deleteBinderEntry(userId: string, blueprintId: number): Promise<void> {
  const pool = getPgPool();
  await pool.query("DELETE FROM binder_cards WHERE user_id = $1 AND blueprint_id = $2", [userId, blueprintId]);
}

/** Sostituisce per intero le entry passate (usata una sola volta al login
 * per il merge locale->account, vedi web/lib/binder.ts: il client ha gia'
 * calcolato l'unione locale+server prima di chiamare questa funzione, qui
 * si scrive quel risultato cosi' com'e', non un altro merge). added_at
 * resta quello gia' in DB per le entry esistenti (non nella clausola
 * UPDATE), viene impostato da DEFAULT now() solo per quelle nuove. */
export async function mergeBinderEntries(userId: string, entries: BinderEntry[]): Promise<void> {
  if (!entries.length) return;
  const pool = getPgPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const entry of entries) {
      const data = { language: entry.language, quantity: entry.quantity, condition: entry.condition, finish: entry.finish };
      await client.query(
        `INSERT INTO binder_cards (user_id, blueprint_id, data)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (user_id, blueprint_id) DO UPDATE SET data = $3::jsonb`,
        [userId, entry.blueprintId, JSON.stringify(data)]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Storico del valore totale del Binder di questo utente, un punto al
 * giorno (scritto da snapshot_binder_values() in scripts/db.py dopo ogni
 * sync prezzi - vedi web/db/schema.sql). Cresce ogni giorno che passa:
 * niente da ricostruire qui, solo leggere quello che il sync ha gia'
 * salvato. */
export async function getBinderValueHistory(userId: string): Promise<BinderValuePoint[]> {
  const pool = getPgPool();
  const { rows } = await pool.query(
    `SELECT captured_at::text AS captured_at, total_cents, currency, cards_count, priced_count
     FROM binder_value_snapshots
     WHERE user_id = $1
     ORDER BY captured_at ASC`,
    [userId]
  );
  return rows;
}

export async function getWishlistIds(userId: string): Promise<number[]> {
  const pool = getPgPool();
  const { rows } = await pool.query(
    "SELECT blueprint_id FROM wishlist_cards WHERE user_id = $1 ORDER BY added_at",
    [userId]
  );
  return rows.map((r) => r.blueprint_id as number);
}

export async function addWishlistId(userId: string, blueprintId: number): Promise<void> {
  const pool = getPgPool();
  await pool.query(
    "INSERT INTO wishlist_cards (user_id, blueprint_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [userId, blueprintId]
  );
}

export async function removeWishlistId(userId: string, blueprintId: number): Promise<void> {
  const pool = getPgPool();
  await pool.query("DELETE FROM wishlist_cards WHERE user_id = $1 AND blueprint_id = $2", [userId, blueprintId]);
}

export async function mergeWishlistIds(userId: string, ids: number[]): Promise<void> {
  if (!ids.length) return;
  const pool = getPgPool();
  await pool.query(
    "INSERT INTO wishlist_cards (user_id, blueprint_id) SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING",
    [userId, ids]
  );
}

export async function getFilterPreset(userId: string, scope: string): Promise<{ data: FilterPreset; updatedAt: string } | null> {
  const pool = getPgPool();
  const { rows } = await pool.query(
    "SELECT data, updated_at FROM filter_presets WHERE user_id = $1 AND scope = $2",
    [userId, scope]
  );
  if (!rows.length) return null;
  return { data: rows[0].data, updatedAt: rows[0].updated_at.toISOString() };
}

export async function setFilterPreset(userId: string, scope: string, data: FilterPreset): Promise<{ data: FilterPreset; updatedAt: string }> {
  const pool = getPgPool();
  const { rows } = await pool.query(
    `INSERT INTO filter_presets (user_id, scope, data)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (user_id, scope) DO UPDATE SET data = $3::jsonb, updated_at = now()
     RETURNING data, updated_at`,
    [userId, scope, JSON.stringify(data)]
  );
  return { data: rows[0].data, updatedAt: rows[0].updated_at.toISOString() };
}

export async function deleteFilterPreset(userId: string, scope: string): Promise<void> {
  const pool = getPgPool();
  await pool.query("DELETE FROM filter_presets WHERE user_id = $1 AND scope = $2", [userId, scope]);
}

// --- Lotti (costo/provenienza) - vedi CREATE TABLE binder_lots in
// web/db/schema.sql per la semantica completa (NULL vs 0 su costTotalCents,
// un lotto e' un acquisto specifico, non "la" quantita' posseduta della
// carta). Stesso tetto di MAX_BINDER_QUANTITY: e' lo stesso CHECK lato DB
// (quantity > 0 AND quantity <= 999), le due soglie vanno tenute allineate.
export const MAX_LOT_QUANTITY = 999;
export const LOT_PROVENANCES: LotProvenance[] = ["acquisto", "pacchetto", "regalo", "scambio", "non_specificata"];

export function isValidLotQuantity(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_LOT_QUANTITY;
}

export function isValidLotProvenance(value: unknown): value is LotProvenance {
  return typeof value === "string" && (LOT_PROVENANCES as string[]).includes(value);
}

/** Data pura YYYY-MM-DD (colonna DATE, niente ora/fuso) - stesso formato
 * gia' usato da binder_value_snapshots.captured_at, vedi normalizeCollectionHistory
 * in web/lib/collectionHistory.ts sul perche' importa non passare per Date. */
export function isValidLotDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

/** Costo dichiarato: NULL = sconosciuto (mai inserito), un intero >= 0 se
 * presente - MAI negativo, MAI una stringa/NaN che finirebbe in una colonna
 * INTEGER e romperebbe la riga. */
export function isValidLotCost(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isInteger(value) && value >= 0);
}

/** Codice valuta ISO 4217 a 3 lettere, o assente - stesso formato gia'
 * validato in web/lib/collectionHistory.ts (collectionHistoryCsv). Un
 * valore qualunque qui romperebbe silenziosamente la UI molto piu' tardi:
 * formatCents() in web/lib/format.ts passa la valuta cosi' com'e' a
 * Intl.NumberFormat, che lancia un RangeError (non un fallback silenzioso)
 * su un codice non valido - un crash dell'intera pagina /lots al primo
 * render, non solo un numero brutto. Meglio rifiutarlo qui, all'ingresso. */
export function isValidLotCurrency(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && /^[A-Z]{3}$/.test(value));
}

function toLot(row: {
  id: string; blueprint_id: number; quantity: number; language: string | null;
  condition: string | null; finish: string | null; provenance: string;
  acquired_at: string; cost_total_cents: number | null; cost_currency: string | null;
  note: string | null; created_at: Date | string;
}): Lot {
  return {
    id: row.id,
    blueprintId: row.blueprint_id,
    quantity: row.quantity,
    language: row.language,
    condition: row.condition,
    finish: row.finish,
    provenance: row.provenance as LotProvenance,
    acquiredAt: row.acquired_at,
    costTotalCents: row.cost_total_cents,
    costCurrency: row.cost_currency,
    note: row.note,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

const LOT_COLUMNS = `id, blueprint_id, quantity, language, condition, finish, provenance,
     acquired_at::text AS acquired_at, cost_total_cents, cost_currency, note, created_at`;

export async function getLots(userId: string): Promise<Lot[]> {
  const pool = getPgPool();
  const { rows } = await pool.query(
    `SELECT ${LOT_COLUMNS} FROM binder_lots WHERE user_id = $1 ORDER BY acquired_at DESC, created_at DESC`,
    [userId]
  );
  return rows.map(toLot);
}

/** Registra un evento di lotto (docs/binder_reserved_work_plan_2026-09-11.md,
 * punto 2) - va SEMPRE chiamata dentro la stessa transazione della modifica
 * a binder_lots che rappresenta, mai come scrittura separata: un evento
 * "add"/"remove"/"quantity_change" che finisse per esistere senza la
 * modifica corrispondente (o viceversa) sarebbe uno storico bugiardo. */
async function recordLotEvent(
  client: { query: (sql: string, values: unknown[]) => Promise<unknown> },
  event: { lotId: string | null; userId: string; blueprintId: number; eventType: "add" | "remove" | "quantity_change"; delta: number }
): Promise<void> {
  await client.query(
    `INSERT INTO binder_lot_events (lot_id, user_id, blueprint_id, event_type, delta)
     VALUES ($1, $2, $3, $4, $5)`,
    [event.lotId, event.userId, event.blueprintId, event.eventType, event.delta]
  );
}

export async function createLot(userId: string, input: LotInput): Promise<Lot> {
  const pool = getPgPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO binder_lots
         (user_id, blueprint_id, quantity, language, condition, finish, provenance, acquired_at, cost_total_cents, cost_currency, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, CURRENT_DATE), $9, $10, $11)
       RETURNING ${LOT_COLUMNS}`,
      [
        userId, input.blueprintId, input.quantity,
        input.language ?? null, input.condition ?? null, input.finish ?? null,
        input.provenance ?? "non_specificata", input.acquiredAt ?? null,
        input.costTotalCents ?? null, input.costCurrency ?? null, input.note ?? null,
      ]
    );
    const lot = toLot(rows[0]);
    await recordLotEvent(client, {
      lotId: lot.id, userId, blueprintId: input.blueprintId, eventType: "add", delta: input.quantity,
    });
    await client.query("COMMIT");
    return lot;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Patch parziale: solo i campi presenti in `patch` vengono aggiornati
 * (stesso principio "mai un rimpiazzo totale" di upsertBinderEntry sopra) -
 * ma qui il whitelist di colonne e' fisso (non un JSONB), quindi costruito
 * qui invece che affidato a una singola query statica come per binder_cards.
 *
 * Quando il patch include "quantity" ed e' diversa da quella attuale,
 * registra anche un evento "quantity_change" (SELECT ... FOR UPDATE prima
 * dell'UPDATE per leggere la quantita' precedente senza una race se due
 * richieste concorrenti modificano lo stesso lotto) - un valore identico
 * al presente non genera un evento, non e' un cambiamento reale. */
export async function updateLot(
  userId: string,
  lotId: string,
  patch: Partial<Omit<LotInput, "blueprintId">>
): Promise<Lot | null> {
  const pool = getPgPool();
  const columns: Record<string, string> = {
    quantity: "quantity", language: "language", condition: "condition", finish: "finish",
    provenance: "provenance", acquiredAt: "acquired_at", costTotalCents: "cost_total_cents",
    costCurrency: "cost_currency", note: "note",
  };
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of Object.entries(columns)) {
    const value = (patch as Record<string, unknown>)[key];
    if (value === undefined) continue;
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  }
  if (sets.length === 0) {
    const { rows } = await pool.query(`SELECT ${LOT_COLUMNS} FROM binder_lots WHERE id = $1 AND user_id = $2`, [lotId, userId]);
    return rows[0] ? toLot(rows[0]) : null;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let previousQuantity: number | null = null;
    if (patch.quantity !== undefined) {
      const { rows } = await client.query(
        "SELECT quantity, blueprint_id FROM binder_lots WHERE id = $1 AND user_id = $2 FOR UPDATE",
        [lotId, userId]
      );
      if (!rows[0]) { await client.query("ROLLBACK"); return null; }
      previousQuantity = rows[0].quantity;
    }
    values.push(lotId, userId);
    const { rows } = await client.query(
      `UPDATE binder_lots SET ${sets.join(", ")} WHERE id = $${values.length - 1} AND user_id = $${values.length}
       RETURNING ${LOT_COLUMNS}`,
      values
    );
    if (!rows[0]) { await client.query("ROLLBACK"); return null; }
    const lot = toLot(rows[0]);
    if (previousQuantity !== null && previousQuantity !== lot.quantity) {
      await recordLotEvent(client, {
        lotId: lot.id, userId, blueprintId: lot.blueprintId,
        eventType: "quantity_change", delta: lot.quantity - previousQuantity,
      });
    }
    await client.query("COMMIT");
    return lot;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Stato attuale di una carta ai fini dell'import Markdown (web/lib/lotImport.server.ts):
 * e' gia' nel binder dell'utente? Se si', quale costo/data ha gia' registrato
 * sul suo lotto "acquisto" (se esiste)? Usata per decidere se una riga
 * dell'import puo' scrivere subito (carta nuova) o deve prima chiedere
 * conferma all'utente (carta gia' presente: l'import non deve sovrascrivere
 * un prezzo/data gia' noti senza che l'utente lo scelga esplicitamente -
 * richiesta esplicita dell'utente dopo aver notato che un ri-import
 * aggiornava le carte gia' importate senza avvisare). Le due query girano
 * in parallelo (Promise.all): sono indipendenti, nessun bisogno di una
 * transazione ne' di una singola query con LATERAL solo per risparmiare un
 * round-trip. */
export async function getExistingPurchaseInfo(
  userId: string,
  blueprintId: number
): Promise<{ inBinder: boolean; costTotalCents: number | null; acquiredAt: string | null }> {
  const pool = getPgPool();
  const [binderResult, lotResult] = await Promise.all([
    pool.query("SELECT 1 FROM binder_cards WHERE user_id = $1 AND blueprint_id = $2", [userId, blueprintId]),
    pool.query(
      `SELECT cost_total_cents, acquired_at::text AS acquired_at FROM binder_lots
       WHERE user_id = $1 AND blueprint_id = $2 AND provenance = 'acquisto'
       ORDER BY created_at ASC LIMIT 1`,
      [userId, blueprintId]
    ),
  ]);
  return {
    inBinder: binderResult.rows.length > 0,
    costTotalCents: lotResult.rows[0]?.cost_total_cents ?? null,
    acquiredAt: lotResult.rows[0]?.acquired_at ?? null,
  };
}

/** Crea o aggiorna il lotto "acquisto" di una carta per l'import Markdown
 * (web/lib/lotImport.server.ts, POST /api/account/lots/import): se esiste
 * gia' un lotto con provenance "acquisto" per questa carta (il piu' vecchio,
 * se ce ne fosse piu' di uno) ne aggiorna SOLO i campi passati - stesso
 * principio "mai un rimpiazzo totale" di updateLot sopra. Sia costTotalCents
 * sia acquiredAt vanno OMESSI dal patch (non passati come null/undefined)
 * quando la riga di import non li conosce, non solo acquiredAt: un
 * ri-import con una cella prezzo mal formattata non deve cancellare un
 * costo gia' registrato in precedenza su un lotto esistente (rilievo
 * review, verificato: la versione precedente passava sempre
 * costTotalCents, azzerando un costo noto ogni volta che una riga aveva un
 * prezzo illeggibile). Se non esiste ancora nessun lotto "acquisto" per
 * questa carta, ne crea uno nuovo (qui l'assenza di acquiredAt ricade sul
 * default CURRENT_DATE di createLot, stesso comportamento del form manuale
 * di /lotti; l'assenza di costTotalCents diventa costo sconosciuto, valore
 * di partenza legittimo per un lotto nuovo). */
export async function upsertPurchaseLot(
  userId: string,
  blueprintId: number,
  patch: { costTotalCents?: number | null; acquiredAt?: string }
): Promise<{ lot: Lot; created: boolean }> {
  const pool = getPgPool();
  const { rows } = await pool.query(
    `SELECT id FROM binder_lots WHERE user_id = $1 AND blueprint_id = $2 AND provenance = 'acquisto'
     ORDER BY created_at ASC LIMIT 1`,
    [userId, blueprintId]
  );
  if (rows[0]) {
    const updated = await updateLot(userId, rows[0].id, {
      ...(patch.costTotalCents !== undefined
        ? { costTotalCents: patch.costTotalCents, costCurrency: patch.costTotalCents !== null ? "EUR" : null }
        : {}),
      ...(patch.acquiredAt !== undefined ? { acquiredAt: patch.acquiredAt } : {}),
    });
    // updated puo' essere null solo se il lotto e' stato eliminato tra la
    // SELECT sopra e questa UPDATE (race con un'eliminazione manuale
    // dall'utente su /lotti, in un'altra scheda) - trattato come "nessun
    // lotto esistente", crea un lotto nuovo invece di propagare un errore.
    if (updated) return { lot: updated, created: false };
  }
  const costTotalCents = patch.costTotalCents ?? null;
  const created = await createLot(userId, {
    blueprintId, quantity: 1, provenance: "acquisto",
    acquiredAt: patch.acquiredAt,
    costTotalCents,
    costCurrency: costTotalCents !== null ? "EUR" : null,
  });
  return { lot: created, created: true };
}

export async function deleteLot(userId: string, lotId: string): Promise<void> {
  const pool = getPgPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "DELETE FROM binder_lots WHERE id = $1 AND user_id = $2 RETURNING quantity, blueprint_id",
      [lotId, userId]
    );
    if (rows[0]) {
      // lot_id NULL fin da subito (non l'id appena eliminato): il lotto non
      // esiste piu' nella stessa transazione in cui lo cancelliamo, un
      // riferimento FK a quell'id fallirebbe il vincolo immediatamente
      // (Postgres verifica i FK non differiti riga per riga, non a fine
      // transazione) - coerente comunque con ON DELETE SET NULL sulla
      // colonna, che esiste apposta per questo caso.
      await recordLotEvent(client, {
        lotId: null, userId, blueprintId: rows[0].blueprint_id,
        eventType: "remove", delta: -rows[0].quantity,
      });
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Storico eventi di lotto per questo utente, piu' recenti prima - nessun
 * consumatore UI ancora (il grafico che separa apporti/rimozioni dalla
 * variazione di mercato e' lavoro futuro, vedi il piano), ma i dati vanno
 * gia' accumulati in avanti da ora: ricostruirli a ritroso dal binder di
 * oggi non sarebbe possibile ne' corretto. */
export async function getLotEvents(userId: string): Promise<LotEvent[]> {
  const pool = getPgPool();
  const { rows } = await pool.query(
    `SELECT id, lot_id, blueprint_id, event_type, delta, occurred_at
     FROM binder_lot_events WHERE user_id = $1 ORDER BY occurred_at DESC, id DESC`,
    [userId]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    lotId: row.lot_id,
    blueprintId: row.blueprint_id,
    eventType: row.event_type,
    delta: row.delta,
    occurredAt: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : row.occurred_at,
  }));
}

// --- Collegamento account<->chat Telegram (punto 4a del piano) ---

const LINK_CODE_TTL_MINUTES = 15; // stessa durata del link magico via email (web/lib/auth.ts)
const LINK_CODE_MAX_ATTEMPTS = 5; // ritenta solo su collisione di codice (rara, vedi sotto)

export async function getTelegramLinkStatus(userId: string): Promise<TelegramLinkStatus> {
  const pool = getPgPool();
  const { rows } = await pool.query("SELECT linked_at FROM telegram_links WHERE user_id = $1", [userId]);
  if (rows.length === 0) return { linked: false, linkedAt: null };
  const linkedAt = rows[0].linked_at;
  return { linked: true, linkedAt: linkedAt instanceof Date ? linkedAt.toISOString() : linkedAt };
}

export async function unlinkTelegram(userId: string): Promise<void> {
  const pool = getPgPool();
  await pool.query("DELETE FROM telegram_links WHERE user_id = $1", [userId]);
}

function generateLinkCode(): string {
  // 10 caratteri esadecimali maiuscoli: abbastanza corti da scrivere a
  // mano in una chat Telegram ("/start A1B2C3D4E5"), abbastanza lunghi da
  // rendere trascurabile un tentativo di indovinarli nei 15 minuti di
  // validita'.
  return randomBytes(5).toString("hex").toUpperCase();
}

/** Genera (sostituendo un eventuale codice precedente per lo stesso utente
 * - una sola riga per utente, vedi schema) un codice mono-uso da mandare
 * al bot Telegram con "/start <codice>", consumato dal webhook in
 * web/app/api/telegram/webhook/route.ts. */
export async function createTelegramLinkCode(userId: string): Promise<{ code: string; expiresAt: string }> {
  const pool = getPgPool();
  for (let attempt = 0; attempt < LINK_CODE_MAX_ATTEMPTS; attempt++) {
    const code = generateLinkCode();
    try {
      const { rows } = await pool.query(
        `INSERT INTO telegram_link_codes (user_id, code, expires_at)
         VALUES ($1, $2, now() + interval '${LINK_CODE_TTL_MINUTES} minutes')
         ON CONFLICT (user_id) DO UPDATE SET code = EXCLUDED.code, expires_at = EXCLUDED.expires_at
         RETURNING expires_at`,
        [userId, code]
      );
      const expiresAt = rows[0].expires_at;
      return { code, expiresAt: expiresAt instanceof Date ? expiresAt.toISOString() : expiresAt };
    } catch (err) {
      // 23505 = violazione UNIQUE - solo sul vincolo di "code" (quello su
      // "user_id" e' la chiave primaria, gia' gestita da ON CONFLICT
      // sopra): un altro utente ha gia', per pura coincidenza, lo stesso
      // codice attivo in questo momento. Riprovare con un codice nuovo e'
      // corretto e sufficiente, non serve altro.
      if ((err as { code?: string }).code === "23505") continue;
      throw err;
    }
  }
  throw new Error("Impossibile generare un codice di collegamento univoco, riprova.");
}

export type TelegramLinkCodeResolution =
  | { ok: true }
  | { ok: false; reason: "invalid_or_expired" }
  | { ok: false; reason: "chat_already_linked_elsewhere" };

/** Consuma un codice di collegamento e collega chat_id all'utente
 * corrispondente - chiamata solo dal webhook Telegram dopo aver
 * verificato l'header segreto (web/app/api/telegram/webhook/route.ts).
 * Transazione con FOR UPDATE sulle righe lette: senza, due update
 * concorrenti sullo stesso codice o sulla stessa chat (es. un doppio
 * invio dell'update da parte di Telegram) potrebbero entrambi superare i
 * controlli prima che l'altro scriva, collegando la chat al posto
 * sbagliato o lasciando un codice consumato due volte. */
export async function consumeTelegramLinkCode(code: string, chatId: number): Promise<TelegramLinkCodeResolution> {
  const pool = getPgPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT user_id FROM telegram_link_codes WHERE code = $1 AND expires_at > now() FOR UPDATE",
      [code]
    );
    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "invalid_or_expired" };
    }
    const userId = rows[0].user_id as string;

    const existing = await client.query("SELECT user_id FROM telegram_links WHERE chat_id = $1 FOR UPDATE", [chatId]);
    if (existing.rows.length > 0 && existing.rows[0].user_id !== userId) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "chat_already_linked_elsewhere" };
    }

    await client.query(
      `INSERT INTO telegram_links (user_id, chat_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET chat_id = EXCLUDED.chat_id, linked_at = now()`,
      [userId, chatId]
    );
    await client.query("DELETE FROM telegram_link_codes WHERE code = $1", [code]);
    await client.query("COMMIT");
    return { ok: true };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// --- Allarmi prezzo (sotto-parte 4b del piano) ---

export class PriceAlertValidationError extends Error {}

const PRICE_ALERT_TARGET_TYPES: PriceAlertTargetType[] = ["absolute_cents", "percent_drop"];
const PRICE_ALERT_FIRE_MODES: PriceAlertFireMode[] = ["once", "rearm"];

// Tetti applicativi (non tecnici, stesso principio di MAX_LOT_QUANTITY
// sopra): evitano un fat-finger o un valore che non ha senso di dominio
// (un calo del 100%+ non e' un calo, e' un prezzo negativo).
const MAX_TARGET_ABSOLUTE_CENTS = 100_000_00; // 100.000,00 in qualunque valuta
const MAX_TARGET_PERCENT_DROP = 99;
export const MIN_REARM_COOLDOWN_HOURS = 1;
export const MAX_REARM_COOLDOWN_HOURS = 24 * 30; // un mese

export function isValidPriceAlertTargetType(value: unknown): value is PriceAlertTargetType {
  return typeof value === "string" && (PRICE_ALERT_TARGET_TYPES as string[]).includes(value);
}

export function isValidPriceAlertFireMode(value: unknown): value is PriceAlertFireMode {
  return typeof value === "string" && (PRICE_ALERT_FIRE_MODES as string[]).includes(value);
}

export function isValidPriceAlertTargetValue(targetType: PriceAlertTargetType, value: unknown): value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return false;
  return targetType === "absolute_cents" ? value <= MAX_TARGET_ABSOLUTE_CENTS : value <= MAX_TARGET_PERCENT_DROP;
}

export function isValidRearmCooldownHours(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) &&
    value >= MIN_REARM_COOLDOWN_HOURS && value <= MAX_REARM_COOLDOWN_HOURS
  );
}

export function isValidPriceAlertCanSellViaHub(value: unknown): value is number | null {
  return value === null || value === 0 || value === 1;
}

function toPriceAlert(row: {
  id: string | number; blueprint_id: number; language: string | null; condition: string | null;
  can_sell_via_hub: number | null; target_type: PriceAlertTargetType; target_value: number;
  baseline_price_cents: number | null; baseline_currency: string | null;
  baseline_captured_at: Date | string | null; fire_mode: PriceAlertFireMode;
  rearm_cooldown_hours: number | null; state: PriceAlertState; fired_at: Date | string | null;
  created_at: Date | string;
}): PriceAlert {
  return {
    id: Number(row.id),
    blueprintId: row.blueprint_id,
    language: row.language,
    condition: row.condition,
    canSellViaHub: row.can_sell_via_hub,
    targetType: row.target_type,
    targetValue: row.target_value,
    baselinePriceCents: row.baseline_price_cents,
    baselineCurrency: row.baseline_currency,
    baselineCapturedAt: row.baseline_captured_at instanceof Date
      ? row.baseline_captured_at.toISOString() : row.baseline_captured_at,
    fireMode: row.fire_mode,
    rearmCooldownHours: row.rearm_cooldown_hours,
    state: row.state,
    firedAt: row.fired_at instanceof Date ? row.fired_at.toISOString() : row.fired_at,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

/** Inserzione piu' economica per un profilo ESATTO (lingua/condizione/hub,
 * ognuno opzionale - NULL = nessun vincolo su quel campo) - MAI un fallback
 * su un profilo diverso da quello richiesto, stesso principio di
 * _exact_it_nm_zero_matches in scripts/db.py. Usata sia per fissare
 * baseline_price_cents alla creazione di un allarme, sia (in futuro, punto
 * 4c) dal worker di valutazione per leggere il prezzo attuale dello stesso
 * identico profilo. */
async function findMatchingListingPrice(
  blueprintId: number,
  language: string | null,
  condition: string | null,
  canSellViaHub: number | null
): Promise<{ priceCents: number; currency: string | null } | null> {
  const pool = getPgPool();
  const conditions = ["blueprint_id = $1"];
  const params: unknown[] = [blueprintId];
  if (language !== null) {
    params.push(language);
    conditions.push(`language = $${params.length}`);
  }
  if (condition !== null) {
    params.push(condition);
    conditions.push(`condition = $${params.length}`);
  }
  if (canSellViaHub !== null) {
    params.push(canSellViaHub);
    conditions.push(`can_sell_via_hub = $${params.length}`);
  }
  const { rows } = await pool.query(
    `SELECT price_cents, price_currency FROM price_listings
     WHERE ${conditions.join(" AND ")}
     ORDER BY price_cents ASC LIMIT 1`,
    params
  );
  if (rows.length === 0) return null;
  return { priceCents: rows[0].price_cents, currency: rows[0].price_currency };
}

export async function getPriceAlerts(userId: string): Promise<PriceAlert[]> {
  const pool = getPgPool();
  const { rows } = await pool.query(
    "SELECT * FROM price_alerts WHERE user_id = $1 ORDER BY created_at DESC",
    [userId]
  );
  return rows.map(toPriceAlert);
}

/** Crea un allarme, fissando baseline_price_cents/baseline_captured_at UNA
 * VOLTA SOLA leggendo il prezzo attuale dell'identico profilo scelto (mai
 * ricalcolato piu' avanti, vedi web/db/schema.sql). Per target_type
 * "percent_drop" un profilo senza nessuna inserzione al momento della
 * creazione e' un errore esplicito (non c'e' nessun riferimento da cui
 * calcolare un calo percentuale) - per "absolute_cents" e' invece
 * consentito, la soglia resta valida anche senza un baseline. */
export async function createPriceAlert(userId: string, input: PriceAlertInput): Promise<PriceAlert> {
  const language = input.language ?? null;
  const condition = input.condition ?? null;
  const canSellViaHub = input.canSellViaHub ?? null;
  const fireMode = input.fireMode ?? "once";
  const rearmCooldownHours = fireMode === "rearm" ? (input.rearmCooldownHours ?? null) : null;

  const matching = await findMatchingListingPrice(input.blueprintId, language, condition, canSellViaHub);
  if (input.targetType === "percent_drop" && !matching) {
    throw new PriceAlertValidationError(
      "Nessuna inserzione trovata per questo identico profilo (lingua/condizione/hub): impossibile calcolare un calo percentuale senza un prezzo di riferimento. Scegli un profilo con almeno un'inserzione attiva, oppure usa una soglia di prezzo assoluta."
    );
  }

  const pool = getPgPool();
  try {
    const { rows } = await pool.query(
      `INSERT INTO price_alerts (
         user_id, blueprint_id, language, condition, can_sell_via_hub,
         target_type, target_value, baseline_price_cents, baseline_currency,
         baseline_captured_at, fire_mode, rearm_cooldown_hours
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        userId, input.blueprintId, language, condition, canSellViaHub,
        input.targetType, input.targetValue,
        matching?.priceCents ?? null, matching?.currency ?? null,
        matching ? new Date() : null,
        fireMode, rearmCooldownHours,
      ]
    );
    return toPriceAlert(rows[0]);
  } catch (err) {
    // 23503 = violazione di foreign key: un blueprintId sintatticamente
    // valido (intero positivo, supera la validazione della route) ma
    // inesistente nel catalogo - senza findMatchingListingPrice() a
    // fare da controllo implicito (per absolute_cents senza nessun
    // match "matching" e' gia' null a prescindere, quindi non lo
    // intercetta prima) l'unico punto che se ne accorge e' l'INSERT
    // stesso. Rilievo di review su questa PR: senza questo catch, un
    // blueprintId inesistente arrivava fino a un'eccezione Postgres non
    // gestita (500) invece di un 400 chiaro.
    if ((err as { code?: string }).code === "23503") {
      throw new PriceAlertValidationError("Carta non trovata.");
    }
    throw err;
  }
}

export async function deletePriceAlert(userId: string, id: number): Promise<void> {
  const pool = getPgPool();
  await pool.query("DELETE FROM price_alerts WHERE user_id = $1 AND id = $2", [userId, id]);
}

/** Attiva/disattiva manualmente un allarme - un cambio di stato diretto
 * dell'utente, distinto dalle transizioni automatiche armed->fired->armed
 * del worker di valutazione (sotto-parte 4c, non ancora presente): qui
 * "enabled" forza sempre lo stato a 'armed' o 'disabled', a prescindere da
 * dove si trovasse prima (anche ri-armare manualmente un allarme "fired"
 * one-shot e' un'azione legittima dell'utente). */
export async function setPriceAlertEnabled(userId: string, id: number, enabled: boolean): Promise<PriceAlert | null> {
  const pool = getPgPool();
  const { rows } = await pool.query(
    `UPDATE price_alerts SET state = $3 WHERE user_id = $1 AND id = $2 RETURNING *`,
    [userId, id, enabled ? "armed" : "disabled"]
  );
  return rows.length > 0 ? toPriceAlert(rows[0]) : null;
}

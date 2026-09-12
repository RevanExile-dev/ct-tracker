import "server-only";
import { getPgPool } from "./pgPool";
import type { BinderEntry } from "./binder";
import type { FilterPreset } from "./filterPreset";
import type { BinderValuePoint, Lot, LotEvent, LotInput, LotProvenance } from "./types";

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

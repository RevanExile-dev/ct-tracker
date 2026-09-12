import "server-only";
import { getPgPool } from "./pgPool";
import type { BinderEntry } from "./binder";
import type { FilterPreset } from "./filterPreset";
import type { BinderValuePoint } from "./types";

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

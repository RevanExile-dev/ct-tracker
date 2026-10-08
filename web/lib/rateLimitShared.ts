import "server-only";
import { getPgPool } from "@/lib/pgPool";

// Rate limiting condiviso tra tutte le istanze serverless, appoggiato al
// Postgres gia' in uso (nessun servizio nuovo da pagare o configurare). Una
// riga per (chiave, finestra fissa) con un contatore incrementato da un solo
// UPSERT atomico: costa una scrittura per richiesta, quindi va usato solo per
// le azioni rare e sensibili (invio email di accesso, import lotti), non per
// le letture pubbliche: quelle sono coperte dalla cache della CDN e dal
// limite in memoria di lib/rateLimit.ts.
//
// Se il database non risponde il limite "fallisce aperto" (la richiesta passa
// e resta il limite in memoria): un guasto di Neon non deve bloccare il login.

let tableReady: Promise<void> | null = null;

function ensureTable(): Promise<void> {
  tableReady ??= getPgPool()
    .query(
      `CREATE TABLE IF NOT EXISTS rate_limits (
         key TEXT NOT NULL,
         window_start BIGINT NOT NULL,
         hits INTEGER NOT NULL DEFAULT 0,
         PRIMARY KEY (key, window_start)
       )`,
    )
    .then(() => undefined)
    .catch((err) => {
      tableReady = null;
      throw err;
    });
  return tableReady;
}

/** true se la chiave ha superato il limite nella finestra corrente su QUALUNQUE istanza. */
export async function isRateLimitedShared(key: string, limit: number, windowMs: number): Promise<boolean> {
  try {
    await ensureTable();
    const pool = getPgPool();
    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const { rows } = await pool.query<{ hits: number }>(
      `INSERT INTO rate_limits (key, window_start, hits) VALUES ($1, $2, 1)
       ON CONFLICT (key, window_start) DO UPDATE SET hits = rate_limits.hits + 1
       RETURNING hits`,
      [key, windowStart],
    );
    // Pulizia a campione delle sole righe di questa tabella piu' vecchie di
    // un'ora, cosi' resta di poche righe senza bisogno di un job a parte.
    if (Math.random() < 0.01) {
      void pool.query("DELETE FROM rate_limits WHERE window_start < $1", [now - 3_600_000]).catch(() => {});
    }
    return rows[0].hits > limit;
  } catch (err) {
    console.error("rate limit condiviso non disponibile, uso solo il limite locale:", err);
    return false;
  }
}

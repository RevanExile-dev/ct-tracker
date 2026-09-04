import { Pool } from "pg";

// Un solo pool condiviso per l'intero processo serverless (non uno per
// richiesta): pg.Pool gestisce gia' da solo il riutilizzo/chiusura delle
// connessioni verso Postgres. POSTGRES_URL e' il nome che Vercel usa per
// la stringa di connessione pooled (via pgbouncer) quando colleghi un
// database Postgres al progetto - la stessa che serve sia all'adapter di
// Auth.js sia alle query applicative delle fasi successive (binder,
// wishlist, filtri salvati).
let pool: Pool | null = null;

export function getPgPool(): Pool {
  if (!pool) {
    const connectionString = process.env.POSTGRES_URL;
    if (!connectionString) {
      throw new Error(
        "POSTGRES_URL non impostata: collega un database Postgres al progetto Vercel (Storage -> Create Database) prima di usare il login."
      );
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

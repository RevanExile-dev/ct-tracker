import { Pool } from "pg";

// Un solo pool condiviso per l'intero processo serverless (non uno per
// richiesta): pg.Pool gestisce gia' da solo il riutilizzo/chiusura delle
// connessioni verso Postgres. POSTGRES_URL e' il nome che Vercel usa per
// la stringa di connessione pooled (via pgbouncer) quando colleghi un
// database Postgres al progetto - la stessa che serve sia all'adapter di
// Auth.js sia alle query applicative delle fasi successive (binder,
// wishlist, filtri salvati).
//
// Salvato su globalThis (non una semplice variabile di modulo): in
// locale "next dev" ricarica i moduli server ad ogni salvataggio (Fast
// Refresh) senza chiudere il Pool precedente - una variabile di modulo
// verrebbe reinizializzata ad ogni giro, aprendo connessioni Postgres
// nuove senza mai richiudere le vecchie fino a "too many connections"
// (bug reale segnalato in review, stesso motivo per cui Prisma/altri
// client DB raccomandano questo pattern per Next.js). In produzione
// (funzioni serverless Vercel, un processo per invocazione/istanza calda,
// niente Fast Refresh) globalThis si comporta comunque come una normale
// variabile di modulo - nessuna differenza pratica li'.
const globalForPg = globalThis as unknown as { pgPool?: Pool };

export function getPgPool(): Pool {
  if (!globalForPg.pgPool) {
    const connectionString = process.env.POSTGRES_URL;
    if (!connectionString) {
      throw new Error(
        "POSTGRES_URL non impostata: collega un database Postgres al progetto Vercel (Storage -> Create Database) prima di usare il login."
      );
    }
    globalForPg.pgPool = new Pool({ connectionString });
  }
  return globalForPg.pgPool;
}

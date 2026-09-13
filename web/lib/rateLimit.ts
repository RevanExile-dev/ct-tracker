// Rate limiting in-memory, best-effort: vale per singola istanza
// serverless (Node runtime), non e' distribuito - servirebbe
// Redis/Upstash per un limite realmente globale. Usato sia da proxy.ts
// (route API sotto /api/*) sia direttamente dentro la Server Action di
// login via email (app/login/page.tsx): quella Server Action e' una POST
// verso /login gestita dal protocollo interno di Next.js, non verso
// /api/auth/signin, quindi il matcher di proxy.ts non la intercetta -
// verificato leggendo la Server Action reale (`"use server"` come action
// del <form>), non per supposizione.
const hits = new Map<string, number[]>();

// La finestra piu' larga usata da un chiamante: uno sweep periodico basato
// su questo valore evita che la Map cresca senza limite (una entry per IP
// mai piu' visto) per tutta la vita di un'istanza a lungo termine.
const MAX_WINDOW_MS = 60_000;
const SWEEP_INTERVAL_MS = 5 * 60_000;
let lastSweep = Date.now();

function sweep(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, timestamps] of hits) {
    const stillRelevant = timestamps.some((t) => now - t < MAX_WINDOW_MS);
    if (!stillRelevant) hits.delete(key);
  }
}

/** true se la chiave ha gia' raggiunto il limite nella finestra data (richiesta da rifiutare). */
export function isRateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  sweep(now);
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  return false;
}

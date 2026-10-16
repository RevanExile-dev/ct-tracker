// Errori in cui la query NON e' mai partita (connessione non stabilita): solo
// questi si possono ripetere senza rischiare di eseguire due volte una
// scrittura. Un errore a meta' query (ECONNRESET, "Connection terminated")
// resta fuori di proposito.
const CONNECT_ERROR_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"]);

// Messaggi di pg-pool per il timeout di connessione (coda piena o connessione
// non stabilita entro connectionTimeoutMillis).
const CONNECT_ERROR_MESSAGES = [
  "timeout exceeded when trying to connect",
  "Connection terminated due to connection timeout",
];

export function isConnectFailure(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { message?: unknown; code?: unknown; syscall?: unknown };
  if (typeof e.message === "string" && CONNECT_ERROR_MESSAGES.some((m) => (e.message as string).includes(m))) return true;
  if (typeof e.code === "string" && CONNECT_ERROR_CODES.has(e.code)) return true;
  return e.syscall === "connect";
}

/** Esegue `run`; se fallisce per un errore di connessione, la ripete UNA volta. */
export async function withConnectRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (!isConnectFailure(err)) throw err;
    return run();
  }
}

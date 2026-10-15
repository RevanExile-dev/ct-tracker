import "server-only";
import { randomBytes } from "crypto";
import { getPgPool } from "./pgPool";
import { fetchCards, fetchOwnedLanguagePrices } from "./db.server";
import {
  SHARE_TOKEN_BYTES, isShareKind, isValidShareToken, type ShareKind,
} from "./shareToken";

// Link di sola lettura al proprio binder / alla propria lista desideri.
//
// Cosa vede chi apre il link (e solo questo): nome, set, versione, rarita',
// immagine, quantita', lingua e finitura delle copie, prezzo di mercato
// attuale e il totale. MAI: email, nome dell'account, id utente, costi di
// acquisto/lotti/plusvalenza, date di aggiunta, allarmi, altri link.
//
// Sicurezza: il token (192 bit casuali) e' l'unico segreto; la forma viene
// controllata prima di toccare il database; un link per utente e tipo,
// rigenerato = vecchio token morto subito; revocato = riga cancellata.

export type ShareLink = { kind: ShareKind; token: string; title: string | null; createdAt: string };

export type SharedCard = {
  id: number;
  name: string;
  version: string | null;
  expansionName: string;
  imageUrl: string | null;
  rarity: string | null;
  quantity: number;
  language: string | null;
  finish: string | null;
  cents: number | null;
  currency: string;
};

export type SharedCollection = {
  kind: ShareKind;
  title: string | null;
  cards: SharedCard[]; // ordinate per valore (prezzo x quantita') decrescente
  totalCents: number;
  totalCopies: number;
  pricedCount: number;
  currency: string;
};

let tableReady: Promise<void> | null = null;

/** Stesso DDL di web/db/schema.sql (IF NOT EXISTS): la tabella esiste anche
 * se il prossimo sync, che riapplica lo schema, non e' ancora passato. */
function ensureTable(): Promise<void> {
  tableReady ??= getPgPool()
    .query(
      `CREATE TABLE IF NOT EXISTS share_links (
         token TEXT PRIMARY KEY,
         user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
         kind TEXT NOT NULL CHECK (kind IN ('binder', 'wishlist')),
         title TEXT,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         UNIQUE (user_id, kind)
       )`,
    )
    .then(() => undefined)
    .catch((err) => {
      tableReady = null;
      throw err;
    });
  return tableReady;
}

type LinkRow = { token: string; kind: string; title: string | null; created_at: Date | string };

function toLink(row: LinkRow): ShareLink {
  return {
    kind: row.kind as ShareKind,
    token: row.token,
    title: row.title,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

export async function getShareLinks(userId: string): Promise<ShareLink[]> {
  await ensureTable();
  const { rows } = await getPgPool().query<LinkRow>(
    "SELECT token, kind, title, created_at FROM share_links WHERE user_id = $1 ORDER BY kind",
    [userId],
  );
  return rows.map(toLink);
}

/** Crea il link (o lo rigenera: il token precedente smette subito di
 * funzionare). Un solo UPSERT atomico sulla coppia (utente, tipo). */
export async function createShareLink(userId: string, kind: ShareKind, title: string | null): Promise<ShareLink> {
  await ensureTable();
  const token = randomBytes(SHARE_TOKEN_BYTES).toString("base64url");
  const { rows } = await getPgPool().query<LinkRow>(
    `INSERT INTO share_links (token, user_id, kind, title) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, kind) DO UPDATE
       SET token = EXCLUDED.token, title = EXCLUDED.title, created_at = now()
     RETURNING token, kind, title, created_at`,
    [token, userId, kind, title],
  );
  forgetCachedCollections(userId);
  return toLink(rows[0]);
}

export async function revokeShareLink(userId: string, kind: ShareKind): Promise<void> {
  await ensureTable();
  await getPgPool().query("DELETE FROM share_links WHERE user_id = $1 AND kind = $2", [userId, kind]);
  forgetCachedCollections(userId);
}

// Cache in memoria per istanza: una pagina condivisa e' aperta di colpo da
// tutti gli amici (e dai crawler delle anteprime, che chiedono pagina e
// immagine), quindi senza cache ogni apertura rifarebbe 3 query su Neon.
// TTL breve = una revoca vale al piu' dopo SHARE_CACHE_TTL_MS anche sulle
// istanze che non hanno visto la revoca (su quella che la riceve e' subito).
// I "non trovato" NON si mettono in cache: un indirizzo inventato costa una
// sola query sulla chiave primaria e non puo' riempire la memoria.
const SHARE_CACHE_TTL_MS = 30_000;
const SHARE_CACHE_MAX_ENTRIES = 40;
type CacheEntry = { expires: number; userId: string; value: Promise<SharedCollection | null> };
const cache = new Map<string, CacheEntry>();

// Contatore delle revoche/rigenerazioni: una lettura gia' partita prima di
// una revoca non deve rimettere in cache il link appena spento.
let invalidations = 0;

function forgetCachedCollections(userId: string): void {
  invalidations++;
  for (const [token, entry] of cache) if (entry.userId === userId) cache.delete(token);
}

async function loadSharedCollection(token: string): Promise<{ userId: string; value: SharedCollection } | null> {
  await ensureTable();
  const pool = getPgPool();
  const { rows } = await pool.query<{ user_id: string; kind: string; title: string | null }>(
    "SELECT user_id, kind, title FROM share_links WHERE token = $1",
    [token],
  );
  const link = rows[0];
  if (!link || !isShareKind(link.kind)) return null;

  type Entry = { id: number; quantity: number; language: string | null; finish: string | null };
  let entries: Entry[];
  if (link.kind === "binder") {
    const res = await pool.query<{ blueprint_id: number; data: Record<string, unknown> | null }>(
      "SELECT blueprint_id, data FROM binder_cards WHERE user_id = $1",
      [link.user_id],
    );
    entries = res.rows.map((r) => {
      const d = r.data ?? {};
      const q = d.quantity;
      return {
        id: r.blueprint_id,
        quantity: typeof q === "number" && Number.isInteger(q) && q >= 1 && q <= 999 ? q : 1,
        language: typeof d.language === "string" ? d.language : null,
        finish: typeof d.finish === "string" && d.finish !== "unknown" ? d.finish : null,
      };
    });
  } else {
    const res = await pool.query<{ blueprint_id: number }>(
      "SELECT blueprint_id FROM wishlist_cards WHERE user_id = $1",
      [link.user_id],
    );
    entries = res.rows.map((r) => ({ id: r.blueprint_id, quantity: 1, language: null, finish: null }));
  }

  const rowsById = new Map((entries.length ? await fetchCards({ ids: entries.map((e) => e.id) }) : []).map((c) => [c.id, c]));
  // Binder: stesso prezzo della pagina del proprietario (nella lingua
  // posseduta quando nota e disponibile, altrimenti il "best"), cosi' il
  // totale che vede l'amico coincide con quello del proprietario.
  const languagePrices = link.kind === "binder"
    ? await fetchOwnedLanguagePrices(entries.filter((e) => e.language).map((e) => ({ blueprintId: e.id, language: e.language as string })))
    : {};

  const cards: SharedCard[] = [];
  for (const entry of entries) {
    const card = rowsById.get(entry.id);
    if (!card) continue;
    const lang = entry.language ? languagePrices[`${entry.id}:${entry.language}`] : undefined;
    const cents = lang ? lang.price_cents : (card.best_price_cents ?? card.latest_price_cents);
    const currency = (lang ? lang.price_currency : (card.best_price_currency ?? card.latest_price_currency)) ?? "EUR";
    cards.push({
      id: card.id, name: card.name, version: card.version, expansionName: card.expansion_name,
      imageUrl: card.image_url, rarity: card.rarity, quantity: entry.quantity,
      language: entry.language, finish: entry.finish, cents: cents && cents > 0 ? cents : null, currency,
    });
  }
  const value = (c: SharedCard) => (c.cents ?? 0) * c.quantity;
  cards.sort((a, b) => value(b) - value(a) || a.name.localeCompare(b.name, "it"));

  const priced = cards.filter((c) => c.cents !== null);
  return {
    userId: link.user_id,
    value: {
      kind: link.kind,
      title: link.title,
      cards,
      totalCents: priced.reduce((sum, c) => sum + value(c), 0),
      totalCopies: cards.reduce((sum, c) => sum + c.quantity, 0),
      pricedCount: priced.length,
      currency: priced[0]?.currency ?? "EUR",
    },
  };
}

/** Il contenuto pubblico di un link, o null se il token non esiste / e'
 * stato revocato (o ha una forma impossibile: nessuna query). */
export function getSharedCollection(token: string): Promise<SharedCollection | null> {
  if (!isValidShareToken(token)) return Promise.resolve(null);
  const now = Date.now();
  const hit = cache.get(token);
  if (hit && hit.expires > now) return hit.value;
  cache.delete(token);

  const startedAt = invalidations;
  const loading = loadSharedCollection(token);
  const value = loading.then((r) => r?.value ?? null);
  // Solo i risultati trovati restano in cache; errori e "non trovato" no.
  loading.then((r) => {
    if (!r || startedAt !== invalidations) return;
    if (cache.size >= SHARE_CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
    cache.set(token, { expires: now + SHARE_CACHE_TTL_MS, userId: r.userId, value });
  }).catch(() => {});
  return value;
}

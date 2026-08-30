"use client";

import initSqlJs, { Database, SqlJsStatic } from "sql.js";

let sqlJsPromise: Promise<SqlJsStatic> | null = null;
let dbPromise: Promise<Database> | null = null;
let historyDbPromise: Promise<Database> | null = null;

function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({
      // Il file .wasm viene copiato in public/ dallo script postinstall
      // (vedi package.json) cosi' non serve un bundler dedicato.
      locateFile: (file: string) => `/sqljs/${file}`,
    });
  }
  return sqlJsPromise;
}

/** Catalogo + solo l'ultimo prezzo noto di ogni carta: file piccolo,
 * scaricato ad ogni visita del sito (serve per la griglia). */
export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const [SQL, res] = await Promise.all([
        getSqlJs(),
        // "no-cache" (non "no-store"): il browser puo' comunque tenere il
        // file in cache, ma deve rivalidarlo con una richiesta condizionale
        // (ETag/Last-Modified) prima di riusarlo. Se il DB non e' cambiato
        // da allora arriva un 304 senza riscaricare i ~10-11MB, se e'
        // cambiato (nuovo sync) arriva il file fresco: il meglio di
        // entrambi, invece di scaricare sempre tutto anche a distanza di
        // pochi minuti nella stessa sessione di navigazione.
        fetch("/data/cardtrader.db", { cache: "no-cache" }),
      ]);
      if (!res.ok) {
        throw new Error(
          "Database non trovato in /data/cardtrader.db. Il workflow di sync lo ha già copiato in web/public/data/?"
        );
      }
      const buf = await res.arrayBuffer();
      return new SQL.Database(new Uint8Array(buf));
    })();
  }
  return dbPromise;
}

/** Storico giorno-per-giorno dei prezzi: file separato (cresce nel tempo),
 * scaricato solo quando serve davvero (pagina di dettaglio di una carta),
 * non per navigare la griglia principale. */
export function getHistoryDb(): Promise<Database> {
  if (!historyDbPromise) {
    historyDbPromise = (async () => {
      const [SQL, res] = await Promise.all([
        getSqlJs(),
        fetch("/data/price_history.db", { cache: "no-cache" }),
      ]);
      if (!res.ok) {
        throw new Error("Storico prezzi non trovato in /data/price_history.db.");
      }
      const buf = await res.arrayBuffer();
      return new SQL.Database(new Uint8Array(buf));
    })();
  }
  return historyDbPromise;
}

import { compareExpansions } from "./expansions";

export type CardRow = {
  id: number;
  name: string;
  version: string | null;
  expansion_code: string;
  expansion_name: string;
  image_url: string | null;
  rarity: string | null;
  is_premium: number;
  latest_price_cents: number | null;
  latest_price_currency: string | null;
  latest_listings: number | null;
  latest_language: string | null;
  prev_price_cents: number | null;
  languages_available: string | null;
  // Prezzo "migliore" (Near Mint + CardTrader Zero quando esiste, altrimenti
  // a cascata Zero/Near Mint/piu' economico in assoluto — vedi
  // _pick_best_listing in scripts/db.py). NULL finche' una carta non e'
  // stata ripassata dal sync che calcola questo campo: usare sempre con
  // fallback a latest_price_cents nei componenti.
  best_price_cents: number | null;
  best_price_currency: string | null;
  best_condition: string | null;
  best_language: string | null;
  best_can_sell_via_hub: number | null;
  prev_best_price_cents: number | null;
  // Presenti SOLO quando fetchCards() ha almeno un filtro lingua/condizione/
  // Zero attivo (vedi hasListingFilter): la piu' economica tra le inserzioni
  // che rispettano TUTTI quei filtri insieme, cosi' il prezzo mostrato non
  // "tradisce" il filtro scelto mostrando una lingua/condizione diversa.
  filtered_price_cents?: number | null;
  filtered_price_currency?: string | null;
  filtered_condition?: string | null;
  filtered_language?: string | null;
  filtered_can_sell_via_hub?: number | null;
};

export type SortOption =
  | "expansion"
  | "price_asc"
  | "price_desc"
  | "name"
  | "drop_first"
  | "rise_first";

const CARD_ROW_SELECT = `
  b.id, b.name, b.version, b.expansion_code, b.expansion_name,
  b.image_url, b.rarity, b.is_premium,
  lp.min_price_cents AS latest_price_cents,
  lp.min_price_currency AS latest_price_currency,
  lp.listings_count AS latest_listings,
  lp.cheapest_language AS latest_language,
  lp.prev_price_cents AS prev_price_cents,
  lp.languages_available AS languages_available,
  lp.best_price_cents AS best_price_cents,
  lp.best_price_currency AS best_price_currency,
  lp.best_condition AS best_condition,
  lp.best_language AS best_language,
  lp.best_can_sell_via_hub AS best_can_sell_via_hub,
  lp.prev_best_price_cents AS prev_best_price_cents
`;

/** Elenco carte con l'ultimo prezzo noto e quello precedente (per la freccina su/giù). */
export async function fetchCards(opts: {
  search?: string;
  expansionCode?: string;
  rarities?: string[];
  languages?: string[];
  conditions?: string[];
  onlyZero?: boolean;
  sortBy?: SortOption;
  // Applica LIMIT direttamente in SQL invece di scaricare tutte le righe
  // e tagliare in JS: sicuro SOLO per sortBy che ordinano gia' le righe
  // "valide" prima di quelle scartate a valle (vedi drop_first/rise_first,
  // il CASE WHEN le mette in coda) - altrimenti un LIMIT prematuro
  // rischierebbe di tagliare via righe che poi sarebbero risultate valide.
  limit?: number;
}): Promise<CardRow[]> {
  const db = await getDb();

  const where: string[] = [];
  const params: Record<string, string | number> = {};

  if (opts.search) {
    where.push("b.name LIKE $search");
    params["$search"] = `%${opts.search}%`;
  }
  if (opts.expansionCode) {
    where.push("b.expansion_code = $expansionCode");
    params["$expansionCode"] = opts.expansionCode;
  }
  if (opts.rarities && opts.rarities.length > 0) {
    const placeholders = opts.rarities.map((_, i) => `$rarity${i}`).join(", ");
    opts.rarities.forEach((r, i) => (params[`$rarity${i}`] = r));
    where.push(`b.rarity IN (${placeholders})`);
  }
  // Lingua/condizione/Zero filtrano tutti sulle stesse inserzioni salvate
  // (price_listings, fino a 25 per carta): usiamo UN SOLO set di criteri
  // condivisi cosi' che il prezzo mostrato (filteredPrice piu' sotto) sia
  // sempre relativo a un'inserzione che li soddisfa TUTTI insieme, non a
  // "la carta ha *una* inserzione IT e *un'altra* NM Zero, magari in
  // giapponese" — bug reale: filtrando IT+NM+Zero uscivano carte con
  // best_price_cents (calcolato senza filtri) in un'altra lingua.
  const listingFilters: string[] = [];
  if (opts.languages && opts.languages.length > 0) {
    const placeholders = opts.languages.map((_, i) => `$lflang${i}`).join(", ");
    opts.languages.forEach((l, i) => (params[`$lflang${i}`] = l));
    listingFilters.push(`pl.language IN (${placeholders})`);
  }
  if (opts.conditions && opts.conditions.length > 0) {
    const placeholders = opts.conditions.map((_, i) => `$lfcond${i}`).join(", ");
    opts.conditions.forEach((c, i) => (params[`$lfcond${i}`] = c));
    listingFilters.push(`pl.condition IN (${placeholders})`);
  }
  if (opts.onlyZero) listingFilters.push("pl.can_sell_via_hub = 1");

  const hasListingFilter = listingFilters.length > 0;
  if (hasListingFilter) {
    // Solo le carte che hanno ALMENO UNA inserzione che rispetta TUTTI i
    // criteri insieme (non una per criterio).
    where.push(
      `b.id IN (SELECT pl.blueprint_id FROM price_listings pl WHERE ${listingFilters.join(" AND ")})`
    );
  }

  // best_price_cents (Near Mint + CardTrader Zero quando esiste) e' il
  // prezzo "vero" da mostrare/ordinare; COALESCE su latest_price_cents e'
  // solo una rete di sicurezza per le carte non ancora ripassate dal sync
  // che popola best_price_cents. Se pero' e' attivo un filtro lingua/
  // condizione/Zero, il prezzo mostrato deve venire da un'inserzione che
  // rispetta QUEL filtro (filtered_price_cents, dal LEFT JOIN qui sotto),
  // altrimenti si rischia di filtrare per IT e mostrare comunque il prezzo
  // migliore in giapponese perche' quello e' il piu' economico assoluto.
  const priceExpr = hasListingFilter
    ? "COALESCE(filtered_price_cents, best_price_cents, latest_price_cents)"
    : "COALESCE(best_price_cents, latest_price_cents)";
  const prevPriceExpr = "COALESCE(prev_best_price_cents, prev_price_cents)";

  let orderBy = "b.expansion_id DESC, b.name ASC";
  if (opts.sortBy === "price_asc") orderBy = `${priceExpr} IS NULL, ${priceExpr} ASC`;
  if (opts.sortBy === "price_desc") orderBy = `${priceExpr} IS NULL, ${priceExpr} DESC`;
  if (opts.sortBy === "name") orderBy = "b.name ASC";
  if (opts.sortBy === "drop_first") {
    // Piu' grande calo percentuale prima; le carte senza prezzo precedente
    // (o senza variazione) restano in fondo.
    orderBy = `
      CASE WHEN ${priceExpr} IS NULL OR ${prevPriceExpr} IS NULL OR ${prevPriceExpr} = 0 THEN 1 ELSE 0 END,
      (CAST(${priceExpr} AS REAL) - ${prevPriceExpr}) / ${prevPriceExpr} ASC
    `;
  }
  if (opts.sortBy === "rise_first") {
    // Speculare a drop_first: piu' grande rialzo percentuale prima.
    orderBy = `
      CASE WHEN ${priceExpr} IS NULL OR ${prevPriceExpr} IS NULL OR ${prevPriceExpr} = 0 THEN 1 ELSE 0 END,
      (CAST(${priceExpr} AS REAL) - ${prevPriceExpr}) / ${prevPriceExpr} DESC
    `;
  }

  // Inserzione piu' economica tra quelle che rispettano TUTTI i filtri
  // lingua/condizione/Zero insieme (ROW_NUMBER + rn=1 = la piu' economica
  // per carta), solo quando almeno uno di questi filtri e' attivo — cosi'
  // il percorso senza filtri resta leggero come prima.
  const filteredJoin = hasListingFilter
    ? `LEFT JOIN (
         SELECT blueprint_id, price_cents, price_currency, condition, language, can_sell_via_hub,
                -- A parita' di prezzo (due inserzioni allo stesso prezzo
                -- esatto) l'ordine di ORDER BY price_cents ASC da solo non
                -- e' deterministico: preferisce Zero, poi la riga piu'
                -- vecchia (id), cosi' il risultato non "sfarfalla" tra un
                -- caricamento e l'altro.
                ROW_NUMBER() OVER (
                  PARTITION BY blueprint_id
                  ORDER BY price_cents ASC, can_sell_via_hub DESC, id ASC
                ) AS rn
         FROM price_listings pl
         WHERE ${listingFilters.join(" AND ")}
       ) fl ON fl.blueprint_id = b.id AND fl.rn = 1`
    : "";
  const filteredSelect = hasListingFilter
    ? `, fl.price_cents AS filtered_price_cents, fl.price_currency AS filtered_price_currency,
       fl.condition AS filtered_condition, fl.language AS filtered_language,
       fl.can_sell_via_hub AS filtered_can_sell_via_hub`
    : "";

  const sql = `
    SELECT ${CARD_ROW_SELECT}${filteredSelect}
    FROM blueprints b
    LEFT JOIN latest_prices lp ON lp.blueprint_id = b.id
    ${filteredJoin}
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY ${orderBy}
    ${opts.limit ? `LIMIT $limit` : ""}
  `;
  if (opts.limit) params["$limit"] = opts.limit;

  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows: CardRow[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as CardRow);
  }
  stmt.free();
  return rows;
}

export type CardDetail = CardRow & {
  tcg_player_id: string | null;
  scryfall_id: string | null;
};

export async function fetchCardDetail(id: number): Promise<CardDetail | null> {
  const db = await getDb();
  const stmt = db.prepare(`
    SELECT ${CARD_ROW_SELECT}, b.tcg_player_id, b.scryfall_id
    FROM blueprints b
    LEFT JOIN latest_prices lp ON lp.blueprint_id = b.id
    WHERE b.id = $id
  `);
  stmt.bind({ $id: id });
  let row: CardDetail | null = null;
  if (stmt.step()) row = stmt.getAsObject() as unknown as CardDetail;
  stmt.free();
  return row;
}

export type PricePoint = {
  captured_at: string;
  min_price_cents: number | null;
  avg_price_cents: number | null;
  listings_count: number;
};

/** Storico completo di una carta: scarica price_history.db solo alla prima
 * chiamata (non serve per navigare il catalogo, solo per il grafico). */
export async function fetchPriceHistory(blueprintId: number): Promise<PricePoint[]> {
  const db = await getHistoryDb();
  const stmt = db.prepare(`
    SELECT captured_at, min_price_cents, avg_price_cents, listings_count
    FROM price_snapshots
    WHERE blueprint_id = $id
    ORDER BY captured_at ASC
  `);
  stmt.bind({ $id: blueprintId });
  const rows: PricePoint[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as PricePoint);
  }
  stmt.free();
  return rows;
}

export type Listing = {
  price_cents: number;
  price_currency: string | null;
  condition: string | null;
  language: string | null;
  quantity: number | null;
  seller_username: string | null;
  can_sell_via_hub: number;
  ships_from_country: string | null;
};

/** Le migliori (piu' economiche) inserzioni live per una carta (fino a 25,
 * vedi replace_price_listings), con il flag "CardTrader Zero" (venditore
 * professionale con spedizione gestita da CardTrader) e il paese di
 * spedizione del venditore. */
export async function fetchBestListings(blueprintId: number): Promise<Listing[]> {
  const db = await getDb();
  const stmt = db.prepare(`
    SELECT price_cents, price_currency, condition, language, quantity,
           seller_username, can_sell_via_hub, ships_from_country
    FROM price_listings
    WHERE blueprint_id = $id
    ORDER BY price_cents ASC
  `);
  stmt.bind({ $id: blueprintId });
  const rows: Listing[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject() as unknown as Listing);
  stmt.free();
  return rows;
}

export type ExpansionInfo = { code: string; name: string; cardCount: number };

export async function fetchExpansions(): Promise<ExpansionInfo[]> {
  const db = await getDb();
  const stmt = db.prepare(
    `SELECT expansion_code AS code, expansion_name AS name, COUNT(*) AS cardCount
     FROM blueprints GROUP BY expansion_code, expansion_name`
  );
  const rows: ExpansionInfo[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject() as unknown as ExpansionInfo);
  stmt.free();
  // Piu' recenti prima quando conosciamo la data reale (vedi expansions.ts);
  // fallback sull'ordine approssimato per era per le altre.
  rows.sort(compareExpansions);
  return rows;
}

/** Statistiche generali del catalogo (carte tracciate, quante hanno un
 * prezzo noto) — solo un paio di COUNT(*), niente lettura riga-per-riga. */
export async function fetchCatalogStats(): Promise<{ totalCards: number; pricedCards: number }> {
  const db = await getDb();
  const totalRow = db.exec("SELECT COUNT(*) FROM blueprints")[0];
  const pricedRow = db.exec(
    "SELECT COUNT(*) FROM latest_prices WHERE min_price_cents IS NOT NULL"
  )[0];
  return {
    totalCards: (totalRow?.values[0][0] as number) ?? 0,
    pricedCards: (pricedRow?.values[0][0] as number) ?? 0,
  };
}

/** Condizioni distinte tra le inserzioni salvate, ordinate dalla migliore
 * alla peggiore (stessa scala usata da ConditionBadge). */
export async function fetchConditions(): Promise<string[]> {
  const db = await getDb();
  const order = ["Near Mint", "Slightly Played", "Moderately Played", "Played", "Poor"];
  const stmt = db.prepare(
    "SELECT DISTINCT condition FROM price_listings WHERE condition IS NOT NULL AND condition != ''"
  );
  const rows: string[] = [];
  while (stmt.step()) rows.push((stmt.getAsObject() as any).condition);
  stmt.free();
  return rows.sort((a, b) => {
    const ra = order.indexOf(a), rb = order.indexOf(b);
    return (ra === -1 ? order.length : ra) - (rb === -1 ? order.length : rb);
  });
}

export async function fetchRarities(): Promise<string[]> {
  const db = await getDb();
  const stmt = db.prepare(
    "SELECT DISTINCT rarity FROM blueprints WHERE rarity IS NOT NULL ORDER BY rarity"
  );
  const rows: string[] = [];
  while (stmt.step()) rows.push((stmt.getAsObject() as any).rarity);
  stmt.free();
  return rows;
}

/** Tutte le lingue disponibili su almeno una carta (non solo quella della
 * piu' economica): languages_available e' un elenco delimitato per carta
 * (",en,it,jp,"), qui lo scomponiamo per costruire l'insieme completo. */
export async function fetchLanguages(): Promise<string[]> {
  const db = await getDb();
  const stmt = db.prepare(
    "SELECT DISTINCT languages_available AS langs FROM latest_prices WHERE languages_available IS NOT NULL"
  );
  const set = new Set<string>();
  while (stmt.step()) {
    const langs = (stmt.getAsObject() as any).langs as string;
    langs.split(",").forEach((l) => {
      if (l) set.add(l);
    });
  }
  stmt.free();
  return Array.from(set).sort();
}

export async function fetchMeta(): Promise<Record<string, string>> {
  const db = await getDb();
  const stmt = db.prepare("SELECT key, value FROM meta");
  const out: Record<string, string> = {};
  while (stmt.step()) {
    const row = stmt.getAsObject() as any;
    out[row.key] = row.value;
  }
  stmt.free();
  return out;
}

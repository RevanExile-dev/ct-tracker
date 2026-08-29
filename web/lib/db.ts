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
        fetch("/data/cardtrader.db", { cache: "no-store" }),
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
        fetch("/data/price_history.db", { cache: "no-store" }),
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

/**
 * CardTrader non fornisce una data di uscita per le espansioni: questo e' un
 * ordine APPROSSIMATO per era (Black & White -> Mega Evolution), dedotto dal
 * prefisso del code. All'interno della stessa era l'ordine non e' garantito
 * essere cronologico esatto.
 */
export function eraRank(code: string): number {
  const c = code.toLowerCase();
  const BW = new Set([
    "blw", "epo", "nvi", "nxd", "dex", "drx", "bcr", "pls", "plf", "plb",
    "ltr", "dcr", "bwbsp", "bwpr",
  ]);
  const XY = new Set([
    "xy-en", "flf", "ffi", "phf", "prc", "ros", "aor", "bkt", "gen", "bkp",
    "fco", "sts", "evo", "xybsp", "pxy",
  ]);
  const SM = new Set([
    "sum", "gri", "bus", "slg", "cinv", "upr", "fli", "ces", "drm", "lot",
    "teu", "det", "unb", "hif", "unm", "cec", "smbs", "sm-p",
  ]);
  const SWSH = new Set([
    "ssh", "rcl", "daa", "cpa", "viv", "shf", "bst", "cre", "evs", "c25",
    "fst", "brs", "astr", "pkmgo", "lorg", "sit", "crz", "swshbs", "s-p",
  ]);
  const SV = new Set([
    "svi", "pal", "obf", "mew", "par", "paf", "tef", "twm", "sfa", "scr",
    "ssp", "pre", "jtg", "dri", "blk", "wht", "svpromo", "promosv",
  ]);
  const MEGA = new Set(["meg", "mep", "pfl", "30c", "30th-ch", "asc"]);

  if (c.startsWith("bw") || BW.has(c)) return 0;
  if (c.startsWith("xy") || XY.has(c)) return 1;
  if (c.startsWith("sm") || SM.has(c)) return 2;
  if (c.startsWith("sv") || SV.has(c)) return 4; // prima di "s\d" cosi' non collide con SWSH
  if (/^s\d/.test(c) || SWSH.has(c)) return 3;
  if (/^m\d/.test(c) || MEGA.has(c)) return 5;
  return 6; // sconosciuto: in fondo
}

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
  sortBy?: SortOption;
}): Promise<CardRow[]> {
  const db = await getDb();

  const where: string[] = [];
  const params: Record<string, string> = {};

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
  if (opts.languages && opts.languages.length > 0) {
    // languages_available elenca TUTTE le lingue con almeno un'inserzione
    // attiva (formato ",en,it,jp,"), non solo quella della piu' economica:
    // una carta va mostrata anche se e' disponibile in quella lingua ma non
    // e' l'offerta piu' economica.
    const conds = opts.languages.map((_, i) => `lp.languages_available LIKE $lang${i}`);
    opts.languages.forEach((l, i) => (params[`$lang${i}`] = `%,${l},%`));
    where.push(`(${conds.join(" OR ")})`);
  }

  // best_price_cents (Near Mint + CardTrader Zero quando esiste) e' il
  // prezzo "vero" da mostrare/ordinare; COALESCE su latest_price_cents e'
  // solo una rete di sicurezza per le carte non ancora ripassate dal sync
  // che popola best_price_cents.
  const priceExpr = "COALESCE(best_price_cents, latest_price_cents)";
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

  const sql = `
    SELECT ${CARD_ROW_SELECT}
    FROM blueprints b
    LEFT JOIN latest_prices lp ON lp.blueprint_id = b.id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY ${orderBy}
  `;

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
  // Ordine approssimato per era (vedi eraRank): CardTrader non da' una data reale.
  rows.sort((a, b) => eraRank(a.code) - eraRank(b.code) || a.name.localeCompare(b.name));
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

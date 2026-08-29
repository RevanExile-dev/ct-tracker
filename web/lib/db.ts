"use client";

import initSqlJs, { Database, SqlJsStatic } from "sql.js";

let sqlJsPromise: Promise<SqlJsStatic> | null = null;
let dbPromise: Promise<Database> | null = null;

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
  prev_price_cents: number | null;
};

export type SortOption = "expansion" | "price_asc" | "price_desc" | "name";

/** Elenco carte con l'ultimo prezzo noto e quello precedente (per la freccina su/giù). */
export async function fetchCards(opts: {
  search?: string;
  expansionCode?: string;
  rarities?: string[];
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

  let orderBy = "b.expansion_id DESC, b.name ASC";
  if (opts.sortBy === "price_asc") orderBy = "latest_price_cents IS NULL, latest_price_cents ASC";
  if (opts.sortBy === "price_desc") orderBy = "latest_price_cents IS NULL, latest_price_cents DESC";
  if (opts.sortBy === "name") orderBy = "b.name ASC";

  const sql = `
    WITH ranked AS (
      SELECT
        ps.*,
        ROW_NUMBER() OVER (PARTITION BY ps.blueprint_id ORDER BY ps.captured_at DESC) AS rn
      FROM price_snapshots ps
    )
    SELECT
      b.id, b.name, b.version, b.expansion_code, b.expansion_name,
      b.image_url, b.rarity, b.is_premium,
      latest.min_price_cents AS latest_price_cents,
      latest.min_price_currency AS latest_price_currency,
      latest.listings_count AS latest_listings,
      prev.min_price_cents AS prev_price_cents
    FROM blueprints b
    LEFT JOIN ranked latest ON latest.blueprint_id = b.id AND latest.rn = 1
    LEFT JOIN ranked prev   ON prev.blueprint_id = b.id AND prev.rn = 2
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
    WITH ranked AS (
      SELECT
        ps.*,
        ROW_NUMBER() OVER (PARTITION BY ps.blueprint_id ORDER BY ps.captured_at DESC) AS rn
      FROM price_snapshots ps
    )
    SELECT
      b.id, b.name, b.version, b.expansion_code, b.expansion_name,
      b.image_url, b.rarity, b.is_premium, b.tcg_player_id, b.scryfall_id,
      latest.min_price_cents AS latest_price_cents,
      latest.min_price_currency AS latest_price_currency,
      latest.listings_count AS latest_listings,
      prev.min_price_cents AS prev_price_cents
    FROM blueprints b
    LEFT JOIN ranked latest ON latest.blueprint_id = b.id AND latest.rn = 1
    LEFT JOIN ranked prev   ON prev.blueprint_id = b.id AND prev.rn = 2
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

export async function fetchPriceHistory(blueprintId: number): Promise<PricePoint[]> {
  const db = await getDb();
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
};

/** Le migliori (piu' economiche) inserzioni live per una carta, con il flag
 * "CardTrader Zero" (venditore professionale con spedizione gestita da CardTrader). */
export async function fetchBestListings(blueprintId: number): Promise<Listing[]> {
  const db = await getDb();
  const stmt = db.prepare(`
    SELECT price_cents, price_currency, condition, language, quantity,
           seller_username, can_sell_via_hub
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

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

/** Elenco carte con l'ultimo prezzo noto e quello precedente (per la freccina su/giù). */
export async function fetchCards(opts: {
  search?: string;
  expansionCode?: string;
  onlyPremium?: boolean;
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
  if (opts.onlyPremium) {
    where.push("b.is_premium = 1");
  }

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
    ORDER BY b.expansion_id DESC, b.name ASC
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
  const cards = await fetchCards({});
  const base = cards.find((c) => c.id === id);
  if (!base) return null;

  const stmt = db.prepare(
    "SELECT tcg_player_id, scryfall_id FROM blueprints WHERE id = $id"
  );
  stmt.bind({ $id: id });
  let extra = { tcg_player_id: null, scryfall_id: null };
  if (stmt.step()) extra = stmt.getAsObject() as any;
  stmt.free();

  return { ...base, ...extra };
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

export async function fetchExpansions(): Promise<{ code: string; name: string }[]> {
  const db = await getDb();
  const stmt = db.prepare(
    "SELECT DISTINCT expansion_code AS code, expansion_name AS name FROM blueprints ORDER BY name"
  );
  const rows: { code: string; name: string }[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject() as any);
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

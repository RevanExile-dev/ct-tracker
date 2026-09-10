import "server-only";
import { getPgPool } from "./pgPool";
import { expandRarityFilters, normalizeRarity } from "./rarity";
import { compareExpansions } from "./expansions";
import {
  MOVERS_PAGE_SIZE,
  type CardRow, type CardsFilterOpts, type CardsSummary, type CardDetail, type ExpansionInfo,
  type Listing, type MoversPageOpts, type MoversPageResult, type PricePoint, type ScannerCatalogRow,
  type SortOption,
} from "./types";

// Query Postgres per catalogo/prezzi, eseguite SOLO lato server (Route
// Handlers in web/app/api/**) - mai importato da un componente "use client".
// Stessa logica di business della vecchia versione client-side su sql.js
// (vedi la history di questo file), riscritta in dialetto Postgres:
// parametri posizionali ($1, $2, ...) invece dei named di sql.js, ANY($n)
// al posto di IN (...) con un placeholder per elemento, ILIKE al posto di
// LIKE (SQLite e' case-insensitive su ASCII di default, Postgres LIKE no).
//
// La "vecchia" tabella cardsDbHasExactSeries/historyDbHasExactSeries (il
// database scaricato dal browser poteva restare indietro rispetto al
// codice deployato fino al prossimo sync) non serve piu': con un solo
// Postgres live lo schema e' sempre coerente con l'API che lo interroga.

// Accumula i parametri di una query e restituisce il placeholder $n da
// inserire nella stringa SQL - piu' semplice ed espressivo dei placeholder
// nominati di sql.js, dato che node-postgres vuole solo posizionali.
class Params {
  values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

function cardRowSelect(): string {
  return `
  b.id, b.name, b.version, b.expansion_code, b.expansion_name,
  b.image_url, b.rarity, b.is_premium,
  lp.min_price_cents AS latest_price_cents,
  lp.min_price_currency AS latest_price_currency,
  lp.listings_count AS latest_listings,
  lp.cheapest_language AS latest_language,
  -- Condizione della stessa inserzione di latest_price_cents (il piu'
  -- economico in ASSOLUTO, qualunque condizione/lingua/Zero) - mai esposta
  -- finora nonostante la colonna esista gia' in latest_prices. Serve per
  -- non mostrare mai quel prezzo "nudo" in CardTile: senza un'etichetta di
  -- condizione visibile, un'inserzione Poor/Heavily Played si confondeva a
  -- colpo d'occhio con un'offerta Near Mint vera (segnalato dall'utente su
  -- una carta reale: tile a 7,13€ senza badge, in realta' Poor - il prezzo
  -- Near Mint/Zero vero era 44,63€).
  lp.cheapest_condition AS latest_condition,
  lp.prev_price_cents AS prev_price_cents,
  lp.languages_available AS languages_available,
  lp.best_price_cents AS best_price_cents,
  lp.best_price_currency AS best_price_currency,
  lp.best_condition AS best_condition,
  lp.best_language AS best_language,
  lp.best_can_sell_via_hub AS best_can_sell_via_hub,
  lp.prev_best_price_cents AS prev_best_price_cents,
  lp.it_nm_zero_price_cents AS it_nm_zero_price_cents,
  lp.it_nm_zero_price_currency AS it_nm_zero_price_currency,
  lp.it_nm_zero_listings_count AS it_nm_zero_listings_count,
  lp.prev_it_nm_zero_price_cents AS prev_it_nm_zero_price_cents
`;
}

function mapCardRow(row: CardRow): CardRow {
  if (row.rarity) row.rarity = normalizeRarity(row.rarity);
  return row;
}

/** WHERE condiviso tra fetchCards/fetchCardsCount/fetchCardsSummary, cosi'
 * "quante carte" e "che carte" restano sempre coerenti per costruzione
 * invece di dover mantenere due query separate allineate a mano. */
function buildCardsFilter(opts: CardsFilterOpts, p: Params): {
  where: string[];
  listingFilters: string[];
  hasListingFilter: boolean;
} {
  const where: string[] = [];

  if (opts.search) {
    // Ogni parola cercata deve trovare corrispondenza nel nome OPPURE nel
    // numero/versione (es. "12/98", "Holo Rare | 12/98" - CardTrader mette
    // il numero nell'espansione dentro `version`, non in una colonna
    // dedicata) - cosi' "virizion 12" trova la carta anche se il numero e
    // il nome vivono in due colonne diverse, senza richiedere che compaiano
    // insieme in una sola. Porta lo stesso fix della PR #31 (pre-migrazione
    // Postgres, dove viveva in buildCardsFilter lato client) qui, unico
    // punto che ora costruisce davvero la query.
    const tokens = opts.search.trim().split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      const placeholder = p.add(`%${token}%`);
      where.push(`(b.name ILIKE ${placeholder} OR b.version ILIKE ${placeholder})`);
    }
  }
  if (opts.expansionCode) {
    where.push(`b.expansion_code = ${p.add(opts.expansionCode)}`);
  }
  if (opts.rarities && opts.rarities.length > 0) {
    const rarityFilters = expandRarityFilters(opts.rarities);
    where.push(`b.rarity = ANY(${p.add(rarityFilters)})`);
  }
  if (opts.ids) {
    // Array vuoto (es. binder/wishlist senza ancora nessuna carta salvata):
    // nessuna riga puo' corrispondere, "false" evita comunque una query
    // inutile sul resto dei filtri (a differenza di "= ANY('{}')", che in
    // Postgres e' sintatticamente valido ma qui e' piu' chiaro cosi').
    if (opts.ids.length === 0) {
      where.push("false");
    } else {
      where.push(`b.id = ANY(${p.add(opts.ids)})`);
    }
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
    listingFilters.push(`pl.language = ANY(${p.add(opts.languages)})`);
  }
  if (opts.conditions && opts.conditions.length > 0) {
    listingFilters.push(`pl.condition = ANY(${p.add(opts.conditions)})`);
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

  return { where, listingFilters, hasListingFilter };
}

// best_price_cents (Near Mint + CardTrader Zero quando esiste) e' il
// prezzo "vero" da mostrare/ordinare; COALESCE su min_price_cents e' solo
// una rete di sicurezza per le carte non ancora ripassate dal sync che
// popola best_price_cents. Se pero' e' attivo un filtro lingua/condizione/
// Zero, il prezzo mostrato deve venire da un'inserzione che rispetta QUEL
// filtro (fl.price_cents, dal LEFT JOIN costruito da buildFilteredJoinSql),
// altrimenti si rischia di filtrare per IT e mostrare comunque il prezzo
// migliore in giapponese perche' quello e' il piu' economico assoluto.
function buildPriceExprs(hasListingFilter: boolean): { priceExpr: string; prevPriceExpr: string } {
  const priceExpr = hasListingFilter
    ? "COALESCE(fl.price_cents, lp.best_price_cents, lp.min_price_cents)"
    : "lp.it_nm_zero_price_cents";
  const prevPriceExpr = "lp.prev_it_nm_zero_price_cents";
  return { priceExpr, prevPriceExpr };
}

// Inserzione piu' economica tra quelle che rispettano TUTTI i filtri
// lingua/condizione/Zero insieme, solo quando almeno uno di questi filtri
// e' attivo — cosi' il percorso senza filtri resta leggero come prima. In
// due passi invece di un unico ROW_NUMBER() su tutte le righe filtrate
// (vedi commento storico nella versione sql.js di questo file: 25-40% piu'
// lento su un catalogo di 31.700+ carte):
//   1) GROUP BY + MIN(price_cents) per trovare il prezzo minimo per carta.
//   2) ROW_NUMBER() SOLO tra le righe che hanno esattamente quel prezzo
//      minimo per il tie-break deterministico (Zero prima, poi la riga
//      piu' vecchia).
function buildFilteredJoinSql(hasListingFilter: boolean, listingFilters: string[]): string {
  if (!hasListingFilter) return "";
  return `LEFT JOIN (
       WITH mins AS (
         SELECT blueprint_id, MIN(price_cents) AS price_cents
         FROM price_listings pl
         WHERE ${listingFilters.join(" AND ")}
         GROUP BY blueprint_id
       )
       SELECT m.blueprint_id, pl.price_cents, pl.price_currency, pl.condition, pl.language, pl.can_sell_via_hub,
              ROW_NUMBER() OVER (
                PARTITION BY m.blueprint_id
                ORDER BY pl.can_sell_via_hub DESC, pl.id ASC
              ) AS rn
       FROM mins m
       JOIN price_listings pl
         ON pl.blueprint_id = m.blueprint_id AND pl.price_cents = m.price_cents
         AND ${listingFilters.join(" AND ")}
     ) fl ON fl.blueprint_id = b.id AND fl.rn = 1`;
}

/** Elenco carte con l'ultimo prezzo noto e quello precedente (per la freccina su/giù). */
export async function fetchCards(opts: CardsFilterOpts & {
  sortBy?: SortOption;
  limit?: number;
}): Promise<CardRow[]> {
  const pool = getPgPool();
  const p = new Params();
  const { where, listingFilters, hasListingFilter } = buildCardsFilter(opts, p);
  const { priceExpr, prevPriceExpr } = buildPriceExprs(hasListingFilter);

  let orderBy = "b.expansion_id DESC, b.name ASC";
  if (opts.sortBy === "price_asc") orderBy = `${priceExpr} IS NULL, ${priceExpr} ASC`;
  if (opts.sortBy === "price_desc") orderBy = `${priceExpr} IS NULL, ${priceExpr} DESC`;
  if (opts.sortBy === "name") orderBy = "b.name ASC";
  if (opts.sortBy === "drop_first") {
    // Piu' grande calo percentuale prima; le carte senza prezzo precedente
    // (o senza variazione) restano in fondo. La condizione qui DEVE restare
    // identica a priceDeltaPct() in format.ts: un prezzo/prezzo-precedente
    // a 0 conta anche lui come "nessuna variazione valida". NULLIF(...,0)
    // sul divisore: a differenza di SQLite (che su una divisione per zero
    // torna silenziosamente NULL), Postgres solleva un errore "division by
    // zero" che abortirebbe l'intera query - qui il CASE WHEN sopra sposta
    // gia' queste righe in fondo, ma l'espressione di ORDER BY viene
    // comunque valutata da Postgres su OGNI riga del risultato, quindi va
    // resa sicura a prescindere da dove finisce nell'ordinamento.
    orderBy = `
      CASE WHEN ${priceExpr} IS NULL OR ${priceExpr} = 0 OR ${prevPriceExpr} IS NULL OR ${prevPriceExpr} = 0 THEN 1 ELSE 0 END,
      (CAST(${priceExpr} AS REAL) - ${prevPriceExpr}) / NULLIF(${prevPriceExpr}, 0) ASC
    `;
  }
  if (opts.sortBy === "rise_first") {
    orderBy = `
      CASE WHEN ${priceExpr} IS NULL OR ${priceExpr} = 0 OR ${prevPriceExpr} IS NULL OR ${prevPriceExpr} = 0 THEN 1 ELSE 0 END,
      (CAST(${priceExpr} AS REAL) - ${prevPriceExpr}) / NULLIF(${prevPriceExpr}, 0) DESC
    `;
  }

  const filteredJoin = buildFilteredJoinSql(hasListingFilter, listingFilters);
  const filteredSelect = hasListingFilter
    ? `, fl.price_cents AS filtered_price_cents, fl.price_currency AS filtered_price_currency,
       fl.condition AS filtered_condition, fl.language AS filtered_language,
       fl.can_sell_via_hub AS filtered_can_sell_via_hub`
    : "";

  const limitSql = opts.limit ? `LIMIT ${p.add(opts.limit)}` : "";

  const sql = `
    SELECT ${cardRowSelect()}${filteredSelect}
    FROM blueprints b
    LEFT JOIN latest_prices lp ON lp.blueprint_id = b.id
    ${filteredJoin}
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY ${orderBy}
    ${limitSql}
  `;

  const { rows } = await pool.query(sql, p.values);
  return rows.map(mapCardRow);
}

/** Conteggio delle carte che soddisfano gli stessi filtri di fetchCards. */
export async function fetchCardsCount(opts: CardsFilterOpts): Promise<number> {
  const pool = getPgPool();
  const p = new Params();
  const { where } = buildCardsFilter(opts, p);
  const sql = `SELECT COUNT(*) AS c FROM blueprints b ${where.length ? "WHERE " + where.join(" AND ") : ""}`;
  const { rows } = await pool.query(sql, p.values);
  return Number(rows[0].c);
}

/** Media delle variazioni giorno-su-giorno delle carte che soddisfano i
 * filtri correnti, calcolata in SQL. Stessa identica regola di
 * priceDeltaPct() in format.ts - un prezzo o prezzo precedente a 0 o NULL
 * non conta come variazione valida. */
export async function fetchCardsSummary(opts: CardsFilterOpts): Promise<CardsSummary | null> {
  const pool = getPgPool();
  const p = new Params();
  const { where, listingFilters, hasListingFilter } = buildCardsFilter(opts, p);
  const { priceExpr, prevPriceExpr } = buildPriceExprs(hasListingFilter);
  const filteredJoin = buildFilteredJoinSql(hasListingFilter, listingFilters);
  const validExpr = `${priceExpr} IS NOT NULL AND ${priceExpr} != 0 AND ${prevPriceExpr} IS NOT NULL AND ${prevPriceExpr} != 0`;
  const sql = `
    SELECT
      AVG(CASE WHEN ${validExpr} THEN (CAST(${priceExpr} AS REAL) - ${prevPriceExpr}) / ${prevPriceExpr} * 100 END) AS "avgPct",
      COUNT(CASE WHEN ${validExpr} THEN 1 END) AS "sampleSize",
      COUNT(*) AS "totalCards"
    FROM blueprints b
    LEFT JOIN latest_prices lp ON lp.blueprint_id = b.id
    ${filteredJoin}
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
  `;
  const { rows } = await pool.query(sql, p.values);
  const row = rows[0] as { avgPct: number | null; sampleSize: string; totalCards: string };
  if (row.avgPct === null || Number(row.sampleSize) === 0) return null;
  return { avgPct: row.avgPct, sampleSize: Number(row.sampleSize), totalCards: Number(row.totalCards) };
}

// "Carte in movimento" confronta SOLO la serie esatta italiano+Near Mint+
// CardTrader Zero (mai best_price_cents, che allenta i vincoli a cascata e
// puo' mescolare profili diversi tra un giorno e l'altro): un valore
// corrente/precedente qui e' garantito riferirsi sempre allo stesso
// identico profilo, mai un'offerta simile ma diversa spacciata per la
// stessa.
export async function fetchMoversPage(opts: MoversPageOpts): Promise<MoversPageResult> {
  const pool = getPgPool();
  const p = new Params();

  const where: string[] = [
    "lp.it_nm_zero_price_cents IS NOT NULL",
    "lp.it_nm_zero_price_cents != 0",
    "lp.prev_it_nm_zero_price_cents IS NOT NULL",
    "lp.prev_it_nm_zero_price_cents != 0",
    opts.direction === "rise"
      ? "lp.it_nm_zero_price_cents > lp.prev_it_nm_zero_price_cents"
      : "lp.it_nm_zero_price_cents < lp.prev_it_nm_zero_price_cents",
  ];

  if (opts.rarities && opts.rarities.length > 0) {
    const rarityFilters = expandRarityFilters(opts.rarities);
    where.push(`b.rarity = ANY(${p.add(rarityFilters)})`);
  }
  if (opts.minCents != null) {
    where.push(`lp.it_nm_zero_price_cents >= ${p.add(opts.minCents)}`);
  }
  if (opts.maxCents != null) {
    where.push(`lp.it_nm_zero_price_cents <= ${p.add(opts.maxCents)}`);
  }

  const whereSql = `WHERE ${where.join(" AND ")}`;
  const countRes = await pool.query(
    `SELECT COUNT(*) AS c FROM blueprints b LEFT JOIN latest_prices lp ON lp.blueprint_id = b.id ${whereSql}`,
    p.values,
  );
  const totalCount = Number(countRes.rows[0].c);

  const deltaExpr =
    "(CAST(lp.it_nm_zero_price_cents AS REAL) - lp.prev_it_nm_zero_price_cents) / lp.prev_it_nm_zero_price_cents";
  const absExpr = "(lp.it_nm_zero_price_cents - lp.prev_it_nm_zero_price_cents)";
  const sortExpr = opts.sort === "abs" ? absExpr : deltaExpr;
  const orderDirection = opts.direction === "rise" ? "DESC" : "ASC";

  const page = Math.max(1, opts.page ?? 1);
  const offset = (page - 1) * MOVERS_PAGE_SIZE;
  const limitPh = p.add(MOVERS_PAGE_SIZE);
  const offsetPh = p.add(offset);

  const { rows } = await pool.query(
    `
    SELECT ${cardRowSelect()}
    FROM blueprints b
    LEFT JOIN latest_prices lp ON lp.blueprint_id = b.id
    ${whereSql}
    ORDER BY ${sortExpr} ${orderDirection}
    LIMIT ${limitPh} OFFSET ${offsetPh}
    `,
    p.values,
  );

  return { cards: rows.map(mapCardRow), totalCount, available: true };
}

export async function fetchCardDetail(id: number): Promise<CardDetail | null> {
  const pool = getPgPool();
  const { rows } = await pool.query(
    `
    SELECT ${cardRowSelect()}, b.tcg_player_id, b.scryfall_id
    FROM blueprints b
    LEFT JOIN latest_prices lp ON lp.blueprint_id = b.id
    WHERE b.id = $1
    `,
    [id],
  );
  if (rows.length === 0) return null;
  return mapCardRow(rows[0]) as CardDetail;
}

/** Storico completo di una carta (per il grafico). */
export async function fetchPriceHistory(blueprintId: number): Promise<PricePoint[]> {
  const pool = getPgPool();
  const { rows } = await pool.query(
    `
    SELECT captured_at::text AS captured_at, min_price_cents, avg_price_cents,
           listings_count, best_price_cents, it_nm_zero_price_cents
    FROM price_snapshots
    WHERE blueprint_id = $1
    ORDER BY captured_at ASC
    `,
    [blueprintId],
  );
  return rows;
}

/** Le migliori (piu' economiche) inserzioni live per una carta (fino a 25,
 * vedi replace_price_listings in scripts/db.py). */
export async function fetchBestListings(blueprintId: number): Promise<Listing[]> {
  const pool = getPgPool();
  const { rows } = await pool.query(
    `
    SELECT price_cents, price_currency, condition, language, quantity,
           seller_username, can_sell_via_hub, ships_from_country
    FROM price_listings
    WHERE blueprint_id = $1
    ORDER BY price_cents ASC
    `,
    [blueprintId],
  );
  return rows;
}

export async function fetchExpansions(): Promise<ExpansionInfo[]> {
  const pool = getPgPool();
  const { rows } = await pool.query(
    `SELECT expansion_code AS code, expansion_name AS name, COUNT(*) AS "cardCount"
     FROM blueprints GROUP BY expansion_code, expansion_name`
  );
  const expansions = rows.map((r) => ({ ...r, cardCount: Number(r.cardCount) })) as ExpansionInfo[];
  // Piu' recenti prima quando conosciamo la data reale (vedi expansions.ts);
  // fallback sull'ordine approssimato per era per le altre.
  expansions.sort(compareExpansions);
  return expansions;
}

/** Statistiche generali del catalogo (carte tracciate, quante hanno un
 * prezzo noto). */
export async function fetchCatalogStats(): Promise<{ totalCards: number; pricedCards: number }> {
  const pool = getPgPool();
  const [totalRes, pricedRes] = await Promise.all([
    pool.query("SELECT COUNT(*) AS c FROM blueprints"),
    pool.query("SELECT COUNT(*) AS c FROM latest_prices WHERE min_price_cents IS NOT NULL"),
  ]);
  return {
    totalCards: Number(totalRes.rows[0].c),
    pricedCards: Number(pricedRes.rows[0].c),
  };
}

/** Condizioni distinte tra le inserzioni salvate, ordinate dalla migliore
 * alla peggiore (stessa scala usata da ConditionBadge). */
export async function fetchConditions(): Promise<string[]> {
  const pool = getPgPool();
  const order = ["Mint", "Near Mint", "Slightly Played", "Moderately Played", "Played", "Poor"];
  const { rows } = await pool.query(
    "SELECT DISTINCT condition FROM price_listings WHERE condition IS NOT NULL AND condition != ''"
  );
  return rows
    .map((r) => r.condition as string)
    .sort((a, b) => {
      const ra = order.indexOf(a), rb = order.indexOf(b);
      return (ra === -1 ? order.length : ra) - (rb === -1 ? order.length : rb);
    });
}

export async function fetchRarities(): Promise<string[]> {
  const pool = getPgPool();
  const { rows } = await pool.query(
    "SELECT DISTINCT rarity FROM blueprints WHERE rarity IS NOT NULL ORDER BY rarity"
  );
  const set = new Set<string>();
  for (const r of rows) set.add(normalizeRarity(r.rarity as string));
  return Array.from(set).sort((a, b) => a.localeCompare(b, "en"));
}

/** Tutte le lingue disponibili su almeno una carta (non solo quella della
 * piu' economica): languages_available e' un elenco delimitato per carta
 * (",en,it,jp,"), qui lo scomponiamo per costruire l'insieme completo. */
export async function fetchLanguages(): Promise<string[]> {
  const pool = getPgPool();
  const { rows } = await pool.query(
    "SELECT DISTINCT languages_available AS langs FROM latest_prices WHERE languages_available IS NOT NULL"
  );
  const set = new Set<string>();
  for (const r of rows) {
    (r.langs as string).split(",").forEach((l) => {
      if (l) set.add(l);
    });
  }
  return Array.from(set).sort();
}

export async function fetchMeta(): Promise<Record<string, string>> {
  const pool = getPgPool();
  const { rows } = await pool.query("SELECT key, value FROM meta");
  const out: Record<string, string> = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}

/** Catalogo lean (niente prezzi) per il riconoscimento carte via OCR/hash
 * percettivo (web/lib/scanner/catalog.ts) - sostituiva una lettura diretta
 * di sql.js su TUTTO il catalogo, ora un'unica chiamata API. */
export async function fetchScannerCatalog(): Promise<ScannerCatalogRow[]> {
  const pool = getPgPool();
  const { rows } = await pool.query(
    `SELECT id, name, version, expansion_code, expansion_name, image_url, rarity
     FROM blueprints
     WHERE name IS NOT NULL`
  );
  return rows;
}

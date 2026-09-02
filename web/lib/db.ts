"use client";

import initSqlJs, { Database, SqlJsStatic } from "sql.js";

let sqlJsPromise: Promise<SqlJsStatic> | null = null;
let dbPromise: Promise<Database> | null = null;
let historyDbPromise: Promise<Database> | null = null;

// Il codice del sito e i database .db serviti da /data/ non si aggiornano
// mai nello stesso istante: il primo deploy di una colonna nuova (come
// it_nm_zero_price_cents qui sotto) puo' restare per ore/giorni davanti a
// un database ancora nella forma precedente, finche' il prossimo sync reale
// non gira. Una SELECT che nomina una colonna assente fallisce e basta in
// SQLite - senza questo controllo l'intera griglia (home/movers/binder/
// wishlist, tutte basate su CARD_ROW_SELECT) sarebbe apparsa vuota, senza
// alcun errore visibile, per tutta quella finestra (bug reale, trovato
// testando esplicitamente contro il database CORRENTE non ancora
// migrato, non solo contro una copia gia' aggiornata a mano). Controllato
// una sola volta per Database appena aperto, poi le funzioni che
// costruiscono le SELECT lo leggono in modo sincrono.
let cardsDbHasExactSeries = false;
let historyDbHasExactSeries = false;

// Solo tabelle/nomi FISSI decisi qui nel codice, mai input utente: sicuro
// interpolarli direttamente (PRAGMA non supporta parametri bind per il nome
// tabella in ogni build di SQLite/sql.js, a differenza di una normale SELECT).
function hasColumn(db: Database, table: string, column: string): boolean {
  const result = db.exec(`PRAGMA table_info(${table})`);
  const columnsResult = result[0];
  if (!columnsResult) return false;
  const nameIdx = columnsResult.columns.indexOf("name");
  return columnsResult.values.some((row) => row[nameIdx] === column);
}

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
      const db = new SQL.Database(new Uint8Array(buf));
      cardsDbHasExactSeries = hasColumn(db, "latest_prices", "it_nm_zero_price_cents");
      return db;
    })().catch((err) => {
      // Senza questo, un solo fallimento (rete instabile, file
      // temporaneamente assente) mette in cache per sempre la stessa
      // Promise rifiutata: ogni chiamata successiva a getDb() la
      // restituirebbe di nuovo senza mai ritentare, anche con un
      // pulsante "Riprova" - solo un reload completo della pagina
      // sbloccherebbe il sito. Resettando la cache qui, la prossima
      // chiamata a getDb() riparte da zero.
      dbPromise = null;
      throw err;
    });
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
      const db = new SQL.Database(new Uint8Array(buf));
      historyDbHasExactSeries = hasColumn(db, "price_snapshots", "it_nm_zero_price_cents");
      return db;
    })().catch((err) => {
      // Stesso motivo di getDb(): niente Promise rifiutata in cache per
      // sempre dopo un solo errore di rete.
      historyDbPromise = null;
      throw err;
    });
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
  // Serie ESATTA senza fallback: carta italiana + Near Mint + CardTrader
  // Zero, tutte e tre insieme o NULL — a differenza di best_price_cents
  // sopra (che allenta i vincoli a cascata), qui un valore non-NULL
  // significa sempre esattamente questo profilo, mai un'offerta simile ma
  // diversa spacciata per la stessa. Vedi _exact_it_nm_zero_matches in
  // scripts/db.py.
  it_nm_zero_price_cents: number | null;
  it_nm_zero_price_currency: string | null;
  it_nm_zero_listings_count: number | null;
  prev_it_nm_zero_price_cents: number | null;
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

const RARITY_ALIASES: Record<string, string[]> = {
  // CardTrader usa sia il nome abbreviato sia un refuso senza la seconda
  // "t" in set diversi. Per l'utente sono tutti la stessa rarita'.
  "Special Illustration Rare": [
    "Special Illustration Rare",
    "Special Illustration",
    "Special Illustraion Rare",
  ],
};

const RARITY_CANONICAL = new Map(
  Object.entries(RARITY_ALIASES).flatMap(([canonical, aliases]) =>
    aliases.map((alias) => [alias, canonical] as const)
  )
);

export function normalizeRarity(rarity: string): string {
  return RARITY_CANONICAL.get(rarity) ?? rarity;
}

function expandRarityFilters(rarities: string[]): string[] {
  return Array.from(new Set(rarities.flatMap((rarity) => {
    const canonical = normalizeRarity(rarity);
    return RARITY_ALIASES[canonical] ?? [rarity];
  })));
}

// Funzione, non piu' una costante: le 4 colonne it_nm_zero_* esistono solo
// se il database CORRENTE (che puo' restare indietro rispetto al codice
// fino al prossimo sync reale, vedi cardsDbHasExactSeries sopra) le ha gia'
// - nominarle comunque farebbe fallire l'intera query con "no such column",
// svuotando la griglia ovunque questa select venga usata.
function cardRowSelect(): string {
  const exact = cardsDbHasExactSeries
    ? `
  lp.it_nm_zero_price_cents AS it_nm_zero_price_cents,
  lp.it_nm_zero_price_currency AS it_nm_zero_price_currency,
  lp.it_nm_zero_listings_count AS it_nm_zero_listings_count,
  lp.prev_it_nm_zero_price_cents AS prev_it_nm_zero_price_cents`
    : `
  NULL AS it_nm_zero_price_cents,
  NULL AS it_nm_zero_price_currency,
  NULL AS it_nm_zero_listings_count,
  NULL AS prev_it_nm_zero_price_cents`;
  return `
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
  lp.prev_best_price_cents AS prev_best_price_cents,${exact}
`;
}

type CardsFilterOpts = {
  search?: string;
  expansionCode?: string;
  rarities?: string[];
  languages?: string[];
  conditions?: string[];
  onlyZero?: boolean;
  // Filtra su un insieme esplicito di ID invece che sull'intero catalogo -
  // usato da binder/wishlist (vedi fetchCards), che altrimenti scaricavano
  // e materializzavano TUTTE le carte del catalogo solo per tenerne poi
  // una manciata via un Set.id in JS: stesso pattern del problema
  // principale trovato nell'audit UI/UX (fetchCards senza LIMIT sulla
  // home), qui pero' evitabile del tutto perche' gli ID voluti sono gia'
  // noti in anticipo.
  ids?: number[];
};

/** WHERE condiviso tra fetchCards/fetchCardsCount/fetchCardsSummary, cosi'
 * "quante carte" e "che carte" restano sempre coerenti per costruzione
 * invece di dover mantenere due query separate allineate a mano. */
function buildCardsFilter(opts: CardsFilterOpts): {
  where: string[];
  params: Record<string, string | number>;
  listingFilters: string[];
  hasListingFilter: boolean;
} {
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
    const rarityFilters = expandRarityFilters(opts.rarities);
    const placeholders = rarityFilters.map((_, i) => `$rarity${i}`).join(", ");
    rarityFilters.forEach((r, i) => (params[`$rarity${i}`] = r));
    where.push(`b.rarity IN (${placeholders})`);
  }
  if (opts.ids) {
    // Array vuoto (es. binder/wishlist senza ancora nessuna carta salvata):
    // nessuna riga puo' corrispondere, "0" evita una IN () sintatticamente
    // invalida ed evita comunque una query inutile sul resto dei filtri.
    if (opts.ids.length === 0) {
      where.push("0");
    } else {
      const placeholders = opts.ids.map((_, i) => `$id${i}`).join(", ");
      opts.ids.forEach((id, i) => (params[`$id${i}`] = id));
      where.push(`b.id IN (${placeholders})`);
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

  return { where, params, listingFilters, hasListingFilter };
}

// best_price_cents (Near Mint + CardTrader Zero quando esiste) e' il
// prezzo "vero" da mostrare/ordinare; COALESCE su min_price_cents e' solo
// una rete di sicurezza per le carte non ancora ripassate dal sync che
// popola best_price_cents. Se pero' e' attivo un filtro lingua/condizione/
// Zero, il prezzo mostrato deve venire da un'inserzione che rispetta QUEL
// filtro (fl.price_cents, dal LEFT JOIN costruito da buildFilteredJoinSql),
// altrimenti si rischia di filtrare per IT e mostrare comunque il prezzo
// migliore in giapponese perche' quello e' il piu' economico assoluto.
// Nomi di colonna qualificati (non gli alias da CARD_ROW_SELECT, es.
// "latest_price_cents"): cosi' l'espressione funziona identica sia dentro
// un ORDER BY dopo una SELECT con quegli alias (fetchCards) sia dentro una
// SELECT aggregata che non li definisce affatto (fetchCardsSummary) -
// un'espressione basata su alias funzionerebbe solo nel primo caso.
function buildPriceExprs(hasListingFilter: boolean): { priceExpr: string; prevPriceExpr: string } {
  const priceExpr = hasListingFilter
    ? "COALESCE(fl.price_cents, lp.best_price_cents, lp.min_price_cents)"
    : "COALESCE(lp.best_price_cents, lp.min_price_cents)";
  const prevPriceExpr = "COALESCE(lp.prev_best_price_cents, lp.prev_price_cents)";
  return { priceExpr, prevPriceExpr };
}

// Inserzione piu' economica tra quelle che rispettano TUTTI i filtri
// lingua/condizione/Zero insieme, solo quando almeno uno di questi filtri
// e' attivo — cosi' il percorso senza filtri resta leggero come prima. In
// due passi invece di un unico ROW_NUMBER() su tutte le righe filtrate
// (misurato: 25-40% piu' lento, fino a ~1.450ms su un catalogo di 31.700+
// carte dopo il sync completo):
//   1) GROUP BY + MIN(price_cents) per trovare il prezzo minimo per carta
//      — SQLite puo' sfruttare l'indice (blueprint_id, price_cents) per
//      calcolarlo senza dover ordinare/numerare ogni singola riga.
//   2) ROW_NUMBER() SOLO tra le righe che hanno esattamente quel prezzo
//      minimo (di norma una, raramente piu' di una - un pareggio di prezzo
//      esatto) per il tie-break deterministico (Zero prima, poi la riga
//      piu' vecchia), invece che su tutte le righe filtrate.
// Verificato: stessi identici risultati nello stesso ordine della versione
// precedente su piu' combinazioni di filtri.
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
  // Applica LIMIT direttamente in SQL invece di scaricare tutte le righe
  // e tagliare in JS: sicuro SOLO per sortBy che ordinano gia' le righe
  // "valide" prima di quelle scartate a valle (vedi drop_first/rise_first,
  // il CASE WHEN le mette in coda) - altrimenti un LIMIT prematuro
  // rischierebbe di tagliare via righe che poi sarebbero risultate valide.
  limit?: number;
}): Promise<CardRow[]> {
  const db = await getDb();
  const { where, params, listingFilters, hasListingFilter } = buildCardsFilter(opts);
  const { priceExpr, prevPriceExpr } = buildPriceExprs(hasListingFilter);

  let orderBy = "b.expansion_id DESC, b.name ASC";
  if (opts.sortBy === "price_asc") orderBy = `${priceExpr} IS NULL, ${priceExpr} ASC`;
  if (opts.sortBy === "price_desc") orderBy = `${priceExpr} IS NULL, ${priceExpr} DESC`;
  if (opts.sortBy === "name") orderBy = "b.name ASC";
  if (opts.sortBy === "drop_first") {
    // Piu' grande calo percentuale prima; le carte senza prezzo precedente
    // (o senza variazione) restano in fondo. La condizione qui DEVE restare
    // identica a priceDeltaPct() in format.ts (usata da withRealDelta() e
    // da ogni componente che mostra la percentuale): quella tratta anche
    // un prezzo/prezzo-precedente a 0 come "nessuna variazione valida"
    // (controllo JS "!latest || !prev", falsy anche per 0) - senza il
    // pareggio qui, un LIMIT applicato a questo ORDER BY (vedi movers)
    // potrebbe considerare "valida" via SQL una riga con prezzo 0 che poi
    // withRealDelta() scarta comunque in JS, restituendo meno carte del
    // limite richiesto anche se ce ne sarebbero altre valide piu' in fondo.
    orderBy = `
      CASE WHEN ${priceExpr} IS NULL OR ${priceExpr} = 0 OR ${prevPriceExpr} IS NULL OR ${prevPriceExpr} = 0 THEN 1 ELSE 0 END,
      (CAST(${priceExpr} AS REAL) - ${prevPriceExpr}) / ${prevPriceExpr} ASC
    `;
  }
  if (opts.sortBy === "rise_first") {
    // Speculare a drop_first (stessa nota sopra su priceExpr = 0).
    orderBy = `
      CASE WHEN ${priceExpr} IS NULL OR ${priceExpr} = 0 OR ${prevPriceExpr} IS NULL OR ${prevPriceExpr} = 0 THEN 1 ELSE 0 END,
      (CAST(${priceExpr} AS REAL) - ${prevPriceExpr}) / ${prevPriceExpr} DESC
    `;
  }

  const filteredJoin = buildFilteredJoinSql(hasListingFilter, listingFilters);
  const filteredSelect = hasListingFilter
    ? `, fl.price_cents AS filtered_price_cents, fl.price_currency AS filtered_price_currency,
       fl.condition AS filtered_condition, fl.language AS filtered_language,
       fl.can_sell_via_hub AS filtered_can_sell_via_hub`
    : "";

  const sql = `
    SELECT ${cardRowSelect()}${filteredSelect}
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
    const row = stmt.getAsObject() as unknown as CardRow;
    if (row.rarity) row.rarity = normalizeRarity(row.rarity);
    rows.push(row);
  }
  stmt.free();
  return rows;
}

/** Conteggio delle carte che soddisfano gli stessi filtri di fetchCards,
 * senza materializzare le righe in JS - usato per "N carte trovate" e per
 * sapere quando fermare "mostra altre" mentre fetchCards viene limitato
 * con `limit` invece di scaricare l'intero catalogo filtrato ad ogni
 * ricerca (bug reale trovato in revisione: senza `limit`, ogni tasto
 * premuto nella ricerca materializzava in oggetti JS tutte le righe
 * corrispondenti - decine di migliaia a catalogo pieno - per poi mostrarne
 * solo 60 con uno slice() lato client). */
export async function fetchCardsCount(opts: CardsFilterOpts): Promise<number> {
  const db = await getDb();
  const { where, params } = buildCardsFilter(opts);
  const sql = `SELECT COUNT(*) AS c FROM blueprints b ${where.length ? "WHERE " + where.join(" AND ") : ""}`;
  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  const row = stmt.getAsObject() as { c: number };
  stmt.free();
  return row.c;
}

/** Media delle variazioni giorno-su-giorno delle carte che soddisfano i
 * filtri correnti, calcolata in SQL invece di scaricare tutte le righe
 * filtrate per farne la media in JS (stesso motivo di fetchCardsCount:
 * fetchCards ora e' limitato da `limit`, quindi non ha piu' tutte le righe
 * necessarie per questo calcolo). Stessa identica regola di
 * priceDeltaPct() in format.ts - un prezzo o prezzo precedente a 0 o NULL
 * non conta come variazione valida (falsy-zero esclusa anche qui, deve
 * restare in sincrono con quella funzione). */
export type CardsSummary = { avgPct: number; sampleSize: number; totalCards: number };

export async function fetchCardsSummary(
  opts: CardsFilterOpts
): Promise<CardsSummary | null> {
  const db = await getDb();
  const { where, params, listingFilters, hasListingFilter } = buildCardsFilter(opts);
  const { priceExpr, prevPriceExpr } = buildPriceExprs(hasListingFilter);
  const filteredJoin = buildFilteredJoinSql(hasListingFilter, listingFilters);
  const validExpr = `${priceExpr} IS NOT NULL AND ${priceExpr} != 0 AND ${prevPriceExpr} IS NOT NULL AND ${prevPriceExpr} != 0`;
  const sql = `
    SELECT
      AVG(CASE WHEN ${validExpr} THEN (CAST(${priceExpr} AS REAL) - ${prevPriceExpr}) / ${prevPriceExpr} * 100 END) AS avgPct,
      COUNT(CASE WHEN ${validExpr} THEN 1 END) AS sampleSize,
      COUNT(*) AS totalCards
    FROM blueprints b
    LEFT JOIN latest_prices lp ON lp.blueprint_id = b.id
    ${filteredJoin}
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
  `;
  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  const row = stmt.getAsObject() as { avgPct: number | null; sampleSize: number; totalCards: number };
  stmt.free();
  if (row.avgPct === null || row.sampleSize === 0) return null;
  return { avgPct: row.avgPct, sampleSize: row.sampleSize, totalCards: row.totalCards };
}

export type CardDetail = CardRow & {
  tcg_player_id: string | null;
  scryfall_id: string | null;
};

export async function fetchCardDetail(id: number): Promise<CardDetail | null> {
  const db = await getDb();
  const stmt = db.prepare(`
    SELECT ${cardRowSelect()}, b.tcg_player_id, b.scryfall_id
    FROM blueprints b
    LEFT JOIN latest_prices lp ON lp.blueprint_id = b.id
    WHERE b.id = $id
  `);
  stmt.bind({ $id: id });
  let row: CardDetail | null = null;
  if (stmt.step()) {
    row = stmt.getAsObject() as unknown as CardDetail;
    if (row.rarity) row.rarity = normalizeRarity(row.rarity);
  }
  stmt.free();
  return row;
}

export type PricePoint = {
  captured_at: string;
  min_price_cents: number | null;
  avg_price_cents: number | null;
  listings_count: number;
  // Prezzo "migliore" storico (Near Mint + CardTrader Zero quando esiste,
  // stesso criterio di best_price_cents in latest_prices - vedi
  // _pick_best_listing in scripts/db.py) per quello snapshot. NULL sugli
  // snapshot precedenti all'introduzione di questa colonna: usare sempre
  // con fallback a min_price_cents.
  best_price_cents: number | null;
  // Serie ESATTA senza fallback per quello snapshot (italiano + Near Mint +
  // CardTrader Zero) - NULL se quel giorno non c'era un'offerta con questo
  // identico profilo, mai un prezzo di un profilo diverso. Vedi
  // it_nm_zero_price_cents in CardRow per la stessa semantica sul "latest".
  it_nm_zero_price_cents: number | null;
};

/** Storico completo di una carta: scarica price_history.db solo alla prima
 * chiamata (non serve per navigare il catalogo, solo per il grafico). */
export async function fetchPriceHistory(blueprintId: number): Promise<PricePoint[]> {
  const db = await getHistoryDb();
  // Stesso motivo di cardRowSelect() sopra: price_history.db puo' restare
  // indietro rispetto al codice fino al prossimo sync reale.
  const exactColumn = historyDbHasExactSeries ? "it_nm_zero_price_cents" : "NULL AS it_nm_zero_price_cents";
  const stmt = db.prepare(`
    SELECT captured_at, min_price_cents, avg_price_cents, listings_count, best_price_cents,
           ${exactColumn}
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
  const order = ["Mint", "Near Mint", "Slightly Played", "Moderately Played", "Played", "Poor"];
  const stmt = db.prepare(
    "SELECT DISTINCT condition FROM price_listings WHERE condition IS NOT NULL AND condition != ''"
  );
  const rows: string[] = [];
  while (stmt.step()) rows.push((stmt.getAsObject() as { condition: string }).condition);
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
  const rows = new Set<string>();
  while (stmt.step()) {
    rows.add(normalizeRarity((stmt.getAsObject() as { rarity: string }).rarity));
  }
  stmt.free();
  return Array.from(rows).sort((a, b) => a.localeCompare(b, "en"));
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
    const langs = (stmt.getAsObject() as { langs: string }).langs;
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
    const row = stmt.getAsObject() as { key: string; value: string };
    out[row.key] = row.value;
  }
  stmt.free();
  return out;
}

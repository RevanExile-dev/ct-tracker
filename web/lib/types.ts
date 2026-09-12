// Tipi condivisi tra web/lib/db.ts (client, chiama le API routes) e
// web/lib/db.server.ts (server, esegue le query Postgres) - nessuna
// dipendenza a runtime da nessuno dei due, solo forme dati.

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

export type CardsFilterOpts = {
  search?: string;
  expansionCode?: string;
  rarities?: string[];
  languages?: string[];
  conditions?: string[];
  onlyZero?: boolean;
  // Filtra su un insieme esplicito di ID invece che sull'intero catalogo -
  // usato da binder/wishlist (vedi fetchCards).
  ids?: number[];
};

export type CardsSummary = { avgPct: number; sampleSize: number; totalCards: number };

export type MoversDirection = "rise" | "drop";
export type MoversSort = "pct" | "abs";

export const MOVERS_PAGE_SIZE = 12;

export type MoversPageOpts = {
  direction: MoversDirection;
  rarities?: string[];
  minCents?: number | null;
  maxCents?: number | null;
  sort?: MoversSort;
  page?: number;
};

export type MoversPageResult = {
  cards: CardRow[];
  totalCount: number;
  available: boolean;
};

export type CardDetail = CardRow & {
  tcg_player_id: string | null;
  scryfall_id: string | null;
};

export type PricePoint = {
  captured_at: string;
  min_price_cents: number | null;
  avg_price_cents: number | null;
  listings_count: number;
  best_price_cents: number | null;
  it_nm_zero_price_cents: number | null;
};

export type BinderValuePoint = {
  captured_at: string;
  total_cents: number;
  currency: string | null;
  cards_count: number;
  priced_count: number;
};

export type LotProvenance = "acquisto" | "pacchetto" | "regalo" | "scambio" | "non_specificata";

// Un lotto e' un ACQUISTO specifico (N copie della stessa carta, un solo
// costo/una sola provenienza) - a differenza di BinderEntry (web/lib/binder.ts,
// una riga per carta posseduta in totale), una carta puo' avere piu' lotti
// nel tempo. Vedi web/db/schema.sql per la semantica NULL/0 di costTotalCents.
// Solo account (nessuna modalita' guest/localStorage): richiede sempre login.
export type Lot = {
  id: string;
  blueprintId: number;
  quantity: number;
  language: string | null;
  condition: string | null;
  finish: string | null;
  provenance: LotProvenance;
  acquiredAt: string;
  costTotalCents: number | null;
  costCurrency: string | null;
  note: string | null;
  createdAt: string;
};

export type LotInput = {
  blueprintId: number;
  quantity: number;
  language?: string | null;
  condition?: string | null;
  finish?: string | null;
  provenance?: LotProvenance;
  acquiredAt?: string;
  costTotalCents?: number | null;
  costCurrency?: string | null;
  note?: string | null;
};

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

export type ExpansionInfo = { code: string; name: string; cardCount: number };

// Forma lean usata solo da web/lib/scanner/catalog.ts (riconoscimento carte
// via OCR/hash percettivo): niente prezzi, serve solo per il matching
// testuale/visivo contro l'intero catalogo.
export type ScannerCatalogRow = {
  id: number;
  name: string;
  version: string | null;
  expansion_code: string | null;
  expansion_name: string | null;
  image_url: string | null;
  rarity: string | null;
};

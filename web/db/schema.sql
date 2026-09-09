-- Schema Postgres di CartaViva (Vercel Postgres / Neon): account (login/
-- binder/wishlist/filtri) + catalogo/prezzi (migrati da SQLite - vedi
-- fondo file).
--
-- Da eseguire UNA VOLTA nell'editor SQL della dashboard Vercel Postgres
-- (Storage -> il tuo database -> Query) dopo aver creato il database.
-- Idempotente: si puo' rilanciare senza errori (IF NOT EXISTS ovunque),
-- stesso principio delle migrazioni incrementali gia' usate per SQLite
-- in scripts/db.py.
--
-- Le tabelle users/accounts/sessions/verification_token hanno nomi e
-- colonne dettati da @auth/pg-adapter - verificati leggendo direttamente
-- il sorgente dell'adapter (node_modules/@auth/pg-adapter/src/index.ts),
-- non a memoria: cambiarli romperebbe il login.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- serve per gen_random_uuid()

-- --- Tabelle richieste da Auth.js ---

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  email TEXT UNIQUE,
  "emailVerified" TIMESTAMPTZ,
  image TEXT
);

CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  provider TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  refresh_token TEXT,
  access_token TEXT,
  expires_at BIGINT,
  id_token TEXT,
  scope TEXT,
  session_state TEXT,
  token_type TEXT,
  UNIQUE (provider, "providerAccountId")
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires TIMESTAMPTZ NOT NULL,
  "sessionToken" TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS verification_token (
  identifier TEXT NOT NULL,
  expires TIMESTAMPTZ NOT NULL,
  token TEXT NOT NULL,
  PRIMARY KEY (identifier, token)
);

CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts ("userId");
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions ("userId");

-- --- Tabelle applicative: binder/wishlist/filtri salvati, collegati
-- all'account (web/lib/account.server.ts) - prima di questo vivevano solo
-- in localStorage (vedi web/lib/binder.ts/wishlist.ts/filterPreset.ts, che
-- restano il fallback per chi non ha fatto login). ---

CREATE TABLE IF NOT EXISTS binder_cards (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  blueprint_id INTEGER NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Lingua/quantita'/condizione/finitura della copia posseduta (stesso
  -- BinderEntry di web/lib/binder.ts, aggiunto li' per lo scanner dopo che
  -- questa tabella era gia' stata creata solo con blueprint_id/added_at) -
  -- JSONB invece di colonne dedicate perche' questi campi sono ancora in
  -- evoluzione lato client (vedi commento su BinderEntry), stesso motivo
  -- per cui filter_presets sotto usa gia' JSONB.
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (user_id, blueprint_id)
);

CREATE TABLE IF NOT EXISTS wishlist_cards (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  blueprint_id INTEGER NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, blueprint_id)
);

-- "scope" rispecchia le chiavi gia' usate in localStorage da
-- web/lib/filterPreset.ts ("catalog", ...): stesso identificatore, cosi'
-- web/lib/account.server.ts mappa 1:1 senza inventare una nuova
-- convenzione.
CREATE TABLE IF NOT EXISTS filter_presets (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scope)
);

-- --- Catalogo carte + prezzi (migrati da data/cardtrader.db e
-- data/price_history.db, vedi scripts/db.py). Stessa struttura/indici
-- delle tabelle SQLite originali, non un redesign: l'obiettivo di questa
-- migrazione e' spostare lo storage (niente piu' commit+push di file .db
-- da 85MB ad ogni sync), non cambiare la logica applicativa.
--
-- blueprint_id resta lo stesso INTEGER usato da CardTrader (non un UUID
-- generato): binder_cards/wishlist_cards sopra referenziano gia' questo
-- stesso id. Stesso discorso per expansions.id/blueprints.id: sono id
-- ESTERNI assegnati da CardTrader, sempre forniti esplicitamente dal
-- codice applicativo (scripts/db.py, scripts/migrate_to_postgres.py) -
-- deliberatamente NON SERIAL/IDENTITY: un id locale auto-generato
-- disconnesso dall'id reale di CardTrader sarebbe sbagliato qui, non
-- un miglioramento.
--
-- Flag booleani (is_premium, cheapest_foil, can_sell_via_hub, ...) restano
-- INTEGER 0/1 invece di BOOLEAN nativo Postgres: preserva esattamente lo
-- stesso contratto dei tipi TypeScript in web/lib/db.ts (che trattano
-- questi campi come number), evitando di dover toccare ogni componente
-- che li consuma solo per un dettaglio di tipo senza impatto funzionale.

CREATE TABLE IF NOT EXISTS expansions (
  id INTEGER PRIMARY KEY,
  game_id INTEGER,
  code TEXT,
  name TEXT
);

CREATE TABLE IF NOT EXISTS blueprints (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT,
  game_id INTEGER,
  category_id INTEGER,
  expansion_id INTEGER,
  expansion_code TEXT,
  expansion_name TEXT,
  image_url TEXT,
  scryfall_id TEXT,
  tcg_player_id TEXT,
  rarity TEXT,
  is_premium INTEGER DEFAULT 0,
  last_synced_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_blueprint_expansion ON blueprints (expansion_id);
CREATE INDEX IF NOT EXISTS idx_blueprint_rarity ON blueprints (rarity);

-- Solo l'ultimo prezzo noto e quello precedente (per la freccina su/giu'),
-- una riga per carta: "vista materializzata" di price_snapshots, cosi' la
-- griglia principale non deve mai leggere lo storico completo.
CREATE TABLE IF NOT EXISTS latest_prices (
  blueprint_id INTEGER PRIMARY KEY REFERENCES blueprints (id) ON DELETE CASCADE,
  captured_at DATE,
  captured_at_ts TIMESTAMPTZ,
  min_price_cents INTEGER,
  min_price_currency TEXT,
  avg_price_cents INTEGER,
  listings_count INTEGER,
  cheapest_condition TEXT,
  cheapest_language TEXT,
  cheapest_foil INTEGER,
  -- Tutte le lingue con almeno un'inserzione attiva, delimitate da virgole
  -- (es. ",en,it,jp,") per filtrare "carte disponibili in lingua X" con
  -- LIKE '%,X,%' - stessa convenzione della colonna SQLite originale.
  languages_available TEXT,
  prev_price_cents INTEGER,
  prev_captured_at DATE,
  -- Prezzo "migliore" per un compratore reale (Near Mint + CardTrader Zero
  -- quando esiste, a cascata - vedi _pick_best_listing in scripts/db.py).
  best_price_cents INTEGER,
  best_price_currency TEXT,
  best_condition TEXT,
  best_language TEXT,
  best_can_sell_via_hub INTEGER,
  prev_best_price_cents INTEGER,
  -- Serie ESATTA senza fallback: italiano + Near Mint + CardTrader Zero.
  -- NULL significa "nessuna offerta con questo identico profilo", mai un
  -- prezzo di un profilo diverso spacciato per lo stesso.
  it_nm_zero_price_cents INTEGER,
  it_nm_zero_price_currency TEXT,
  it_nm_zero_listings_count INTEGER,
  prev_it_nm_zero_price_cents INTEGER
);

-- Le migliori inserzioni live per ogni carta (non storico: ad ogni sync le
-- righe della carta vengono sostituite con le inserzioni piu' economiche
-- del momento, vedi replace_price_listings in scripts/db.py).
CREATE TABLE IF NOT EXISTS price_listings (
  id BIGSERIAL PRIMARY KEY,
  blueprint_id INTEGER NOT NULL REFERENCES blueprints (id) ON DELETE CASCADE,
  captured_at DATE NOT NULL,
  price_cents INTEGER NOT NULL,
  price_currency TEXT,
  condition TEXT,
  language TEXT,
  quantity INTEGER,
  seller_username TEXT,
  can_sell_via_hub INTEGER DEFAULT 0,
  ships_from_country TEXT
);

-- Il filtro combinato lingua/condizione/Zero (web/lib/db.ts) interroga
-- price_listings piu' volte per query: senza questi indici ogni chiamata
-- scansiona tutta la tabella (centinaia di migliaia di righe a catalogo
-- pieno) - stessa esigenza gia' documentata per la versione SQLite.
CREATE INDEX IF NOT EXISTS idx_listings_blueprint ON price_listings (blueprint_id, price_cents);
CREATE INDEX IF NOT EXISTS idx_listings_condition ON price_listings (condition);
CREATE INDEX IF NOT EXISTS idx_listings_language ON price_listings (language);
CREATE INDEX IF NOT EXISTS idx_listings_zero ON price_listings (can_sell_via_hub);

-- Storico giorno-per-giorno dei prezzi (migrato da data/price_history.db).
-- Cresce nel tempo; i dati piu' vecchi di RETENTION_DAILY_DAYS vengono
-- compressi a un punto/settimana da prune_old_history, stesso principio
-- di prima solo con SQL Postgres al posto di strftime SQLite.
CREATE TABLE IF NOT EXISTS price_snapshots (
  id BIGSERIAL PRIMARY KEY,
  blueprint_id INTEGER NOT NULL REFERENCES blueprints (id) ON DELETE CASCADE,
  captured_at DATE NOT NULL,
  captured_at_ts TIMESTAMPTZ NOT NULL,
  min_price_cents INTEGER,
  min_price_currency TEXT,
  avg_price_cents INTEGER,
  listings_count INTEGER,
  cheapest_condition TEXT,
  cheapest_language TEXT,
  cheapest_foil INTEGER,
  best_price_cents INTEGER,
  -- Stessa semantica esatta-senza-fallback di latest_prices.it_nm_zero_price_cents.
  it_nm_zero_price_cents INTEGER
);

CREATE INDEX IF NOT EXISTS idx_price_blueprint_date ON price_snapshots (blueprint_id, captured_at);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

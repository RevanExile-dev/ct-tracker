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

-- Aggiunta dopo la creazione iniziale della tabella (primo uso reale di
-- ALTER TABLE ADD COLUMN IF NOT EXISTS in questo schema, gia' anticipato nel
-- commento in cima al file): "quando abbiamo provato l'ultima volta a
-- sincronizzare questa carta", a prescindere dall'esito - diverso da
-- captured_at_ts, che si aggiorna SOLO su un tentativo riuscito. Serve a
-- scripts/sync_prices_priority.py per evitare un bug di starvation reale
-- trovato in review su questa PR: senza questa colonna, una carta che fallisce
-- SEMPRE (es. un blueprint rimosso da CardTrader) avrebbe captured_at_ts
-- eternamente NULL/vecchio, quindi si ripresenterebbe in cima alla stessa
-- fascia di priorita' ad ogni singolo run - con 15+ carte cosi', il circuit
-- breaker (MAX_CONSECUTIVE_ERRORS) scatterebbe ad ogni run PRIMA di
-- raggiungere qualunque altra carta, bloccando l'intero batch prioritario per
-- sempre. Aggiornata ad ogni tentativo (successo O fallimento, in una
-- scrittura separata e committata subito, PRIMA della chiamata a CardTrader
-- che potrebbe fallire e fare rollback) cosi' anche una carta rotta scivola
-- in fondo alla coda e lascia spazio alle altre, pur continuando ad essere
-- ritentata periodicamente invece di essere ignorata per sempre.
ALTER TABLE latest_prices ADD COLUMN IF NOT EXISTS last_attempted_at TIMESTAMPTZ;

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

-- Storico del valore totale del Binder (collezione) per utente, un punto al
-- giorno: scritto da snapshot_binder_values() in scripts/db.py, chiamata da
-- scripts/sync_prices.py subito dopo l'aggiornamento di latest_prices.
-- total_cents somma best_price_cents PER LA QUANTITA' POSSEDUTA sulle carte
-- nel binder dell'utente in quel momento - stessa euristica di "Valore
-- stimato" nel Binder web (web/app/binder/page.tsx), cosi' il grafico
-- storico racconta esattamente lo stesso numero che l'utente vede oggi,
-- solo nel tempo.
-- Cattura lo stato REALE del binder al momento dello snapshot (non una
-- ricostruzione a ritroso): un punto passato riflette le carte possedute
-- allora, non quelle di oggi. Stessa politica di retention di
-- price_snapshots (RETENTION_DAILY_DAYS, prune_old_binder_value_history).
CREATE TABLE IF NOT EXISTS binder_value_snapshots (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  captured_at DATE NOT NULL,
  total_cents INTEGER NOT NULL,
  currency TEXT,
  cards_count INTEGER NOT NULL,
  priced_count INTEGER NOT NULL,
  PRIMARY KEY (user_id, captured_at)
);

CREATE INDEX IF NOT EXISTS idx_binder_value_user_date ON binder_value_snapshots (user_id, captured_at);

-- Lotti di acquisto per il Binder: a differenza di binder_cards (una riga
-- per carta posseduta, quantita' in data->>'quantity'), un lotto e' un
-- ACQUISTO specifico di N copie della stessa carta, con il SUO costo e la
-- SUA provenienza - una carta puo' avere piu' lotti nel tempo (es. 2 copie
-- comprate a gennaio + 1 vinta a un torneo a marzo). binder_cards resta la
-- fonte di verita' per "possiedo questa carta" (usata dal grafico prezzi,
-- dai filtri catalogo, ecc.); binder_lots e' opt-in e serve solo per chi
-- vuole tracciare costo/plusvalenza NON REALIZZATA - non sostituisce
-- binder_cards, la affianca.
--
-- cost_total_cents e' il costo TOTALE del lotto (non per singola copia):
-- NULL = costo sconosciuto/non inserito (lotto tracciato solo per
-- provenienza/data), 0 = dichiarato esplicitamente gratuito (es. regalo,
-- pacchetto di benvenuto) - le due cose NON sono equivalenti, motivo per
-- cui la colonna e' nullable invece di avere un default a 0. Qualunque
-- indicatore di plusvalenza calcolato da questi dati e' per definizione
-- NON REALIZZATO (valore di mercato corrente - costo), mai "profitto":
-- un profitto REALIZZATO esiste solo se l'utente registra esplicitamente
-- una vendita, funzionalita' non ancora implementata.
--
-- provenance e' testo libero con pochi valori noti convalidati lato
-- applicativo (LOT_PROVENANCES in web/lib/account.server.ts): 'acquisto',
-- 'pacchetto', 'regalo', 'scambio', 'non_specificata' - CHECK qui serve
-- solo a bloccare valori palesemente sbagliati scritti da un bug futuro,
-- non a fare da unica fonte di verita' per l'enum (stesso principio di
-- is_premium 0/1 sopra: il contratto vero e' nel codice TypeScript che
-- consuma la colonna).
CREATE TABLE IF NOT EXISTS binder_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  blueprint_id INTEGER NOT NULL REFERENCES blueprints (id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0 AND quantity <= 999),
  language TEXT,
  condition TEXT,
  finish TEXT,
  provenance TEXT NOT NULL DEFAULT 'non_specificata'
    CHECK (provenance IN ('acquisto', 'pacchetto', 'regalo', 'scambio', 'non_specificata')),
  acquired_at DATE NOT NULL DEFAULT CURRENT_DATE,
  cost_total_cents INTEGER CHECK (cost_total_cents IS NULL OR cost_total_cents >= 0),
  cost_currency TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_binder_lots_user ON binder_lots (user_id);
CREATE INDEX IF NOT EXISTS idx_binder_lots_blueprint ON binder_lots (user_id, blueprint_id);

-- Storico degli eventi di lotto (docs/binder_reserved_work_plan_2026-09-11.md,
-- punto 2): registra ogni "apporto/rimozione di copie" separatamente dal
-- costo/provenienza gia' in binder_lots, cosi' un futuro grafico puo'
-- separare "quante copie sono state aggiunte/rimosse quando" dalla
-- variazione di mercato - MAI ricostruito a ritroso dal binder di oggi
-- (esplicitamente vietato dal report di riferimento), solo accumulato in
-- avanti a ogni scrittura reale su binder_lots.
--
-- lot_id NON usa CASCADE: eliminare un lotto deve conservare lo storico
-- degli eventi gia' avvenuti (criterio di accettazione esplicito nel piano
-- - "rimozione conserva lo storico"), quindi SET NULL invece di cancellare
-- le righe. blueprint_id/user_id sono duplicati qui (non solo derivabili
-- via lot_id) proprio per restare interrogabili anche dopo che il lotto a
-- cui si riferivano e' stato eliminato.
--
-- delta e' con segno, coerente col tipo di evento (vincolato dal CHECK
-- sotto): 'add' (creazione lotto) sempre positivo, 'remove' (eliminazione
-- lotto) sempre negativo, 'quantity_change' (modifica quantita' su un
-- lotto esistente) mai zero - un valore invariato non e' un evento.
CREATE TABLE IF NOT EXISTS binder_lot_events (
  id BIGSERIAL PRIMARY KEY,
  lot_id UUID REFERENCES binder_lots (id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  blueprint_id INTEGER NOT NULL REFERENCES blueprints (id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('add', 'remove', 'quantity_change')),
  delta INTEGER NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (event_type = 'add' AND delta > 0) OR
    (event_type = 'remove' AND delta < 0) OR
    (event_type = 'quantity_change' AND delta != 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_binder_lot_events_user ON binder_lot_events (user_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_binder_lot_events_lot ON binder_lot_events (lot_id);

-- Storico dei run dello scheduler di sync prioritario a batch
-- (scripts/sync_prices_priority.py, docs/binder_reserved_work_plan_2026-09-11.md
-- punto 3) - una riga per run, non un cursore/checkpoint di ripresa: la
-- priorita' viene RICALCOLATA da zero a ogni batch (mai continuata da un
-- offset salvato), la ripresa naturale viene invece da
-- latest_prices.captured_at_ts (gia' esistente, aggiornato incondizionatamente
-- a ogni sync per carta - vedi upsert_latest_price in scripts/db.py): una
-- carta appena sincronizzata ha il captured_at_ts piu' fresco della sua
-- fascia, quindi scivola in fondo alla coda del prossimo giro da sola,
-- senza bisogno di un puntatore separato. Questa tabella serve solo per
-- osservabilita' (durata dei run, quante carte per fascia di priorita',
-- quanti errori) - un log strutturato in Postgres invece che nei soli log
-- testuali di GitHub Actions, che scadono e non sono interrogabili.
CREATE TABLE IF NOT EXISTS sync_checkpoint (
  id BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  budget_seconds INTEGER NOT NULL,
  wishlist_count INTEGER NOT NULL DEFAULT 0,
  binder_count INTEGER NOT NULL DEFAULT 0,
  catalog_count INTEGER NOT NULL DEFAULT 0,
  cards_ok INTEGER NOT NULL DEFAULT 0,
  cards_error INTEGER NOT NULL DEFAULT 0,
  circuit_breaker_triggered BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_sync_checkpoint_started ON sync_checkpoint (started_at DESC);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

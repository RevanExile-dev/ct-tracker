-- Schema per l'account CartaViva (Postgres, Vercel Postgres / Neon).
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

-- --- Tabelle applicative (usate dalla fase 2/3 - binder/wishlist/filtri
-- salvati - create gia' qui per non dover rilanciare una seconda
-- migrazione: restano semplicemente vuote e inutilizzate finche' quelle
-- fasi non sono implementate). ---

CREATE TABLE IF NOT EXISTS binder_cards (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  blueprint_id INTEGER NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, blueprint_id)
);

CREATE TABLE IF NOT EXISTS wishlist_cards (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  blueprint_id INTEGER NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, blueprint_id)
);

-- "scope" rispecchia le chiavi gia' usate in localStorage da
-- web/lib/filterPreset.ts ("home", "movers", ...): stesso identificatore,
-- cosi' la fase 3 puo' mappare 1:1 senza inventare una nuova convenzione.
CREATE TABLE IF NOT EXISTS filter_presets (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scope)
);

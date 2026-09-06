-- Dati minimi per la suite di smoke test Playwright (web/tests/mobile-toolbar,
-- mobile-filter-manual, scanner). Prima della migrazione a Postgres questi
-- test giravano contro lo snapshot REALE del catalogo (i due file .db
-- committati in git, serviti come asset statici): rimossi quei file, la CI
-- deve seminare qualcosa di equivalente in un Postgres vuoto.
--
-- Applicato UNA VOLTA per run in .github/workflows/ui_smoke.yml dopo aver
-- creato lo schema (web/db/schema.sql) - mai eseguito in produzione.

INSERT INTO expansions (id, game_id, code, name) VALUES
  (900001, 1, 'smoketest', 'Smoke Test Set')
ON CONFLICT (id) DO NOTHING;

-- 40 carte generiche, due rarita' diverse: bastano per popolare i dropdown
-- (espansione/rarita') e rendere la home abbastanza alta da poter scrollare
-- (test mobile-filter-manual verifica window.scrollY dopo uno swipe touch).
INSERT INTO blueprints (id, name, version, game_id, category_id, expansion_id, expansion_code, expansion_name, image_url, rarity, is_premium)
SELECT
  900100 + n,
  'Smoke Card ' || n,
  n || '/40',
  1, 73, 900001, 'smoketest', 'Smoke Test Set',
  'https://cardtrader.com/uploads/blueprints/image/900000/smoke-card-' || n || '-smoke-test-set.jpg',
  CASE WHEN n % 2 = 0 THEN 'Common' ELSE 'Rare' END,
  0
FROM generate_series(1, 40) AS n
ON CONFLICT (id) DO NOTHING;

INSERT INTO latest_prices (blueprint_id, captured_at, captured_at_ts, min_price_cents, min_price_currency, listings_count, best_price_cents, best_price_currency, it_nm_zero_price_cents, it_nm_zero_price_currency)
SELECT
  900100 + n, CURRENT_DATE, now(), 100 + n, 'EUR', 1, 100 + n, 'EUR', 100 + n, 'EUR'
FROM generate_series(1, 40) AS n
ON CONFLICT (blueprint_id) DO NOTHING;

-- Carta cercabile per nome esatto (tests/scanner.spec.mjs: manual search
-- "Pikachu", candidato cliccabile, intestazione "^Pikachu$" sulla scheda,
-- flusso "Aggiungi al Binder"). DUE varianti, non una sola: la UI mostra
-- l'elenco di candidati solo quando ce ne sono piu' di uno
-- (ScannerStudio.tsx, "item.candidates.length > 1") - nel catalogo reale
-- "Pikachu" ricorre naturalmente in decine di set, qui va replicato apposta.
INSERT INTO blueprints (id, name, version, game_id, category_id, expansion_id, expansion_code, expansion_name, image_url, rarity, is_premium) VALUES
  (900201, 'Pikachu', '1/40', 1, 73, 900001, 'smoketest', 'Smoke Test Set',
   'https://cardtrader.com/uploads/blueprints/image/900000/pikachu-smoke-test-set.jpg', 'Common', 0),
  (900203, 'Pikachu', '2/40', 1, 73, 900001, 'smoketest', 'Smoke Test Set',
   'https://cardtrader.com/uploads/blueprints/image/900000/pikachu-2-smoke-test-set.jpg', 'Common', 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO latest_prices (blueprint_id, captured_at, captured_at_ts, min_price_cents, min_price_currency, listings_count) VALUES
  (900201, CURRENT_DATE, now(), 150, 'EUR', 1),
  (900203, CURRENT_DATE, now(), 175, 'EUR', 1)
ON CONFLICT (blueprint_id) DO NOTHING;

-- Carta con numero di collezione ESATTO 195/182 e URL immagine con lo stesso
-- pattern (tests/scanner.spec.mjs: OCR "I95/I82" va corretto in "195/182" e
-- deve scegliere proprio questa ristampa, non un'altra carta di nome simile).
INSERT INTO blueprints (id, name, version, game_id, category_id, expansion_id, expansion_code, expansion_name, image_url, rarity, is_premium) VALUES
  (900202, 'Blitzle', '195/182', 1, 73, 900001, 'smoketest', 'Smoke Test Set',
   'https://cardtrader.com/uploads/blueprints/image/900000/blitzle-195-182-smoke-test-set.jpg', 'Illustration Rare', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO latest_prices (blueprint_id, captured_at, captured_at_ts, min_price_cents, min_price_currency, listings_count, languages_available) VALUES
  (900202, CURRENT_DATE, now(), 500, 'EUR', 1, ',it,')
ON CONFLICT (blueprint_id) DO NOTHING;

INSERT INTO price_listings (blueprint_id, captured_at, price_cents, price_currency, condition, language, quantity, seller_username, can_sell_via_hub) VALUES
  (900202, CURRENT_DATE, 500, 'EUR', 'Near Mint', 'it', 1, 'smoke-seller', 1)
ON CONFLICT DO NOTHING;

INSERT INTO meta (key, value) VALUES
  ('last_price_sync', now()::text),
  ('last_catalog_sync', now()::text)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

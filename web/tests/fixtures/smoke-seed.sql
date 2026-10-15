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

-- 13 rialzi + 13 cali (MOVERS_PAGE_SIZE=12, vedi web/lib/types.ts): servono
-- piu' di una pagina in entrambe le direzioni per tests/movers-pagination.spec.mjs
-- ("Successiva"/"Precedente" e ripristino scroll su /movers), altrimenti il
-- bottone di paginazione non comparirebbe nemmeno.
INSERT INTO blueprints (id, name, version, game_id, category_id, expansion_id, expansion_code, expansion_name, image_url, rarity, is_premium)
SELECT
  901000 + n,
  'Mover Card ' || n,
  n || '/26',
  1, 73, 900001, 'smoketest', 'Smoke Test Set',
  'https://cardtrader.com/uploads/blueprints/image/900000/mover-card-' || n || '-smoke-test-set.jpg',
  'Common',
  0
FROM generate_series(1, 26) AS n
ON CONFLICT (id) DO NOTHING;

-- n=1..13 in rialzo (prezzo attuale > precedente), n=14..26 in calo.
-- it_nm_zero_listings_count = 6: la pagina Carte in movimento considera solo
-- carte con almeno MIN_MOVER_LISTINGS (5) inserzioni IT NM Zero.
INSERT INTO latest_prices (blueprint_id, captured_at, captured_at_ts, min_price_cents, min_price_currency, listings_count, it_nm_zero_price_cents, it_nm_zero_price_currency, prev_it_nm_zero_price_cents, it_nm_zero_listings_count, prev_it_nm_zero_captured_at)
SELECT
  901000 + n, CURRENT_DATE, now(), 1000 + n, 'EUR', 1,
  CASE WHEN n <= 13 THEN 1000 + n ELSE 500 + n END,
  'EUR',
  CASE WHEN n <= 13 THEN 500 + n ELSE 1000 + n END,
  6,
  CURRENT_DATE - 5
FROM generate_series(1, 26) AS n
ON CONFLICT (blueprint_id) DO NOTHING;

-- Due cali il cui prezzo di confronto e' di 45 giorni fa: compaiono solo con il
-- periodo "Tutto" in /movers, mai con quello predefinito (30 giorni).
-- tests/movers-period.spec.mjs.
INSERT INTO blueprints (id, name, version, game_id, category_id, expansion_id, expansion_code, expansion_name, image_url, rarity, is_premium)
SELECT
  902000 + n,
  'Vecchio Confronto ' || n,
  n || '/2',
  1, 73, 900001, 'smoketest', 'Smoke Test Set',
  'https://cardtrader.com/uploads/blueprints/image/900000/vecchio-confronto-' || n || '-smoke-test-set.jpg',
  'Common',
  0
FROM generate_series(1, 2) AS n
ON CONFLICT (id) DO NOTHING;

INSERT INTO latest_prices (blueprint_id, captured_at, captured_at_ts, min_price_cents, min_price_currency, listings_count, it_nm_zero_price_cents, it_nm_zero_price_currency, prev_it_nm_zero_price_cents, it_nm_zero_listings_count, prev_it_nm_zero_captured_at)
SELECT 902000 + n, CURRENT_DATE, now(), 300, 'EUR', 1, 300, 'EUR', 1000, 6, CURRENT_DATE - 45
FROM generate_series(1, 2) AS n
ON CONFLICT (blueprint_id) DO NOTHING;

-- "Occasioni" (tests/movers-occasioni.spec.mjs): una sola carta supera tutte le
-- soglie (ribasso 33%, 20 EUR, 12 inserzioni, prezzo di oggi, confronto di 4 giorni
-- fa); le altre mancano di UNA soglia ciascuna.
INSERT INTO blueprints (id, name, version, game_id, category_id, expansion_id, expansion_code, expansion_name, image_url, rarity, is_premium) VALUES
  (903001, 'Occasione Valida', '1/9', 1, 73, 900001, 'smoketest', 'Smoke Test Set', 'https://cardtrader.com/uploads/blueprints/image/900000/occasione-1-smoke-test-set.jpg', 'Common', 0),
  (903002, 'Occasione Ribasso Lieve', '2/9', 1, 73, 900001, 'smoketest', 'Smoke Test Set', 'https://cardtrader.com/uploads/blueprints/image/900000/occasione-2-smoke-test-set.jpg', 'Common', 0),
  (903003, 'Occasione Poche Inserzioni', '3/9', 1, 73, 900001, 'smoketest', 'Smoke Test Set', 'https://cardtrader.com/uploads/blueprints/image/900000/occasione-3-smoke-test-set.jpg', 'Common', 0),
  (903004, 'Occasione Prezzo Vecchio', '4/9', 1, 73, 900001, 'smoketest', 'Smoke Test Set', 'https://cardtrader.com/uploads/blueprints/image/900000/occasione-4-smoke-test-set.jpg', 'Common', 0),
  (903005, 'Occasione Prezzo Basso', '5/9', 1, 73, 900001, 'smoketest', 'Smoke Test Set', 'https://cardtrader.com/uploads/blueprints/image/900000/occasione-5-smoke-test-set.jpg', 'Common', 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO latest_prices (blueprint_id, captured_at, captured_at_ts, min_price_cents, min_price_currency, listings_count, it_nm_zero_price_cents, it_nm_zero_price_currency, prev_it_nm_zero_price_cents, it_nm_zero_listings_count, prev_it_nm_zero_captured_at) VALUES
  (903001, CURRENT_DATE, now(), 2000, 'EUR', 12, 2000, 'EUR', 3000, 12, CURRENT_DATE - 4),
  (903002, CURRENT_DATE, now(), 2800, 'EUR', 12, 2800, 'EUR', 3000, 12, CURRENT_DATE - 4),
  (903003, CURRENT_DATE, now(), 2000, 'EUR', 6, 2000, 'EUR', 3000, 6, CURRENT_DATE - 4),
  (903004, CURRENT_DATE - 10, now() - interval '10 days', 2000, 'EUR', 12, 2000, 'EUR', 3000, 12, CURRENT_DATE - 14),
  (903005, CURRENT_DATE, now(), 300, 'EUR', 12, 300, 'EUR', 450, 12, CURRENT_DATE - 4)
ON CONFLICT (blueprint_id) DO NOTHING;

INSERT INTO meta (key, value) VALUES
  ('last_price_sync', now()::text),
  ('last_catalog_sync', now()::text)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Illustratori per il filtro "Artista" (tests/artist-filter.spec.mjs): i nomi
-- devono essere quelli di web/config/top_artists.json, l'unica lista che il
-- filtro mostra. 8 carte Egawa (n multipli di 5), 8 Arita (n % 5 = 1), le
-- altre senza artista (come nel catalogo reale per le carte non abbinate).
UPDATE blueprints SET artist = 'Akira Egawa' WHERE id BETWEEN 900101 AND 900140 AND (id - 900100) % 5 = 0;
UPDATE blueprints SET artist = 'Mitsuhiro Arita' WHERE id BETWEEN 900101 AND 900140 AND (id - 900100) % 5 = 1;

-- Ricerca per nome (tests/name-search.spec.mjs): "mew" deve trovare anche
-- Mewtwo ma mettere per primi Mew/Mew ex; con "Nome esatto" solo i primi due; "char" per i suggerimenti.
INSERT INTO blueprints (id, name, version, game_id, category_id, expansion_id, expansion_code, expansion_name, rarity, is_premium) VALUES
  (910001, 'Mewtwo ex', '10/98', 1, 73, 900001, 'smoketest', 'Smoke Test Set', 'Rare', 0),
  (910002, 'Mew', '11/98', 1, 73, 900001, 'smoketest', 'Smoke Test Set', 'Rare', 0),
  (910003, 'Mew ex', '12/98', 1, 73, 900001, 'smoketest', 'Smoke Test Set', 'Rare', 0),
  (910004, 'Mewtwo', '13/98', 1, 73, 900001, 'smoketest', 'Smoke Test Set', 'Rare', 0),
  (910005, 'Charizard', '14/98', 1, 73, 900001, 'smoketest', 'Smoke Test Set', 'Rare', 0),
  (910006, 'Charizard ex', '15/98', 1, 73, 900001, 'smoketest', 'Smoke Test Set', 'Rare', 0),
  (910007, 'Charmeleon', '16/98', 1, 73, 900001, 'smoketest', 'Smoke Test Set', 'Rare', 0),
  (910008, 'Pokémon Catcher', '17/98', 1, 73, 900001, 'smoketest', 'Smoke Test Set', 'Rare', 0),
  (910009, 'Promo Speciale', 'Pokémon Day | 18/98', 1, 73, 900001, 'smoketest', 'Smoke Test Set', 'Rare', 0)
ON CONFLICT (id) DO NOTHING;

-- Riferimento Cardmarket (tests/cardmarket-reference.spec.mjs). Quattro carte
-- gia' seminate sopra, quattro stati della scheda:
--   900101: dati recenti, versione normale + holo, tendenza 4,02 euro (sotto i 25)
--   900102: dati recenti, tendenza 30,00 euro (raccomandata obbligatoria)
--   900103: dati vecchi di 10 giorni (il riquadro non deve comparire)
--   900104: nessuna riga (il riquadro non deve comparire)
--   900105: dati vecchi di 6 giorni (carta a rotazione settimanale: il riquadro deve comparire)
INSERT INTO external_prices (blueprint_id, source, variant, currency, price_cents, low_cents, mid_cents, avg1_cents, avg7_cents, avg30_cents, source_updated_at, fetched_at) VALUES
  (900101, 'cardmarket', '',     'EUR',  402,  150,  380,  400,  410,  395, now() - interval '3 hours', now() - interval '2 hours'),
  (900101, 'cardmarket', 'holo', 'EUR',  990,  700,  950,  980,  990,  960, now() - interval '3 hours', now() - interval '2 hours'),
  (900102, 'cardmarket', '',     'EUR', 3000, 2500, 2900, 3000, 3100, 3050, now() - interval '3 hours', now() - interval '2 hours'),
  (900103, 'cardmarket', '',     'EUR',  555,  300,  500,  550,  560,  540, now() - interval '10 days', now() - interval '10 days'),
  (900105, 'cardmarket', '',     'EUR',  250,  100,  240,  250,  255,  245, now() - interval '6 days', now() - interval '5 days')
ON CONFLICT (blueprint_id, source, variant) DO NOTHING;

-- Account di prova per tests/share-link.spec.mjs (link di condivisione):
-- una sessione vera nel database (cookie authjs.session-token =
-- 'share-smoke-session'), un binder e una lista desideri, e un link gia'
-- creato sul binder. Nome ed email sono volutamente riconoscibili: il test
-- verifica che non compaiano MAI nella pagina pubblica ne' nell'anteprima.
INSERT INTO users (id, name, email, "emailVerified") VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'Mario Segretissimo', 'mario.segretissimo@example.invalid', now())
ON CONFLICT DO NOTHING;
INSERT INTO sessions ("userId", expires, "sessionToken") VALUES
  ('00000000-0000-4000-8000-0000000000a1', now() + interval '10 years', 'share-smoke-session')
ON CONFLICT DO NOTHING;
INSERT INTO binder_cards (user_id, blueprint_id, data) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 900101, '{"quantity": 2, "language": null, "finish": "foil"}'),
  ('00000000-0000-4000-8000-0000000000a1', 900105, '{"quantity": 1, "language": null, "finish": "normal"}'),
  ('00000000-0000-4000-8000-0000000000a1', 900110, '{"quantity": 3, "language": null, "finish": "unknown"}')
ON CONFLICT DO NOTHING;
INSERT INTO wishlist_cards (user_id, blueprint_id) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 900120),
  ('00000000-0000-4000-8000-0000000000a1', 900121)
ON CONFLICT DO NOTHING;
INSERT INTO share_links (token, user_id, kind, title) VALUES
  ('SmokeBinderShareTokenAAAAAAAAA12', '00000000-0000-4000-8000-0000000000a1', 'binder', 'Il binder di prova')
ON CONFLICT DO NOTHING;

-- "Conviene comprare ora?" (tests/buy-now.spec.mjs): 950001 ha 25 giorni di
-- storico (minimo 1000, attuale 1400 = +40%) e inserzioni Zero in IT/DE/FR/US
-- piu' una non-Zero piu' economica; 950002 ha 1 sola rilevazione (nessun verdetto).
INSERT INTO blueprints (id, name, version, game_id, category_id, expansion_id, expansion_code, expansion_name, image_url, rarity, is_premium) VALUES
  (950001, 'Buy Test Card', '1/1', 1, 73, 900001, 'smoketest', 'Smoke Test Set', 'https://cardtrader.com/uploads/blueprints/image/900000/buy-test.jpg', 'Rare', 0),
  (950002, 'Short History Card', '2/2', 1, 73, 900001, 'smoketest', 'Smoke Test Set', 'https://cardtrader.com/uploads/blueprints/image/900000/short-history.jpg', 'Rare', 0)
ON CONFLICT (id) DO NOTHING;
INSERT INTO latest_prices (blueprint_id, captured_at, captured_at_ts, min_price_cents, min_price_currency, listings_count, best_price_cents, best_price_currency, best_can_sell_via_hub) VALUES
  (950001, CURRENT_DATE, now(), 900, 'EUR', 5, 1400, 'EUR', 1),
  (950002, CURRENT_DATE, now(), 500, 'EUR', 1, 500, 'EUR', 1)
ON CONFLICT (blueprint_id) DO NOTHING;
INSERT INTO price_snapshots (blueprint_id, captured_at, captured_at_ts, min_price_cents, best_price_cents)
  SELECT 950001, CURRENT_DATE - n, now() - n * interval '1 day', 1000, 1000 + (n % 5) * 50 FROM generate_series(1, 25) AS n;
INSERT INTO price_snapshots (blueprint_id, captured_at, captured_at_ts, min_price_cents, best_price_cents) VALUES
  (950002, CURRENT_DATE - 1, now() - interval '1 day', 500, 500);
INSERT INTO price_listings (blueprint_id, captured_at, price_cents, price_currency, condition, language, quantity, seller_username, can_sell_via_hub, ships_from_country) VALUES
  (950001, CURRENT_DATE, 900, 'EUR', 'Played', 'it', 1, 'cheap-no-hub', 0, 'DE'),
  (950001, CURRENT_DATE, 1400, 'EUR', 'Near Mint', 'it', 1, 'zero-it', 1, 'IT'),
  (950001, CURRENT_DATE, 1250, 'EUR', 'Near Mint', 'en', 1, 'zero-de', 1, 'DE'),
  (950001, CURRENT_DATE, 1100, 'EUR', 'Near Mint', 'en', 1, 'zero-us', 1, 'US'),
  (950001, CURRENT_DATE, 1500, 'EUR', 'Near Mint', 'fr', 1, 'zero-fr', 1, 'FR'),
  (950002, CURRENT_DATE, 500, 'EUR', 'Near Mint', 'it', 1, 'solo-zero', 1, 'IT');

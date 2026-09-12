"""
Gestione del Postgres di CartaViva (lo stesso database usato da login/
profili, POSTGRES_URL - vedi web/lib/pgPool.ts): catalogo (espansioni,
carte), l'ultimo prezzo noto di ogni carta (latest_prices) e le inserzioni
piu' economiche del momento (price_listings), piu' lo storico
giorno-per-giorno dei prezzi (price_snapshots).

Migrato da due file SQLite locali versionati in git (data/cardtrader.db +
data/price_history.db, vedi scripts/migrate_to_postgres.py per la
migrazione una tantum): ogni sync scriveva li' e poi faceva commit+push
degli 85MB dei due .db su main, ridispiegando l'intero sito su Vercel ad
ogni run e riempiendo la quota di Deployment Storage. Con Postgres il sync
scrive direttamente nel database - zero commit/push per un aggiornamento
prezzi.

Lo schema vive in un unico posto, web/db/schema.sql (fonte di verita'
anche per le tabelle Auth.js/binder/wishlist/filtri): init_db() lo applica
per intero ad ogni avvio (idempotente: IF NOT EXISTS ovunque, e in futuro
eventuali ALTER TABLE ADD COLUMN IF NOT EXISTS per nuove colonne), stesso
principio delle migrazioni incrementali gia' in uso prima con SQLite.
"""
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import psycopg2
import psycopg2.extras

CARDTRADER_ORIGIN = "https://cardtrader.com"

REPO_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = REPO_ROOT / "web" / "db" / "schema.sql"

RETENTION_DAILY_DAYS = 120  # oltre questa soglia lo storico si comprime a 1 punto/settimana


def get_connection():
    dsn = os.environ.get("POSTGRES_URL")
    if not dsn:
        print("ERRORE: variabile d'ambiente POSTGRES_URL mancante.", file=sys.stderr)
        sys.exit(1)
    return psycopg2.connect(dsn)


def init_db():
    """Applica web/db/schema.sql per intero (idempotente): unica fonte di
    verita' per lo schema, condivisa con le tabelle Auth.js/applicative di
    web/. Va rilanciato ad ogni avvio dei sync, non solo una volta - stesso
    principio del vecchio init_db() SQLite che riallineava lo schema prima
    di ogni run."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(SCHEMA_PATH.read_text(encoding="utf-8"))
        conn.commit()
    finally:
        conn.close()


def upsert_expansion(conn, exp: dict):
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO expansions (id, game_id, code, name)
            VALUES (%(id)s, %(game_id)s, %(code)s, %(name)s)
            ON CONFLICT (id) DO UPDATE SET
                game_id = EXCLUDED.game_id, code = EXCLUDED.code, name = EXCLUDED.name
            """,
            exp,
        )


def _best_image_url(bp: dict) -> str | None:
    """CardTrader espone piu' formati per blueprint: 'image_url' e' la
    versione 'preview' (~14KB, molto compressa/sfocata). L'oggetto 'image'
    contiene anche 'url', la versione a piena risoluzione (~60-70KB, ancora
    piccola ma nitida) come path relativo. Preferiamo quella; fallback sul
    preview se per qualche motivo 'image' manca."""
    image = bp.get("image")
    if isinstance(image, dict) and image.get("url"):
        return CARDTRADER_ORIGIN + image["url"]
    return bp.get("image_url")


def upsert_blueprint(conn, bp: dict, expansion_code: str, expansion_name: str,
                       is_premium: bool, synced_at: str):
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO blueprints
                (id, name, version, game_id, category_id, expansion_id,
                 expansion_code, expansion_name, image_url, scryfall_id,
                 tcg_player_id, is_premium, last_synced_at)
            VALUES
                (%(id)s, %(name)s, %(version)s, %(game_id)s, %(category_id)s, %(expansion_id)s,
                 %(expansion_code)s, %(expansion_name)s, %(image_url)s, %(scryfall_id)s,
                 %(tcg_player_id)s, %(is_premium)s, %(synced_at)s)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name, version = EXCLUDED.version,
                image_url = EXCLUDED.image_url, is_premium = EXCLUDED.is_premium,
                last_synced_at = EXCLUDED.last_synced_at
            """,
            {
                "id": bp["id"],
                "name": bp.get("name"),
                "version": bp.get("version"),
                "game_id": bp.get("game_id"),
                "category_id": bp.get("category_id"),
                "expansion_id": bp.get("expansion_id"),
                "expansion_code": expansion_code,
                "expansion_name": expansion_name,
                "image_url": _best_image_url(bp),
                "scryfall_id": bp.get("scryfall_id"),
                "tcg_player_id": bp.get("tcg_player_id"),
                "is_premium": int(is_premium),
                "synced_at": synced_at,
            },
        )


def _product_language(p: dict):
    props = p.get("properties_hash") or {}
    return props.get("pokemon_language") or props.get("mtg_language")


def _pick_best_listing(products: list):
    """Euristica "a colpo d'occhio da compratore": su CardTrader il prezzo
    piu' economico in assoluto e' spesso una condizione rovinata o un
    venditore poco affidabile (visto con un caso reale: 0,60€ Slightly
    Played da venditore nuovo contro 9,16€ Near Mint CardTrader Zero).
    Preferiamo quindi Near Mint + CardTrader Zero (spedizione gestita/
    garantita), allentando un vincolo alla volta se non esiste una simile
    inserzione, fino al puro piu' economico in assoluto (che resta comunque
    salvato separatamente in min_price_cents, non buttato via). Si aspetta
    che 'products' contenga gia' solo offerte con un prezzo valido (vedi
    _summarize_products, che filtra prima di chiamare questa funzione) -
    un'offerta CardTrader senza "price" (raro ma possibile su un'API
    esterna) farebbe altrimenti fallire l'intero sync su quella carta."""
    def cheapest_matching(pred):
        matching = [p for p in products if pred(p)]
        return min(matching, key=lambda p: p["price"]["cents"]) if matching else None

    is_nm = lambda p: (p.get("properties_hash") or {}).get("condition") == "Near Mint"
    is_zero = lambda p: bool((p.get("user") or {}).get("can_sell_via_hub"))

    return (
        cheapest_matching(lambda p: is_nm(p) and is_zero(p))
        or cheapest_matching(is_zero)
        or cheapest_matching(is_nm)
        or min(products, key=lambda p: p["price"]["cents"])
    )


def _exact_it_nm_zero_matches(products: list) -> list:
    """Serie ESATTA senza fallback: carta italiana + Near Mint + CardTrader
    Zero. A differenza di _pick_best_listing sopra (allenta i vincoli a
    cascata), qui un'offerta deve soddisfare tutti e tre i criteri
    contemporaneamente o non conta - nessun "quasi uguale". Chi chiama
    decide cosa fare di una lista vuota (tipicamente: NULL, non un
    fallback)."""
    return [
        p for p in products
        if (_product_language(p) or "").lower() == "it"
        and (p.get("properties_hash") or {}).get("condition") == "Near Mint"
        and bool((p.get("user") or {}).get("can_sell_via_hub"))
    ]


def _summarize_products(products: list):
    """Riduce la lista di offerte marketplace ai campi aggregati che salviamo
    (prezzo minimo, medio, condizioni/lingua della piu' economica...)."""
    if not products:
        return None
    # CardTrader garantisce un prezzo su ogni offerta del marketplace, ma
    # e' un'API esterna: un elemento senza "price" (o con cents mancante)
    # farebbe fallire min()/_pick_best_listing con un errore poco chiaro,
    # bloccando il sync su quella carta invece di ignorare solo l'offerta
    # malformata.
    valid_products = [p for p in products if (p.get("price") or {}).get("cents") is not None]
    if not valid_products:
        return None
    prices = [p["price"]["cents"] for p in valid_products]
    cheapest = min(valid_products, key=lambda p: p["price"]["cents"])
    best = _pick_best_listing(valid_products)
    avg_cents = int(sum(prices) / len(prices)) if prices else None
    exact_matches = _exact_it_nm_zero_matches(valid_products)
    exact = min(exact_matches, key=lambda p: p["price"]["cents"]) if exact_matches else None
    # Tutte le lingue con almeno un'inserzione, non solo quella della piu'
    # economica: serve per poter filtrare "disponibile in lingua X" anche
    # quando quella lingua non e' l'offerta piu' economica di questa carta.
    langs = sorted({_product_language(p) for p in products} - {None})
    languages_available = f",{','.join(langs)}," if langs else None
    return {
        "min_price_cents": cheapest["price"]["cents"],
        "min_price_currency": cheapest["price"]["currency"],
        "avg_price_cents": avg_cents,
        "listings_count": len(products),
        "cheapest_condition": cheapest.get("properties_hash", {}).get("condition"),
        "cheapest_language": _product_language(cheapest),
        "cheapest_foil": int(bool(cheapest.get("properties_hash", {}).get("pokemon_foil"))),
        "languages_available": languages_available,
        "best_price_cents": best["price"]["cents"],
        "best_price_currency": best["price"]["currency"],
        "best_condition": best.get("properties_hash", {}).get("condition"),
        "best_language": _product_language(best),
        "best_can_sell_via_hub": int(bool(best.get("user", {}).get("can_sell_via_hub"))),
        "it_nm_zero_price_cents": exact["price"]["cents"] if exact else None,
        "it_nm_zero_price_currency": exact["price"].get("currency") if exact else None,
        "it_nm_zero_listings_count": len(exact_matches),
    }


def insert_price_snapshot(conn, blueprint_id: int, captured_at: str,
                            captured_at_ts: str, products: list):
    """Aggiunge (o sovrascrive, se rilanciato lo stesso giorno) il punto di
    storico odierno in price_snapshots."""
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM price_snapshots WHERE blueprint_id = %s AND captured_at = %s",
            (blueprint_id, captured_at),
        )
        summary = _summarize_products(products)
        if summary is None:
            cur.execute(
                """INSERT INTO price_snapshots
                   (blueprint_id, captured_at, captured_at_ts, min_price_cents,
                    min_price_currency, avg_price_cents, listings_count,
                    cheapest_condition, cheapest_language, cheapest_foil, best_price_cents,
                    it_nm_zero_price_cents)
                   VALUES (%s, %s, %s, NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL)""",
                (blueprint_id, captured_at, captured_at_ts),
            )
            return
        cur.execute(
            """INSERT INTO price_snapshots
               (blueprint_id, captured_at, captured_at_ts, min_price_cents,
                min_price_currency, avg_price_cents, listings_count,
                cheapest_condition, cheapest_language, cheapest_foil, best_price_cents,
                it_nm_zero_price_cents)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                blueprint_id, captured_at, captured_at_ts,
                summary["min_price_cents"], summary["min_price_currency"],
                summary["avg_price_cents"], summary["listings_count"],
                summary["cheapest_condition"], summary["cheapest_language"],
                summary["cheapest_foil"], summary["best_price_cents"],
                summary["it_nm_zero_price_cents"],
            ),
        )


def upsert_latest_price(conn, blueprint_id: int, captured_at: str,
                          captured_at_ts: str, products: list):
    """Aggiorna la "vista materializzata" latest_prices. Il prezzo
    precedente (per la freccina) viene letto da price_snapshots: e' sempre
    corretto anche se il sync viene rilanciato piu' volte lo stesso giorno,
    a differenza di tenere il "prev" copiandolo dal valore precedente di
    latest_prices (che si romperebbe sui rilanci)."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT captured_at, min_price_cents, best_price_cents FROM price_snapshots "
            "WHERE blueprint_id = %s AND captured_at < %s AND min_price_cents IS NOT NULL "
            "ORDER BY captured_at DESC LIMIT 1",
            (blueprint_id, captured_at),
        )
        prev_row = cur.fetchone()
        prev_captured_at, prev_price_cents, prev_best_price_cents = (
            prev_row if prev_row else (None, None, None)
        )
        # Query separata, non lo stesso prev_row: il giorno piu' recente con
        # UN prezzo qualsiasi non e' necessariamente lo stesso giorno piu'
        # recente con un'offerta italiano+Near Mint+Zero - confrontare
        # "corrente" e "precedente" di questa serie richiede che ENTRAMBI
        # appartengano alla stessa serie omogenea, non un valore preso da un
        # giorno con un profilo diverso.
        cur.execute(
            "SELECT it_nm_zero_price_cents FROM price_snapshots "
            "WHERE blueprint_id = %s AND captured_at < %s AND it_nm_zero_price_cents IS NOT NULL "
            "ORDER BY captured_at DESC LIMIT 1",
            (blueprint_id, captured_at),
        )
        prev_exact_row = cur.fetchone()
        prev_it_nm_zero_price_cents = prev_exact_row[0] if prev_exact_row else None

        summary = _summarize_products(products) or {
            "min_price_cents": None, "min_price_currency": None, "avg_price_cents": None,
            "listings_count": 0, "cheapest_condition": None, "cheapest_language": None,
            "cheapest_foil": None, "languages_available": None,
            "best_price_cents": None, "best_price_currency": None, "best_condition": None,
            "best_language": None, "best_can_sell_via_hub": None,
            "it_nm_zero_price_cents": None, "it_nm_zero_price_currency": None,
            "it_nm_zero_listings_count": 0,
        }

        cur.execute(
            """
            INSERT INTO latest_prices
                (blueprint_id, captured_at, captured_at_ts, min_price_cents,
                 min_price_currency, avg_price_cents, listings_count,
                 cheapest_condition, cheapest_language, cheapest_foil,
                 languages_available, prev_price_cents, prev_captured_at,
                 best_price_cents, best_price_currency, best_condition,
                 best_language, best_can_sell_via_hub, prev_best_price_cents,
                 it_nm_zero_price_cents, it_nm_zero_price_currency,
                 it_nm_zero_listings_count, prev_it_nm_zero_price_cents)
            VALUES (%(blueprint_id)s, %(captured_at)s, %(captured_at_ts)s, %(min_price_cents)s,
                    %(min_price_currency)s, %(avg_price_cents)s, %(listings_count)s,
                    %(cheapest_condition)s, %(cheapest_language)s, %(cheapest_foil)s,
                    %(languages_available)s, %(prev_price_cents)s, %(prev_captured_at)s,
                    %(best_price_cents)s, %(best_price_currency)s, %(best_condition)s,
                    %(best_language)s, %(best_can_sell_via_hub)s, %(prev_best_price_cents)s,
                    %(it_nm_zero_price_cents)s, %(it_nm_zero_price_currency)s,
                    %(it_nm_zero_listings_count)s, %(prev_it_nm_zero_price_cents)s)
            ON CONFLICT (blueprint_id) DO UPDATE SET
                captured_at = EXCLUDED.captured_at, captured_at_ts = EXCLUDED.captured_at_ts,
                min_price_cents = EXCLUDED.min_price_cents,
                min_price_currency = EXCLUDED.min_price_currency,
                avg_price_cents = EXCLUDED.avg_price_cents,
                listings_count = EXCLUDED.listings_count,
                cheapest_condition = EXCLUDED.cheapest_condition,
                cheapest_language = EXCLUDED.cheapest_language,
                cheapest_foil = EXCLUDED.cheapest_foil,
                languages_available = EXCLUDED.languages_available,
                prev_price_cents = EXCLUDED.prev_price_cents,
                prev_captured_at = EXCLUDED.prev_captured_at,
                best_price_cents = EXCLUDED.best_price_cents,
                best_price_currency = EXCLUDED.best_price_currency,
                best_condition = EXCLUDED.best_condition,
                best_language = EXCLUDED.best_language,
                best_can_sell_via_hub = EXCLUDED.best_can_sell_via_hub,
                prev_best_price_cents = EXCLUDED.prev_best_price_cents,
                it_nm_zero_price_cents = EXCLUDED.it_nm_zero_price_cents,
                it_nm_zero_price_currency = EXCLUDED.it_nm_zero_price_currency,
                it_nm_zero_listings_count = EXCLUDED.it_nm_zero_listings_count,
                prev_it_nm_zero_price_cents = EXCLUDED.prev_it_nm_zero_price_cents
            """,
            {
                "blueprint_id": blueprint_id,
                "captured_at": captured_at,
                "captured_at_ts": captured_at_ts,
                "prev_price_cents": prev_price_cents,
                "prev_captured_at": prev_captured_at,
                "prev_best_price_cents": prev_best_price_cents,
                "prev_it_nm_zero_price_cents": prev_it_nm_zero_price_cents,
                **summary,
            },
        )


def replace_price_listings(conn, blueprint_id: int, captured_at: str, products: list, top_n: int = 25):
    """Sostituisce le inserzioni salvate per questa carta con le top_n piu'
    economiche del momento (non e' uno storico, solo l'ultimo sync). top_n=25
    perche' CardTrader restituisce comunque fino a 25 offerte per chiamata
    (nessun costo API aggiuntivo): salvarle tutte da' abbastanza scelta per
    filtrare per condizione/venditore invece di essere bloccati alle sole
    5 piu' economiche, che spesso non includono nessuna inserzione Near
    Mint/CardTrader Zero decente."""
    with conn.cursor() as cur:
        cur.execute("DELETE FROM price_listings WHERE blueprint_id = %s", (blueprint_id,))
        valid_products = [p for p in products if (p.get("price") or {}).get("cents") is not None]
        if not valid_products:
            return
        cheapest_first = sorted(valid_products, key=lambda p: p["price"]["cents"])[:top_n]
        psycopg2.extras.execute_values(
            cur,
            """INSERT INTO price_listings
               (blueprint_id, captured_at, price_cents, price_currency, condition,
                language, quantity, seller_username, can_sell_via_hub, ships_from_country)
               VALUES %s""",
            [
                (
                    blueprint_id,
                    captured_at,
                    p["price"]["cents"],
                    p["price"].get("currency"),
                    p.get("properties_hash", {}).get("condition"),
                    p.get("properties_hash", {}).get("pokemon_language")
                        or p.get("properties_hash", {}).get("mtg_language"),
                    p.get("quantity"),
                    p.get("user", {}).get("username"),
                    int(bool(p.get("user", {}).get("can_sell_via_hub"))),
                    p.get("user", {}).get("country_code"),
                )
                for p in cheapest_first
            ],
        )


def prune_old_history(conn, keep_daily_days: int = RETENTION_DAILY_DAYS):
    """Oltre keep_daily_days, tiene un solo punto a settimana per carta invece
    di uno al giorno: limita la crescita a lungo termine di price_snapshots
    senza perdere la tendenza generale (i dati recenti restano al dettaglio
    giornaliero). to_char(..., 'IYYY-IW') raggruppa per settimana ISO -
    equivalente Postgres dello strftime('%Y-%W', ...) usato con SQLite (la
    numerazione esatta della settimana non e' significativa qui, serve solo
    come chiave di raggruppamento stabile)."""
    from datetime import datetime, timedelta, timezone
    cutoff = (datetime.now(timezone.utc) - timedelta(days=keep_daily_days)).strftime("%Y-%m-%d")
    with conn.cursor() as cur:
        cur.execute(
            """
            DELETE FROM price_snapshots
            WHERE captured_at < %(cutoff)s
            AND id NOT IN (
                SELECT MIN(id) FROM price_snapshots
                WHERE captured_at < %(cutoff)s
                GROUP BY blueprint_id, to_char(captured_at, 'IYYY-IW')
            )
            """,
            {"cutoff": cutoff},
        )
        deleted = cur.rowcount
    return deleted


def snapshot_binder_values(conn, captured_at: str) -> int:
    """Salva un punto di storico del valore totale del Binder per ogni
    utente che ne ha uno: somma best_price_cents PER LA QUANTITA' POSSEDUTA
    (stessa euristica di "Valore stimato" nel Binder web, vedi
    web/app/binder/page.tsx) sulle carte possedute in QUESTO momento -
    cattura lo stato reale del binder al momento del sync, non una
    ricostruzione a ritroso: una carta rimossa dal binder dopo oggi non
    sparisce dai punti passati gia' salvati. Idempotente come
    insert_price_snapshot: se rilanciato lo stesso giorno (es. sync daily +
    full nella stessa giornata), sovrascrive il punto invece di duplicarlo.
    Ritorna il numero di utenti con un binder non vuoto.

    cards_count/priced_count restano il numero di TIPI di carta posseduti
    (una riga per blueprint, vedi testo "tipi di carta" in
    CollectionValueChart.tsx) - solo total_cents moltiplica per la
    quantita', altrimenti 3 copie da 10 euro risultavano 10, non 30 (bug
    trovato nel report docs/binder_insights_2026-09-11.md, verificato: qui
    sotto sommava best_price_cents una volta per riga di binder_cards,
    ignorando bc.data->>'quantity'). Estrazione della quantita' con un
    controllo a regex invece di un CAST diretto: bc.data e' scritto da
    web/lib/account.server.ts SENZA validare il contenuto del patch HTTP in
    ingresso (nessun controllo lato API su tipo/intervallo di "quantity"
    finche' non viene corretto anche li'), quindi una singola riga con un
    valore non numerico o fuori intervallo (una stringa, un negativo, un
    numero enorme) farebbe fallire un CAST diretto e romperebbe l'intero
    sync per TUTTI gli utenti in quel run - qui invece cade silenziosamente
    a 1 (comportamento gia' esistente prima di questa modifica) invece di
    interrompere la query. Stesso limite 1-999 imposto lato API."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO binder_value_snapshots
                (user_id, captured_at, total_cents, currency, cards_count, priced_count)
            SELECT
                bc.user_id,
                %(captured_at)s,
                COALESCE(SUM(
                    lp.best_price_cents * CASE
                        WHEN bc.data->>'quantity' ~ '^[1-9][0-9]{0,2}$'
                        THEN (bc.data->>'quantity')::int
                        ELSE 1
                    END
                ), 0),
                MAX(lp.best_price_currency),
                COUNT(*),
                COUNT(lp.best_price_cents)
            FROM binder_cards bc
            LEFT JOIN latest_prices lp ON lp.blueprint_id = bc.blueprint_id
            GROUP BY bc.user_id
            ON CONFLICT (user_id, captured_at) DO UPDATE SET
                total_cents = EXCLUDED.total_cents,
                currency = EXCLUDED.currency,
                cards_count = EXCLUDED.cards_count,
                priced_count = EXCLUDED.priced_count
            """,
            {"captured_at": captured_at},
        )
        return cur.rowcount


def prune_old_binder_value_history(conn, keep_daily_days: int = RETENTION_DAILY_DAYS):
    """Stessa compressione di prune_old_history (1 punto/settimana oltre
    keep_daily_days), applicata per utente invece che per carta: la PK di
    binder_value_snapshots e' gia' (user_id, captured_at), niente id
    surrogato da confrontare come in price_snapshots."""
    from datetime import datetime, timedelta, timezone
    cutoff = (datetime.now(timezone.utc) - timedelta(days=keep_daily_days)).strftime("%Y-%m-%d")
    with conn.cursor() as cur:
        cur.execute(
            """
            DELETE FROM binder_value_snapshots
            WHERE captured_at < %(cutoff)s
            AND (user_id, captured_at) NOT IN (
                SELECT user_id, MIN(captured_at) FROM binder_value_snapshots
                WHERE captured_at < %(cutoff)s
                GROUP BY user_id, to_char(captured_at, 'IYYY-IW')
            )
            """,
            {"cutoff": cutoff},
        )
        return cur.rowcount


def set_meta(conn, key: str, value: str):
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO meta (key, value) VALUES (%s, %s) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            (key, value),
        )


def get_meta(conn, key: str) -> str | None:
    with conn.cursor() as cur:
        cur.execute("SELECT value FROM meta WHERE key = %s", (key,))
        row = cur.fetchone()
        return row[0] if row else None


# Fasce di priorita' per lo scheduler a batch (scripts/sync_prices_priority.py,
# docs/binder_reserved_work_plan_2026-09-11.md punto 3): allarmi armati ->
# desideri -> binder -> resto del catalogo. La fascia "allarmi attivi" (la
# piu' alta nel piano originale) e' arrivata con la sotto-parte 4c, dopo che
# la tabella price_alerts della sotto-parte 4b l'ha resa possibile - una
# carta con un allarme 'armed' merita il prezzo piu' fresco possibile,
# altrimenti l'utente rischia di scoprire un calo gia' passato con ore di
# ritardo solo perche' quella carta non e' anche in wishlist/binder.
PRIORITY_ALERT = 0
PRIORITY_WISHLIST = 1
PRIORITY_BINDER = 2
PRIORITY_CATALOG = 3


def fetch_priority_batch(conn, limit: int):
    """Le prossime `limit` carte da risincronizzare, ordinate PRIMA per fascia
    di priorita' (allarmi armati, poi desideri, poi binder, poi resto del
    catalogo - una carta di fascia 0 gia' vista di recente passa comunque
    prima di una carta di fascia 3 mai vista) e SOLO ALL'INTERNO DI CIASCUNA
    FASCIA per "quanto e' vecchio l'ultimo tentativo su questa carta"
    (COALESCE(last_attempted_at, captured_at_ts), NULLS FIRST cosi' una
    carta mai nemmeno tentata viene prima di qualunque carta gia' tentata
    almeno una volta nella sua fascia).
    Nessun cursore/offset da passare: la carta appena tentata da QUESTA
    chiamata avra' last_attempted_at piu' recente della sua fascia al
    prossimo giro, quindi scivola in coda da sola (vedi commento su
    sync_checkpoint in web/db/schema.sql).

    Usa last_attempted_at (aggiornato ad OGNI tentativo, riuscito o no - vedi
    mark_attempted) e non captured_at_ts (aggiornato SOLO sui successi, da
    upsert_latest_price) apposta: una carta che fallisce sempre altrimenti
    avrebbe captured_at_ts eternamente vecchio/NULL e si ripresenterebbe in
    cima alla sua fascia ad ogni singolo run, rischiando di bloccare l'intero
    batch (con 15+ carte cosi', il circuit breaker di
    scripts/sync_prices_priority.py scatterebbe prima di raggiungere
    qualunque altra carta) - bug di starvation reale, trovato in review su
    questa PR."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT b.id, b.name, b.expansion_name,
                   CASE
                     WHEN EXISTS (SELECT 1 FROM price_alerts pa WHERE pa.blueprint_id = b.id AND pa.state = 'armed') THEN %(p_alert)s
                     WHEN EXISTS (SELECT 1 FROM wishlist_cards w WHERE w.blueprint_id = b.id) THEN %(p_wishlist)s
                     WHEN EXISTS (SELECT 1 FROM binder_cards c WHERE c.blueprint_id = b.id) THEN %(p_binder)s
                     ELSE %(p_catalog)s
                   END AS priority
            FROM blueprints b
            LEFT JOIN latest_prices lp ON lp.blueprint_id = b.id
            ORDER BY priority ASC, COALESCE(lp.last_attempted_at, lp.captured_at_ts) ASC NULLS FIRST, b.id ASC
            LIMIT %(limit)s
            """,
            {"p_alert": PRIORITY_ALERT, "p_wishlist": PRIORITY_WISHLIST, "p_binder": PRIORITY_BINDER,
             "p_catalog": PRIORITY_CATALOG, "limit": limit},
        )
        return cur.fetchall()


def mark_attempted(conn, blueprint_id: int, attempted_at: str):
    """Registra "abbiamo provato a sincronizzare questa carta adesso",
    A PRESCINDERE dall'esito - va chiamata (e committata) PRIMA della
    chiamata a CardTrader, cosi' resta valida anche se quella chiamata fallisce
    e il resto della transazione va in rollback (vedi fetch_priority_batch sul
    perche' serve: altrimenti una carta che fallisce sempre bloccherebbe la
    coda per tutte le altre). Un semplice UPDATE non basta per una carta mai
    vista prima (nessuna riga in latest_prices ancora): upsert minimale che
    non tocca nessun campo di prezzo se la riga non esiste gia'."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO latest_prices (blueprint_id, last_attempted_at)
            VALUES (%s, %s)
            ON CONFLICT (blueprint_id) DO UPDATE SET last_attempted_at = EXCLUDED.last_attempted_at
            """,
            (blueprint_id, attempted_at),
        )


def record_sync_checkpoint(conn, started_at: str, finished_at: str, budget_seconds: int,
                            tier_counts: dict, cards_ok: int, cards_error: int,
                            circuit_breaker_triggered: bool):
    """Una riga per run dello scheduler prioritario - solo osservabilita'
    (vedi commento sulla tabella in web/db/schema.sql), mai letta per
    decidere quali carte processare al prossimo giro."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO sync_checkpoint
                (started_at, finished_at, budget_seconds, alert_count, wishlist_count, binder_count,
                 catalog_count, cards_ok, cards_error, circuit_breaker_triggered)
            VALUES (%(started_at)s, %(finished_at)s, %(budget_seconds)s, %(alert_count)s,
                    %(wishlist_count)s, %(binder_count)s, %(catalog_count)s, %(cards_ok)s,
                    %(cards_error)s, %(circuit_breaker_triggered)s)
            """,
            {
                "started_at": started_at, "finished_at": finished_at, "budget_seconds": budget_seconds,
                "alert_count": tier_counts.get(PRIORITY_ALERT, 0),
                "wishlist_count": tier_counts.get(PRIORITY_WISHLIST, 0),
                "binder_count": tier_counts.get(PRIORITY_BINDER, 0),
                "catalog_count": tier_counts.get(PRIORITY_CATALOG, 0),
                "cards_ok": cards_ok, "cards_error": cards_error,
                "circuit_breaker_triggered": circuit_breaker_triggered,
            },
        )


# --- Allarmi prezzo (sotto-parte 4c del piano: valutatore + coda di invio
# Telegram - le tabelle e il CRUD dell'account sono gia' arrivati con 4a/4b) ---

MAX_TELEGRAM_MESSAGE_LENGTH = 4096  # limite reale dell'API Bot di Telegram
MAX_OUTBOX_RETRIES = 8
OUTBOX_BATCH_SIZE = 20


def find_matching_listing_price(conn, blueprint_id: int, language: str | None,
                                 condition: str | None, can_sell_via_hub: int | None):
    """Stesso identico algoritmo di findMatchingListingPrice in
    web/lib/account.server.ts (TypeScript, usata li' per fissare il
    baseline alla creazione di un allarme): inserzione piu' economica per
    un profilo ESATTO, None = nessun vincolo su quel campo - MAI un
    fallback su un profilo diverso da quello scelto dall'utente. Le due
    implementazioni vivono in runtime separati (Python qui, TypeScript
    li') e vanno tenute allineate a mano se la logica cambia."""
    conditions = ["blueprint_id = %s"]
    params: list = [blueprint_id]
    if language is not None:
        conditions.append("language = %s")
        params.append(language)
    if condition is not None:
        conditions.append("condition = %s")
        params.append(condition)
    if can_sell_via_hub is not None:
        conditions.append("can_sell_via_hub = %s")
        params.append(can_sell_via_hub)
    with conn.cursor() as cur:
        cur.execute(
            f"""SELECT price_cents, price_currency FROM price_listings
                WHERE {' AND '.join(conditions)}
                ORDER BY price_cents ASC LIMIT 1""",
            params,
        )
        row = cur.fetchone()
    if not row:
        return None
    return {"price_cents": row[0], "currency": row[1]}


def _alert_target_met(alert: dict, current_price_cents: int) -> bool:
    if alert["target_type"] == "absolute_cents":
        return current_price_cents <= alert["target_value"]
    baseline = alert["baseline_price_cents"]
    if baseline is None:
        # Non dovrebbe mai succedere (vincolo CHECK in web/db/schema.sql
        # impone un baseline per percent_drop), difesa in profondita' - un
        # allarme senza riferimento non puo' scattare per calo percentuale.
        return False
    threshold = baseline * (100 - alert["target_value"]) / 100
    return current_price_cents <= threshold


def _format_alert_message(card_name: str, expansion_name: str, alert: dict,
                           current_price_cents: int, currency: str | None) -> str:
    profile_bits = [
        f"lingua {alert['language']}" if alert["language"] else "qualunque lingua",
        f"condizione {alert['condition']}" if alert["condition"] else "qualunque condizione",
    ]
    if alert["can_sell_via_hub"] == 1:
        profile_bits.append("solo CardTrader Zero")
    elif alert["can_sell_via_hub"] == 0:
        profile_bits.append("mai CardTrader Zero")

    symbol = {"EUR": "€", "USD": "$", "GBP": "£"}.get(currency, currency or "")
    price_str = f"{current_price_cents / 100:.2f}{symbol}"
    if alert["target_type"] == "absolute_cents":
        target_str = f"sotto la soglia di {alert['target_value'] / 100:.2f}{symbol}"
    else:
        baseline_cents = alert["baseline_price_cents"]
        baseline_str = f"{baseline_cents / 100:.2f}{symbol}" if baseline_cents is not None else "?"
        target_str = f"calo del {alert['target_value']}% (partito da {baseline_str})"

    text = (
        f"🔔 *{card_name}* ({expansion_name})\n"
        f"Prezzo attuale: {price_str} — {target_str}\n"
        f"Profilo: {', '.join(profile_bits)}"
    )
    return text[:MAX_TELEGRAM_MESSAGE_LENGTH]


def evaluate_price_alerts_for_blueprint(conn, blueprint_id: int, card_name: str, expansion_name: str) -> int:
    """Da chiamare SUBITO dopo replace_price_listings() per la stessa
    carta, nella stessa transazione per-carta (vedi scripts/sync_prices_priority.py):
    legge i prezzi appena scritti, nessuna chiamata API aggiuntiva. Valuta
    solo gli allarmi 'armed' per questa carta; su scatto, accoda un
    messaggio in telegram_outbox (mai inviato direttamente da qui, vedi
    drain_telegram_outbox sotto) e porta l'allarme a state='fired'
    (fired_at=now()) - per fire_mode='rearm' torna 'armed' da solo dopo il
    cooldown, vedi rearm_due_price_alerts. Un allarme senza un
    collegamento Telegram attivo (nessuna riga in telegram_links per
    l'utente) scatta comunque a livello di stato (l'utente ha comunque
    raggiunto la sua soglia), ma nessun messaggio viene accodato: senza un
    chat_id non c'e' nessun posto dove mandarlo. Ritorna quanti allarmi
    sono scattati in questa chiamata."""
    with conn.cursor() as cur:
        cur.execute(
            """SELECT id, user_id, language, condition, can_sell_via_hub,
                      target_type, target_value, baseline_price_cents,
                      baseline_currency, fire_mode
               FROM price_alerts
               WHERE blueprint_id = %s AND state = 'armed'""",
            (blueprint_id,),
        )
        rows = cur.fetchall()
    if not rows:
        return 0

    fired = 0
    now = datetime.now(timezone.utc)
    for (alert_id, user_id, language, condition, can_sell_via_hub,
         target_type, target_value, baseline_price_cents, baseline_currency, fire_mode) in rows:
        alert = {
            "language": language, "condition": condition, "can_sell_via_hub": can_sell_via_hub,
            "target_type": target_type, "target_value": target_value,
            "baseline_price_cents": baseline_price_cents, "baseline_currency": baseline_currency,
        }
        matching = find_matching_listing_price(conn, blueprint_id, language, condition, can_sell_via_hub)
        if matching is None or not _alert_target_met(alert, matching["price_cents"]):
            continue

        with conn.cursor() as cur:
            cur.execute(
                "UPDATE price_alerts SET state = 'fired', fired_at = %s WHERE id = %s AND state = 'armed'",
                (now, alert_id),
            )
            if cur.rowcount == 0:
                continue  # gia' scattato nel frattempo (difesa in profondita', non doppio-accodare)

            cur.execute("SELECT chat_id FROM telegram_links WHERE user_id = %s", (user_id,))
            link = cur.fetchone()
            if link:
                text = _format_alert_message(
                    card_name, expansion_name, alert, matching["price_cents"],
                    matching["currency"] or baseline_currency,
                )
                # Una riga per (allarme, giorno di scatto): protegge da un
                # doppio accodamento se questa carta venisse rivalutata due
                # volte lo stesso giorno per qualche motivo, MAI da un
                # doppio invio Telegram vero e proprio (vedi il commento
                # sulla tabella in web/db/schema.sql).
                dedup_key = f"alert:{alert_id}:{now.date().isoformat()}"
                cur.execute(
                    """INSERT INTO telegram_outbox (alert_id, chat_id, dedup_key, payload)
                       VALUES (%s, %s, %s, %s)
                       ON CONFLICT (dedup_key) DO NOTHING""",
                    (alert_id, link[0], dedup_key, text),
                )
        fired += 1
    return fired


def rearm_due_price_alerts(conn) -> int:
    """Riporta 'armed' gli allarmi fire_mode='rearm' il cui cooldown (ore)
    dal precedente scatto e' scaduto - chiamata una volta per run (non per
    carta, a differenza di evaluate_price_alerts_for_blueprint sopra),
    stesso principio di prune_old_history: un controllo economico su
    tutta la tabella, non serve farlo piu' spesso di una volta a batch."""
    with conn.cursor() as cur:
        cur.execute(
            """UPDATE price_alerts
               SET state = 'armed'
               WHERE state = 'fired' AND fire_mode = 'rearm'
                 AND fired_at IS NOT NULL
                 AND fired_at + (rearm_cooldown_hours * interval '1 hour') <= now()"""
        )
        return cur.rowcount


def fetch_pending_outbox(conn, limit: int = OUTBOX_BATCH_SIZE):
    """Messaggi non ancora confermati inviati, pronti per un nuovo
    tentativo: backoff crescente (2^retry_count minuti, tetto 60) tra un
    tentativo e il successivo sullo stesso messaggio, MAX_OUTBOX_RETRIES
    oltre cui un messaggio smette di essere ritentato (resta per sempre
    non inviato piuttosto che intasare la coda all'infinito)."""
    with conn.cursor() as cur:
        cur.execute(
            """SELECT id, chat_id, payload
               FROM telegram_outbox
               WHERE sent_at IS NULL
                 AND retry_count < %s
                 AND (last_attempted_at IS NULL
                      OR last_attempted_at <= now() - (LEAST(POWER(2, retry_count), 60) * interval '1 minute'))
               ORDER BY created_at ASC
               LIMIT %s""",
            (MAX_OUTBOX_RETRIES, limit),
        )
        return cur.fetchall()


def mark_outbox_sent(conn, outbox_id: int):
    with conn.cursor() as cur:
        cur.execute("UPDATE telegram_outbox SET sent_at = now() WHERE id = %s", (outbox_id,))


def mark_outbox_failed(conn, outbox_id: int):
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE telegram_outbox SET retry_count = retry_count + 1, last_attempted_at = now() WHERE id = %s",
            (outbox_id,),
        )

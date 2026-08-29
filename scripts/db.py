"""
Gestione dei due database SQLite locali, entrambi versionati dentro data/ e
letti direttamente nel browser tramite sql.js:

- cardtrader.db: catalogo (espansioni, carte), l'ultimo prezzo noto di ogni
  carta (latest_prices) e le inserzioni piu' economiche del momento
  (price_listings). E' il file scaricato ad OGNI visita del sito (serve per
  la griglia), quindi va tenuto piccolo.
- price_history.db: lo storico giorno-per-giorno dei prezzi (price_snapshots).
  Cresce nel tempo (una riga per carta per giorno), ma viene scaricato solo
  quando apri il dettaglio di una carta specifica, non per navigare il sito.
  I dati piu' vecchi di RETENTION_DAILY_DAYS vengono compressi automaticamente
  a un punto a settimana, cosi' la crescita a lungo termine resta limitata.
"""
import sqlite3
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = REPO_ROOT / "data" / "cardtrader.db"
HISTORY_DB_PATH = REPO_ROOT / "data" / "price_history.db"

RETENTION_DAILY_DAYS = 120  # oltre questa soglia lo storico si comprime a 1 punto/settimana

SCHEMA = """
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
    last_synced_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_blueprint_expansion
    ON blueprints (expansion_id);

-- Solo l'ultimo prezzo noto e quello precedente (per la freccina su/giu'),
-- una riga per carta: e' una "vista materializzata" di price_history.db,
-- cosi' la griglia principale non deve mai scaricare lo storico completo.
CREATE TABLE IF NOT EXISTS latest_prices (
    blueprint_id INTEGER PRIMARY KEY,
    captured_at TEXT,
    captured_at_ts TEXT,
    min_price_cents INTEGER,
    min_price_currency TEXT,
    avg_price_cents INTEGER,
    listings_count INTEGER,
    cheapest_condition TEXT,
    cheapest_language TEXT,
    cheapest_foil INTEGER,
    prev_price_cents INTEGER,
    prev_captured_at TEXT,
    FOREIGN KEY (blueprint_id) REFERENCES blueprints(id)
);

-- Le migliori inserzioni live per ogni carta (non storico: ad ogni sync
-- sostituiamo le righe della carta con le inserzioni piu' economiche del
-- momento, cosi' la tabella resta piccola invece di accumulare per sempre).
CREATE TABLE IF NOT EXISTS price_listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    blueprint_id INTEGER NOT NULL,
    captured_at TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    price_currency TEXT,
    condition TEXT,
    language TEXT,
    quantity INTEGER,
    seller_username TEXT,
    can_sell_via_hub INTEGER DEFAULT 0,
    FOREIGN KEY (blueprint_id) REFERENCES blueprints(id)
);

CREATE INDEX IF NOT EXISTS idx_listings_blueprint
    ON price_listings (blueprint_id, price_cents);

CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
);
"""

HISTORY_SCHEMA = """
CREATE TABLE IF NOT EXISTS price_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    blueprint_id INTEGER NOT NULL,
    captured_at TEXT NOT NULL,      -- data UTC, formato YYYY-MM-DD
    captured_at_ts TEXT NOT NULL,   -- timestamp completo ISO
    min_price_cents INTEGER,
    min_price_currency TEXT,
    avg_price_cents INTEGER,
    listings_count INTEGER,
    cheapest_condition TEXT,
    cheapest_language TEXT,
    cheapest_foil INTEGER
);

CREATE INDEX IF NOT EXISTS idx_price_blueprint_date
    ON price_snapshots (blueprint_id, captured_at);
"""


def get_connection() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def get_history_connection() -> sqlite3.Connection:
    HISTORY_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return sqlite3.connect(HISTORY_DB_PATH)


def init_db():
    conn = get_connection()
    conn.executescript(SCHEMA)
    _migrate_legacy_price_snapshots(conn)
    conn.commit()
    conn.close()

    history_conn = get_history_connection()
    history_conn.executescript(HISTORY_SCHEMA)
    history_conn.commit()
    history_conn.close()


def _migrate_legacy_price_snapshots(conn):
    """Una tantum: le prime versioni del tracker tenevano price_snapshots
    dentro cardtrader.db insieme al catalogo. Se troviamo ancora quella
    tabella qui, spostiamo i dati in price_history.db e la eliminiamo."""
    has_legacy = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='price_snapshots'"
    ).fetchone()
    if not has_legacy:
        return

    print("Migrazione: sposto price_snapshots da cardtrader.db a price_history.db...")
    rows = conn.execute(
        "SELECT blueprint_id, captured_at, captured_at_ts, min_price_cents, "
        "min_price_currency, avg_price_cents, listings_count, cheapest_condition, "
        "cheapest_language, cheapest_foil FROM price_snapshots"
    ).fetchall()

    history_conn = get_history_connection()
    history_conn.executescript(HISTORY_SCHEMA)
    history_conn.executemany(
        """INSERT INTO price_snapshots
           (blueprint_id, captured_at, captured_at_ts, min_price_cents,
            min_price_currency, avg_price_cents, listings_count,
            cheapest_condition, cheapest_language, cheapest_foil)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        rows,
    )
    history_conn.commit()

    # Ripopola latest_prices (ultimo prezzo noto + precedente) dai dati appena
    # migrati, altrimenti le carte gia' sincronizzate risulterebbero senza
    # prezzo finche' non arriva il prossimo sync.
    per_blueprint: dict = {}
    for r in rows:
        bp_id = r[0]
        per_blueprint.setdefault(bp_id, []).append(r)
    backfilled = 0
    for bp_id, snaps in per_blueprint.items():
        snaps.sort(key=lambda r: r[1])  # per captured_at, crescente
        latest = snaps[-1]
        prev = snaps[-2] if len(snaps) > 1 else None
        conn.execute(
            """
            INSERT INTO latest_prices
                (blueprint_id, captured_at, captured_at_ts, min_price_cents,
                 min_price_currency, avg_price_cents, listings_count,
                 cheapest_condition, cheapest_language, cheapest_foil,
                 prev_price_cents, prev_captured_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(blueprint_id) DO NOTHING
            """,
            (
                bp_id, latest[1], latest[2], latest[3], latest[4], latest[5],
                latest[6], latest[7], latest[8], latest[9],
                prev[3] if prev else None, prev[1] if prev else None,
            ),
        )
        backfilled += 1
    history_conn.close()

    conn.execute("DROP TABLE price_snapshots")
    conn.commit()
    conn.execute("VACUUM")  # altrimenti sqlite non restituisce lo spazio liberato dalla tabella spostata
    print(f"Migrazione completata: {len(rows)} righe spostate, "
          f"{backfilled} carte ripopolate in latest_prices.")


def upsert_expansion(conn, exp: dict):
    conn.execute(
        """
        INSERT INTO expansions (id, game_id, code, name)
        VALUES (:id, :game_id, :code, :name)
        ON CONFLICT(id) DO UPDATE SET
            game_id=excluded.game_id, code=excluded.code, name=excluded.name
        """,
        exp,
    )


def upsert_blueprint(conn, bp: dict, expansion_code: str, expansion_name: str,
                       is_premium: bool, synced_at: str):
    conn.execute(
        """
        INSERT INTO blueprints
            (id, name, version, game_id, category_id, expansion_id,
             expansion_code, expansion_name, image_url, scryfall_id,
             tcg_player_id, is_premium, last_synced_at)
        VALUES
            (:id, :name, :version, :game_id, :category_id, :expansion_id,
             :expansion_code, :expansion_name, :image_url, :scryfall_id,
             :tcg_player_id, :is_premium, :synced_at)
        ON CONFLICT(id) DO UPDATE SET
            name=excluded.name, version=excluded.version,
            image_url=excluded.image_url, is_premium=excluded.is_premium,
            last_synced_at=excluded.last_synced_at
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
            "image_url": bp.get("image_url"),
            "scryfall_id": bp.get("scryfall_id"),
            "tcg_player_id": bp.get("tcg_player_id"),
            "is_premium": int(is_premium),
            "synced_at": synced_at,
        },
    )


def _summarize_products(products: list):
    """Riduce la lista di offerte marketplace ai campi aggregati che salviamo
    (prezzo minimo, medio, condizioni/lingua della piu' economica...)."""
    if not products:
        return None
    prices = [p["price"]["cents"] for p in products if p.get("price")]
    cheapest = min(products, key=lambda p: p["price"]["cents"])
    avg_cents = int(sum(prices) / len(prices)) if prices else None
    return {
        "min_price_cents": cheapest["price"]["cents"],
        "min_price_currency": cheapest["price"]["currency"],
        "avg_price_cents": avg_cents,
        "listings_count": len(products),
        "cheapest_condition": cheapest.get("properties_hash", {}).get("condition"),
        "cheapest_language": cheapest.get("properties_hash", {}).get("pokemon_language")
            or cheapest.get("properties_hash", {}).get("mtg_language"),
        "cheapest_foil": int(bool(cheapest.get("properties_hash", {}).get("pokemon_foil"))),
    }


def insert_price_snapshot(history_conn, blueprint_id: int, captured_at: str,
                            captured_at_ts: str, products: list):
    """Aggiunge (o sovrascrive, se rilanciato lo stesso giorno) il punto di
    storico odierno in price_history.db."""
    history_conn.execute(
        "DELETE FROM price_snapshots WHERE blueprint_id = ? AND captured_at = ?",
        (blueprint_id, captured_at),
    )
    summary = _summarize_products(products)
    if summary is None:
        history_conn.execute(
            """INSERT INTO price_snapshots
               (blueprint_id, captured_at, captured_at_ts, min_price_cents,
                min_price_currency, avg_price_cents, listings_count,
                cheapest_condition, cheapest_language, cheapest_foil)
               VALUES (?, ?, ?, NULL, NULL, NULL, 0, NULL, NULL, NULL)""",
            (blueprint_id, captured_at, captured_at_ts),
        )
        return
    history_conn.execute(
        """INSERT INTO price_snapshots
           (blueprint_id, captured_at, captured_at_ts, min_price_cents,
            min_price_currency, avg_price_cents, listings_count,
            cheapest_condition, cheapest_language, cheapest_foil)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            blueprint_id, captured_at, captured_at_ts,
            summary["min_price_cents"], summary["min_price_currency"],
            summary["avg_price_cents"], summary["listings_count"],
            summary["cheapest_condition"], summary["cheapest_language"],
            summary["cheapest_foil"],
        ),
    )


def upsert_latest_price(conn, history_conn, blueprint_id: int, captured_at: str,
                          captured_at_ts: str, products: list):
    """Aggiorna la "vista materializzata" latest_prices in cardtrader.db.
    Il prezzo precedente (per la freccina) viene letto da price_history.db:
    e' sempre corretto anche se il sync viene rilanciato piu' volte lo
    stesso giorno, a differenza di tenere il "prev" copiandolo dal valore
    precedente di latest_prices (che si romperebbe sui rilanci)."""
    prev_row = history_conn.execute(
        "SELECT captured_at, min_price_cents FROM price_snapshots "
        "WHERE blueprint_id = ? AND captured_at < ? AND min_price_cents IS NOT NULL "
        "ORDER BY captured_at DESC LIMIT 1",
        (blueprint_id, captured_at),
    ).fetchone()
    prev_captured_at, prev_price_cents = prev_row if prev_row else (None, None)

    summary = _summarize_products(products) or {
        "min_price_cents": None, "min_price_currency": None, "avg_price_cents": None,
        "listings_count": 0, "cheapest_condition": None, "cheapest_language": None,
        "cheapest_foil": None,
    }

    conn.execute(
        """
        INSERT INTO latest_prices
            (blueprint_id, captured_at, captured_at_ts, min_price_cents,
             min_price_currency, avg_price_cents, listings_count,
             cheapest_condition, cheapest_language, cheapest_foil,
             prev_price_cents, prev_captured_at)
        VALUES (:blueprint_id, :captured_at, :captured_at_ts, :min_price_cents,
                :min_price_currency, :avg_price_cents, :listings_count,
                :cheapest_condition, :cheapest_language, :cheapest_foil,
                :prev_price_cents, :prev_captured_at)
        ON CONFLICT(blueprint_id) DO UPDATE SET
            captured_at=excluded.captured_at, captured_at_ts=excluded.captured_at_ts,
            min_price_cents=excluded.min_price_cents,
            min_price_currency=excluded.min_price_currency,
            avg_price_cents=excluded.avg_price_cents,
            listings_count=excluded.listings_count,
            cheapest_condition=excluded.cheapest_condition,
            cheapest_language=excluded.cheapest_language,
            cheapest_foil=excluded.cheapest_foil,
            prev_price_cents=excluded.prev_price_cents,
            prev_captured_at=excluded.prev_captured_at
        """,
        {
            "blueprint_id": blueprint_id,
            "captured_at": captured_at,
            "captured_at_ts": captured_at_ts,
            "prev_price_cents": prev_price_cents,
            "prev_captured_at": prev_captured_at,
            **summary,
        },
    )


def replace_price_listings(conn, blueprint_id: int, captured_at: str, products: list, top_n: int = 5):
    """Sostituisce le inserzioni salvate per questa carta con le top_n piu'
    economiche del momento (non e' uno storico, solo l'ultimo sync)."""
    conn.execute("DELETE FROM price_listings WHERE blueprint_id = ?", (blueprint_id,))
    if not products:
        return
    cheapest_first = sorted(products, key=lambda p: p["price"]["cents"])[:top_n]
    conn.executemany(
        """INSERT INTO price_listings
           (blueprint_id, captured_at, price_cents, price_currency, condition,
            language, quantity, seller_username, can_sell_via_hub)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
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
            )
            for p in cheapest_first
        ],
    )


def prune_old_history(history_conn, keep_daily_days: int = RETENTION_DAILY_DAYS):
    """Oltre keep_daily_days, tiene un solo punto a settimana per carta invece
    di uno al giorno: limita la crescita a lungo termine di price_history.db
    senza perdere la tendenza generale (i dati recenti restano al dettaglio
    giornaliero)."""
    from datetime import datetime, timedelta, timezone
    cutoff = (datetime.now(timezone.utc) - timedelta(days=keep_daily_days)).strftime("%Y-%m-%d")
    deleted = history_conn.execute(
        """
        DELETE FROM price_snapshots
        WHERE captured_at < ?
        AND id NOT IN (
            SELECT MIN(id) FROM price_snapshots
            WHERE captured_at < ?
            GROUP BY blueprint_id, strftime('%Y-%W', captured_at)
        )
        """,
        (cutoff, cutoff),
    ).rowcount
    if deleted:
        history_conn.commit()
        history_conn.execute("VACUUM")  # restituisce lo spazio liberato dalle righe cancellate
    return deleted


def set_meta(conn, key: str, value: str):
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, value),
    )

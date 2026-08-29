"""
Gestione del database SQLite locale (versionato dentro data/cardtrader.db).
Il database viene letto anche direttamente nel browser tramite sql.js,
quindi lo schema resta volutamente semplice e "piatto".
"""
import sqlite3
import json
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "cardtrader.db"

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
    cheapest_foil INTEGER,
    FOREIGN KEY (blueprint_id) REFERENCES blueprints(id)
);

CREATE INDEX IF NOT EXISTS idx_price_blueprint_date
    ON price_snapshots (blueprint_id, captured_at);

CREATE INDEX IF NOT EXISTS idx_blueprint_expansion
    ON blueprints (expansion_id);

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


def get_connection() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_connection()
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()


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


def insert_price_snapshot(conn, blueprint_id: int, captured_at: str, captured_at_ts: str,
                            products: list):
    if not products:
        conn.execute(
            """INSERT INTO price_snapshots
               (blueprint_id, captured_at, captured_at_ts, min_price_cents,
                min_price_currency, avg_price_cents, listings_count,
                cheapest_condition, cheapest_language, cheapest_foil)
               VALUES (?, ?, ?, NULL, NULL, NULL, 0, NULL, NULL, NULL)""",
            (blueprint_id, captured_at, captured_at_ts),
        )
        return

    prices = [p["price"]["cents"] for p in products if p.get("price")]
    cheapest = min(products, key=lambda p: p["price"]["cents"])
    avg_cents = int(sum(prices) / len(prices)) if prices else None

    conn.execute(
        """INSERT INTO price_snapshots
           (blueprint_id, captured_at, captured_at_ts, min_price_cents,
            min_price_currency, avg_price_cents, listings_count,
            cheapest_condition, cheapest_language, cheapest_foil)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            blueprint_id,
            captured_at,
            captured_at_ts,
            cheapest["price"]["cents"],
            cheapest["price"]["currency"],
            avg_cents,
            len(products),
            cheapest.get("properties_hash", {}).get("condition"),
            cheapest.get("properties_hash", {}).get("pokemon_language")
                or cheapest.get("properties_hash", {}).get("mtg_language"),
            int(bool(cheapest.get("properties_hash", {}).get("pokemon_foil"))),
        ),
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


def set_meta(conn, key: str, value: str):
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, value),
    )

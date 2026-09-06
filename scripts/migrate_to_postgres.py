"""
Migrazione una tantum: copia il catalogo e lo storico prezzi da SQLite
(data/cardtrader.db + data/price_history.db) al Postgres di CartaViva
(stesso database usato da login/profili, POSTGRES_URL - vedi
web/lib/pgPool.ts e web/db/schema.sql).

Va lanciato UNA VOLTA dopo aver applicato web/db/schema.sql sul Postgres di
destinazione, prima di spostare i workflow di sync su scripts/db.py
riscritto per Postgres. E' idempotente (INSERT ... ON CONFLICT DO UPDATE):
si puo' rilanciare in sicurezza se interrotto a meta' o per ripetere la
migrazione dopo un nuovo sync SQLite.

Gli id auto-incrementali di price_listings/price_snapshots NON vengono
preservati (in Postgres sono BIGSERIAL): non serve, nessun dato esterno
referenzia quegli id, solo l'ordine relativo all'interno di una carta
(usato come tie-break a parita' di prezzo) - order-by sull'id nuovo
funziona identico perche' inseriamo nello stesso ordine di lettura da
SQLite.

Uso:
  POSTGRES_URL=postgres://... python scripts/migrate_to_postgres.py
  POSTGRES_URL=postgres://... python scripts/migrate_to_postgres.py --dry-run
"""
import os
import sqlite3
import sys
from pathlib import Path

import psycopg2
import psycopg2.extras
import psycopg2.sql

REPO_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = REPO_ROOT / "data" / "cardtrader.db"
HISTORY_DB_PATH = REPO_ROOT / "data" / "price_history.db"

BATCH_SIZE = 5000


def _sqlite_conn(path: Path) -> sqlite3.Connection:
    if not path.exists():
        print(f"ERRORE: {path} non trovato.", file=sys.stderr)
        sys.exit(1)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def _pg_conn():
    dsn = os.environ.get("POSTGRES_URL")
    if not dsn:
        print("ERRORE: variabile d'ambiente POSTGRES_URL mancante.", file=sys.stderr)
        sys.exit(1)
    return psycopg2.connect(dsn)


def _migrate_table(sqlite_conn, pg_cur, *, select_sql: str, columns: list[str],
                    insert_table: str, conflict_key: str, label: str, dry_run: bool) -> int:
    """Legge righe da SQLite in batch e le carica in Postgres con
    INSERT ... ON CONFLICT DO UPDATE (idempotente, rilanciabile)."""
    cur = sqlite_conn.execute(select_sql)
    update_cols = [c for c in columns if c != conflict_key]
    query = psycopg2.sql.SQL(
        "INSERT INTO {table} ({cols}) VALUES %s "
        "ON CONFLICT ({conflict}) DO UPDATE SET {updates}"
    ).format(
        table=psycopg2.sql.Identifier(insert_table),
        cols=psycopg2.sql.SQL(", ").join(psycopg2.sql.Identifier(c) for c in columns),
        conflict=psycopg2.sql.Identifier(conflict_key),
        updates=psycopg2.sql.SQL(", ").join(
            psycopg2.sql.SQL("{c} = EXCLUDED.{c}").format(c=psycopg2.sql.Identifier(c))
            for c in update_cols
        ),
    )

    total = 0
    while True:
        rows = cur.fetchmany(BATCH_SIZE)
        if not rows:
            break
        values = [tuple(row[c] for c in columns) for row in rows]
        if not dry_run:
            psycopg2.extras.execute_values(pg_cur, query, values, page_size=BATCH_SIZE)
        total += len(values)
        print(f"  {label}: {total} righe migrate...", end="\r")
    print(f"  {label}: {total} righe migrate." + " " * 10)
    return total


def _migrate_price_listings(sqlite_conn, pg_cur, dry_run: bool) -> int:
    """price_listings non ha un vincolo UNIQUE naturale oltre l'id
    autoincrementale (che qui non replichiamo): a differenza delle altre
    tabelle usiamo un semplice INSERT senza ON CONFLICT, protetto da uno
    svuotamento preventivo della tabella - stesso comportamento di
    replace_price_listings in scripts/db.py (sostituzione, non merge). Fa
    si' che rilanciare la migrazione non duplichi le righe."""
    columns = [
        "blueprint_id", "captured_at", "price_cents", "price_currency",
        "condition", "language", "quantity", "seller_username",
        "can_sell_via_hub", "ships_from_country",
    ]
    if not dry_run:
        pg_cur.execute("TRUNCATE price_listings")
    cur = sqlite_conn.execute(
        f"SELECT {', '.join(columns)} FROM price_listings ORDER BY blueprint_id, id"
    )
    query = f"INSERT INTO price_listings ({', '.join(columns)}) VALUES %s"
    total = 0
    while True:
        rows = cur.fetchmany(BATCH_SIZE)
        if not rows:
            break
        values = [tuple(row[c] for c in columns) for row in rows]
        if not dry_run:
            psycopg2.extras.execute_values(pg_cur, query, values, page_size=BATCH_SIZE)
        total += len(values)
        print(f"  price_listings: {total} righe migrate...", end="\r")
    print(f"  price_listings: {total} righe migrate." + " " * 10)
    return total


def _migrate_price_snapshots(history_conn, pg_cur, dry_run: bool) -> int:
    """Stesso motivo di _migrate_price_listings per l'id non replicato, ma
    qui una carta puo' avere piu' snapshot (uno per captured_at): il
    conflitto naturale e' (blueprint_id, captured_at), non replicato pero'
    da un vincolo UNIQUE nello schema Postgres (solo un indice, non unico -
    insert_price_snapshot in scripts/db.py fa gia' una DELETE preventiva
    invece di affidarsi a ON CONFLICT). Qui l'intera tabella e' vuota in
    partenza (prima migrazione) o va risvuotata per un rerun pulito."""
    columns = [
        "blueprint_id", "captured_at", "captured_at_ts", "min_price_cents",
        "min_price_currency", "avg_price_cents", "listings_count",
        "cheapest_condition", "cheapest_language", "cheapest_foil",
        "best_price_cents", "it_nm_zero_price_cents",
    ]
    if not dry_run:
        pg_cur.execute("TRUNCATE price_snapshots")
    cur = history_conn.execute(
        f"SELECT {', '.join(columns)} FROM price_snapshots ORDER BY blueprint_id, id"
    )
    query = f"INSERT INTO price_snapshots ({', '.join(columns)}) VALUES %s"
    total = 0
    while True:
        rows = cur.fetchmany(BATCH_SIZE)
        if not rows:
            break
        values = [tuple(row[c] for c in columns) for row in rows]
        if not dry_run:
            psycopg2.extras.execute_values(pg_cur, query, values, page_size=BATCH_SIZE)
        total += len(values)
        print(f"  price_snapshots: {total} righe migrate...", end="\r")
    print(f"  price_snapshots: {total} righe migrate." + " " * 10)
    return total


def main():
    dry_run = "--dry-run" in sys.argv

    conn = _sqlite_conn(DB_PATH)
    history_conn = _sqlite_conn(HISTORY_DB_PATH)
    pg = _pg_conn()
    pg_cur = pg.cursor()

    print(f"Migrazione {DB_PATH.name} + {HISTORY_DB_PATH.name} -> Postgres"
          + (" (dry-run, nessuna scrittura)" if dry_run else "") + "...\n")

    print("expansions...")
    _migrate_table(
        conn, pg_cur,
        select_sql="SELECT id, game_id, code, name FROM expansions",
        columns=["id", "game_id", "code", "name"],
        insert_table="expansions", conflict_key="id", label="expansions",
        dry_run=dry_run,
    )

    print("blueprints...")
    _migrate_table(
        conn, pg_cur,
        select_sql="""SELECT id, name, version, game_id, category_id, expansion_id,
                             expansion_code, expansion_name, image_url, scryfall_id,
                             tcg_player_id, rarity, is_premium, last_synced_at
                      FROM blueprints""",
        columns=["id", "name", "version", "game_id", "category_id", "expansion_id",
                 "expansion_code", "expansion_name", "image_url", "scryfall_id",
                 "tcg_player_id", "rarity", "is_premium", "last_synced_at"],
        insert_table="blueprints", conflict_key="id", label="blueprints",
        dry_run=dry_run,
    )

    print("latest_prices...")
    _migrate_table(
        conn, pg_cur,
        select_sql="""SELECT blueprint_id, captured_at, captured_at_ts, min_price_cents,
                             min_price_currency, avg_price_cents, listings_count,
                             cheapest_condition, cheapest_language, cheapest_foil,
                             languages_available, prev_price_cents, prev_captured_at,
                             best_price_cents, best_price_currency, best_condition,
                             best_language, best_can_sell_via_hub, prev_best_price_cents,
                             it_nm_zero_price_cents, it_nm_zero_price_currency,
                             it_nm_zero_listings_count, prev_it_nm_zero_price_cents
                      FROM latest_prices""",
        columns=["blueprint_id", "captured_at", "captured_at_ts", "min_price_cents",
                 "min_price_currency", "avg_price_cents", "listings_count",
                 "cheapest_condition", "cheapest_language", "cheapest_foil",
                 "languages_available", "prev_price_cents", "prev_captured_at",
                 "best_price_cents", "best_price_currency", "best_condition",
                 "best_language", "best_can_sell_via_hub", "prev_best_price_cents",
                 "it_nm_zero_price_cents", "it_nm_zero_price_currency",
                 "it_nm_zero_listings_count", "prev_it_nm_zero_price_cents"],
        insert_table="latest_prices", conflict_key="blueprint_id", label="latest_prices",
        dry_run=dry_run,
    )

    print("price_listings...")
    _migrate_price_listings(conn, pg_cur, dry_run)

    print("meta...")
    _migrate_table(
        conn, pg_cur,
        select_sql="SELECT key, value FROM meta",
        columns=["key", "value"],
        insert_table="meta", conflict_key="key", label="meta",
        dry_run=dry_run,
    )

    print("price_snapshots (storico, puo' richiedere qualche minuto)...")
    _migrate_price_snapshots(history_conn, pg_cur, dry_run)

    if dry_run:
        pg.rollback()
        print("\nDry-run completato, nessuna scrittura effettuata.")
        # Il confronto conteggi qui sotto ha senso solo dopo una scrittura
        # vera: in dry-run nessuna riga e' stata inserita, quindi il
        # Postgres di destinazione mostrerebbe quasi sempre un MISMATCH
        # (a meno che non contenga gia' esattamente questi stessi dati) -
        # un falso allarme fuorviante, non un problema reale da segnalare.
        conn.close()
        history_conn.close()
        pg_cur.close()
        pg.close()
        return

    pg.commit()
    print("\nMigrazione completata e confermata (commit).")

    print("\nVerifica conteggi (SQLite vs Postgres):")
    checks = [
        ("expansions", "SELECT COUNT(*) FROM expansions", conn),
        ("blueprints", "SELECT COUNT(*) FROM blueprints", conn),
        ("latest_prices", "SELECT COUNT(*) FROM latest_prices", conn),
        ("price_listings", "SELECT COUNT(*) FROM price_listings", conn),
        ("meta", "SELECT COUNT(*) FROM meta", conn),
        ("price_snapshots", "SELECT COUNT(*) FROM price_snapshots", history_conn),
    ]
    all_match = True
    for table, sql, source_conn in checks:
        sqlite_count = source_conn.execute(sql).fetchone()[0]
        pg_cur.execute(sql)
        pg_count = pg_cur.fetchone()[0]
        match = "OK" if sqlite_count == pg_count else "MISMATCH"
        if sqlite_count != pg_count:
            all_match = False
        print(f"  {table}: SQLite={sqlite_count} Postgres={pg_count} [{match}]")

    conn.close()
    history_conn.close()
    pg_cur.close()
    pg.close()

    if not all_match:
        print("\n[ATTENZIONE] Alcuni conteggi non combaciano, controlla sopra.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

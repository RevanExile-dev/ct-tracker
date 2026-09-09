"""
Interroga il marketplace CardTrader per ogni carta (blueprint) delle
espansioni tracciate e salva uno snapshot di prezzo per la giornata odierna.

Eseguito automaticamente ogni giorno dal workflow GitHub Actions
'.github/workflows/sync_prices.yml' (solo sulle espansioni "daily_expansion_codes"
di config/tracked_sets.json, per restare in tempi ragionevoli) e una volta a
settimana per intero da '.github/workflows/sync_prices_full.yml'.
E' idempotente: se lanciato più volte nello stesso giorno, sovrascrive lo
snapshot del giorno invece di duplicarlo.

I dati vivono nel Postgres di CartaViva (POSTGRES_URL, vedi scripts/db.py):
catalogo + ultimo prezzo noto in blueprints/latest_prices, storico
giorno-per-giorno in price_snapshots. A differenza della vecchia versione
SQLite, qui non c'e' nessun checkpoint da commitare/pushare - ogni sync
scrive direttamente nel database via commit() periodici.

Salta di default le carte che hanno gia' uno snapshot di oggi (es. da un
run precedente della stessa giornata interrotto o rilanciato): rende i
run ripetuti nello stesso giorno molto piu' veloci invece di rifare tutto
da capo. Usa --force per ignorare questo e aggiornare comunque tutto.

Uso:
  python scripts/sync_prices.py               # tutte le carte del catalogo locale
  python scripts/sync_prices.py --only-daily   # solo daily_expansion_codes
  python scripts/sync_prices.py --force        # riaggiorna anche le carte gia' fatte oggi
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from api_client import CardTraderClient
import db

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = REPO_ROOT / "config" / "tracked_sets.json"

# Se troppe carte di fila falliscono (qualunque sia il motivo: CardTrader
# che risponde 429, un errore locale del database, o altro), fermarsi qui
# invece di continuare a perdere tempo su ogni carta rimasta - altrimenti
# con migliaia di carte ancora da processare il job resta "in corso" su
# GitHub Actions per ore senza produrre nessun progresso nuovo,
# indistinguibile da un progresso reale finche' non scade il timeout.
MAX_CONSECUTIVE_ERRORS = 15


def main():
    only_daily = "--only-daily" in sys.argv
    force = "--force" in sys.argv

    db.init_db()
    client = CardTraderClient()
    conn = db.get_connection()
    cur = conn.cursor()

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    where = ["1=1"]
    params: dict = {"today": today}

    if only_daily:
        config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        codes = config.get("daily_expansion_codes", [])
        where.append("b.expansion_code = ANY(%(codes)s)")
        params["codes"] = codes

    if not force:
        where.append(
            "b.id NOT IN (SELECT blueprint_id FROM latest_prices WHERE captured_at = %(today)s)"
        )

    query = (
        "SELECT b.id, b.name, b.expansion_name FROM blueprints b "
        f"WHERE {' AND '.join(where)} ORDER BY b.expansion_id, b.id"
    )
    cur.execute(query, params)
    blueprints = cur.fetchall()

    if not blueprints:
        base_where = [w for w in where if "latest_prices" not in w]
        base_query = (
            "SELECT COUNT(*) FROM blueprints b "
            f"WHERE {' AND '.join(base_where)}"
        )
        cur.execute(base_query, params)
        total_tracked = cur.fetchone()[0]
        if total_tracked == 0:
            print("Nessuna carta nel catalogo. Lancia prima scripts/sync_catalog.py")
            sys.exit(1)
        print(f"Tutte le {total_tracked} carte tracciate hanno gia' un prezzo aggiornato "
              f"oggi ({today}). Usa --force per rifare comunque il sync.")
        return

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    print(f"Aggiorno i prezzi di {len(blueprints)} carte per il {today}"
          + ("" if force else " (gia' aggiornate oggi vengono saltate)") + "...")

    ok, errors, consecutive_errors = 0, 0, 0
    circuit_breaker_triggered = False
    for i, (bp_id, name, expansion_name) in enumerate(blueprints, start=1):
        try:
            products = client.get_marketplace_products(bp_id)

            db.insert_price_snapshot(conn, bp_id, today, now_iso, products)
            db.upsert_latest_price(conn, bp_id, today, now_iso, products)
            db.replace_price_listings(conn, bp_id, today, products)

            # Se troviamo la rarità reale tra le proprietà del prodotto più
            # economico, aggiorniamo il blueprint (più precisa dell'euristica
            # sul nome usata in sync_catalog.py).
            if products:
                props = products[0].get("properties_hash", {}) or {}
                rarity = props.get("pokemon_rarity") or props.get("rarity")
                if rarity:
                    cur.execute(
                        "UPDATE blueprints SET rarity = %s WHERE id = %s",
                        (rarity, bp_id),
                    )

            # Commit per carta (non ogni 25 come nella vecchia versione
            # SQLite): a differenza di sqlite3, dopo un errore Postgres
            # rifiuta ogni comando successivo finche' non arriva una
            # ROLLBACK ("current transaction is aborted") - un commit
            # periodico raggrupperebbe anche il lavoro delle carte riuscite
            # nello stesso batch, che finirebbe scartato dal rollback della
            # carta fallita in mezzo.
            conn.commit()
            ok += 1
            consecutive_errors = 0
        except Exception as exc:  # non bloccare l'intero job per una carta problematica
            print(f"  [ERRORE] {name} ({expansion_name}) id={bp_id}: {exc}", file=sys.stderr)
            conn.rollback()
            errors += 1
            consecutive_errors += 1

        if i % 25 == 0:
            print(f"  ...{i}/{len(blueprints)} carte processate")

        if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
            circuit_breaker_triggered = True
            print(
                f"  [ATTENZIONE] {consecutive_errors} carte di fila fallite "
                f"(qualunque sia il motivo: rate limit, un errore locale del "
                f"database, o altro): mi fermo qui invece di continuare a "
                f"perdere tempo, {i}/{len(blueprints)} carte tentate. Le carte "
                f"non raggiunte verranno riprese al prossimo run (non hanno "
                f"uno snapshot di oggi, quindi non vengono saltate).",
                file=sys.stderr,
            )
            break

    pruned = db.prune_old_history(conn)
    if pruned:
        print(f"Storico compresso: rimossi {pruned} punti giornalieri "
              f"oltre i {db.RETENTION_DAILY_DAYS} giorni (tenuto 1 punto/settimana).")

    db.set_meta(conn, "last_price_sync", now_iso)
    conn.commit()
    cur.close()
    conn.close()

    print(f"\nCompletato: {ok} carte aggiornate, {errors} errori.")

    if circuit_breaker_triggered:
        # Il progresso parziale e' comunque salvato (commit periodici sopra)
        # e last_price_sync riflette le carte davvero aggiornate: ma il job
        # va segnato come fallito, non "verde", altrimenti su GitHub Actions
        # sembra un sync completo quando in realta' si e' fermato a meta'.
        print(
            "Interrotto dal circuit breaker prima di finire tutte le carte: "
            "il job termina con errore anche se il progresso fatto e' salvo.",
            file=sys.stderr,
        )
        sys.exit(1)


if __name__ == "__main__":
    main()

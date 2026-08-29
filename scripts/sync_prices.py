"""
Interroga il marketplace CardTrader per ogni carta (blueprint) delle
espansioni tracciate e salva uno snapshot di prezzo per la giornata odierna.

Eseguito automaticamente ogni giorno dal workflow GitHub Actions
'.github/workflows/sync_prices.yml' (solo sulle espansioni "daily_expansion_codes"
di config/tracked_sets.json, per restare in tempi ragionevoli) e una volta a
settimana per intero da '.github/workflows/sync_prices_full.yml'.
E' idempotente: se lanciato più volte nello stesso giorno, sovrascrive lo
snapshot del giorno invece di duplicarlo.

I dati sono divisi in due file (vedi scripts/db.py):
- data/cardtrader.db: catalogo + solo l'ultimo prezzo noto (piccolo, scaricato
  ad ogni visita del sito)
- data/price_history.db: storico giorno-per-giorno (cresce nel tempo, scaricato
  solo quando apri il dettaglio di una carta; i dati vecchi vengono compressi
  automaticamente, vedi db.prune_old_history)

Il sync completo puo' durare ore (rate limit di 1 richiesta/secondo sul
marketplace): per non perdere il lavoro se il job viene interrotto, ogni
CHECKPOINT_EVERY carte lo script salva e pusha il progresso via git.

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
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from api_client import CardTraderClient
import db

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = REPO_ROOT / "config" / "tracked_sets.json"
WEB_DATA_DIR = REPO_ROOT / "web" / "public" / "data"
CHECKPOINT_EVERY = 600  # ~10 minuti al ritmo di 1 richiesta/secondo
# Ogni checkpoint fa un commit+push dei due database SQLite interi (~10MB
# l'uno, non diff incrementali: git non comprime bene i binari). Un
# intervallo troppo corto significa tanti commit "pesanti" ravvicinati nella
# stessa giornata (checkpoint del sync + eventuali push di codice nel
# frattempo), osservato correlato a un caso reale di errore SQLite
# "attempt to write a readonly database" sul runner. 600 dimezza la
# frequenza dei commit rispetto a prima (300) mantenendo comunque poco
# lavoro a rischio se il job viene interrotto a meta'.

# Se troppe carte di fila falliscono (qualunque sia il motivo: CardTrader
# che risponde 429, un errore locale come "readonly database" osservato una
# volta sul runner, o altro), fermarsi qui invece di continuare a perdere
# tempo su ogni carta rimasta - altrimenti con migliaia di carte ancora da
# processare il job resta "in corso" su GitHub Actions per ore senza
# produrre nessun checkpoint nuovo, indistinguibile da un progresso reale
# finche' non scade il timeout.
MAX_CONSECUTIVE_ERRORS = 15


def _git(*args):
    subprocess.run(["git", *args], check=True, cwd=REPO_ROOT)


def _current_branch() -> str:
    result = subprocess.run(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        check=True, cwd=REPO_ROOT, capture_output=True, text=True,
    )
    return result.stdout.strip()


def _push_with_retry(branch: str, attempts: int = 3):
    """Il branch puo' avanzare nel frattempo (altri commit umani, o un altro
    sync in corso): riprova con un rebase sul remoto invece di fallire subito."""
    for attempt in range(1, attempts + 1):
        result = subprocess.run(["git", "push"], cwd=REPO_ROOT)
        if result.returncode == 0:
            return
        print(f"  [ATTENZIONE] push fallito (tentativo {attempt}/{attempts}), "
              f"provo un rebase sul remoto...", file=sys.stderr)
        subprocess.run(["git", "fetch", "origin", branch], check=True, cwd=REPO_ROOT)
        rebase = subprocess.run(
            ["git", "rebase", f"origin/{branch}"], cwd=REPO_ROOT
        )
        if rebase.returncode != 0:
            subprocess.run(["git", "rebase", "--abort"], cwd=REPO_ROOT)
            print("  [ATTENZIONE] rebase fallito (conflitto), salto questo "
                  "checkpoint: il progresso resta salvato in locale e verra' "
                  "pushato al prossimo checkpoint.", file=sys.stderr)
            return
    print(f"  [ATTENZIONE] push non riuscito dopo {attempts} tentativi, "
          f"salto questo checkpoint.", file=sys.stderr)


def checkpoint_commit(conn, history_conn, label: str):
    """Salva entrambi i DB copiati per il sito web e fa commit+push del
    progresso corrente, cosi' un job lungo interrotto a meta' non perde
    comunque il lavoro gia' fatto."""
    conn.commit()
    history_conn.commit()
    WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy(db.DB_PATH, WEB_DATA_DIR / db.DB_PATH.name)
    shutil.copy(db.HISTORY_DB_PATH, WEB_DATA_DIR / db.HISTORY_DB_PATH.name)
    try:
        _git("add",
             "data/cardtrader.db", "web/public/data/cardtrader.db",
             "data/price_history.db", "web/public/data/price_history.db")
        result = subprocess.run(
            ["git", "diff", "--staged", "--quiet"],
            cwd=REPO_ROOT,
        )
        if result.returncode == 0:
            return  # niente di nuovo da salvare
        _git("commit", "-m", f"chore: checkpoint sync prezzi ({label})")
        _push_with_retry(_current_branch())
    except subprocess.CalledProcessError as exc:
        print(f"  [ATTENZIONE] checkpoint commit/push fallito: {exc}", file=sys.stderr)


def main():
    only_daily = "--only-daily" in sys.argv
    force = "--force" in sys.argv

    db.init_db()
    client = CardTraderClient()
    conn = db.get_connection()
    history_conn = db.get_history_connection()

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    where = ["1=1"]
    params: dict = {"today": today}

    if only_daily:
        config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        codes = config.get("daily_expansion_codes", [])
        placeholders = ", ".join(f":code{i}" for i in range(len(codes)))
        where.append(f"b.expansion_code IN ({placeholders})")
        params.update({f"code{i}": c for i, c in enumerate(codes)})

    if not force:
        where.append(
            "b.id NOT IN (SELECT blueprint_id FROM latest_prices WHERE captured_at = :today)"
        )

    query = (
        "SELECT b.id, b.name, b.expansion_name FROM blueprints b "
        f"WHERE {' AND '.join(where)} ORDER BY b.expansion_id, b.id"
    )
    blueprints = conn.execute(query, params).fetchall()

    if not blueprints:
        base_where = [w for w in where if "latest_prices" not in w]
        base_query = (
            "SELECT COUNT(*) FROM blueprints b "
            f"WHERE {' AND '.join(base_where)}"
        )
        total_tracked = conn.execute(base_query, params).fetchone()[0]
        if total_tracked == 0:
            print("Nessuna carta nel catalogo locale. Lancia prima scripts/sync_catalog.py")
            sys.exit(1)
        print(f"Tutte le {total_tracked} carte tracciate hanno gia' un prezzo aggiornato "
              f"oggi ({today}). Usa --force per rifare comunque il sync.")
        return

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    print(f"Aggiorno i prezzi di {len(blueprints)} carte per il {today}"
          + ("" if force else " (gia' aggiornate oggi vengono saltate)") + "...")

    ok, errors, consecutive_errors = 0, 0, 0
    for i, (bp_id, name, expansion_name) in enumerate(blueprints, start=1):
        try:
            products = client.get_marketplace_products(bp_id)

            db.insert_price_snapshot(history_conn, bp_id, today, now_iso, products)
            db.upsert_latest_price(conn, history_conn, bp_id, today, now_iso, products)
            db.replace_price_listings(conn, bp_id, today, products)

            # Se troviamo la rarità reale tra le proprietà del prodotto più
            # economico, aggiorniamo il blueprint (più precisa dell'euristica
            # sul nome usata in sync_catalog.py).
            if products:
                props = products[0].get("properties_hash", {}) or {}
                rarity = props.get("pokemon_rarity") or props.get("rarity")
                if rarity:
                    conn.execute(
                        "UPDATE blueprints SET rarity = ? WHERE id = ?",
                        (rarity, bp_id),
                    )

            ok += 1
            consecutive_errors = 0
        except Exception as exc:  # non bloccare l'intero job per una carta problematica
            print(f"  [ERRORE] {name} ({expansion_name}) id={bp_id}: {exc}", file=sys.stderr)
            errors += 1
            consecutive_errors += 1

        if i % 25 == 0:
            conn.commit()
            history_conn.commit()
            print(f"  ...{i}/{len(blueprints)} carte processate")

        if i % CHECKPOINT_EVERY == 0:
            checkpoint_commit(conn, history_conn, label=f"{i}/{len(blueprints)}")

        if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
            print(
                f"  [ATTENZIONE] {consecutive_errors} carte di fila fallite "
                f"(probabile rate limit/blocco lato CardTrader dopo troppo "
                f"traffico oggi): mi fermo qui invece di continuare a perdere "
                f"tempo, {i}/{len(blueprints)} carte tentate. Le carte non "
                f"raggiunte verranno riprese al prossimo run (non hanno uno "
                f"snapshot di oggi, quindi non vengono saltate).",
                file=sys.stderr,
            )
            break

    pruned = db.prune_old_history(history_conn)
    if pruned:
        print(f"Storico compresso: rimossi {pruned} punti giornalieri "
              f"oltre i {db.RETENTION_DAILY_DAYS} giorni (tenuto 1 punto/settimana).")

    db.set_meta(conn, "last_price_sync", now_iso)
    conn.commit()
    history_conn.commit()
    checkpoint_commit(conn, history_conn, label="finale")
    conn.close()
    history_conn.close()

    print(f"\nCompletato: {ok} carte aggiornate, {errors} errori.")


if __name__ == "__main__":
    main()

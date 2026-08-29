"""
Interroga il marketplace CardTrader per ogni carta (blueprint) delle
espansioni tracciate e salva uno snapshot di prezzo per la giornata odierna.

Eseguito automaticamente ogni giorno dal workflow GitHub Actions
'.github/workflows/sync_prices.yml' (solo sulle espansioni "daily_expansion_codes"
di config/tracked_sets.json, per restare in tempi ragionevoli) e una volta a
settimana per intero da '.github/workflows/sync_prices_full.yml'.
E' idempotente: se lanciato più volte nello stesso giorno, sovrascrive lo
snapshot del giorno invece di duplicarlo.

Il sync completo puo' durare ore (rate limit di 1 richiesta/secondo sul
marketplace): per non perdere il lavoro se il job viene interrotto, ogni
CHECKPOINT_EVERY carte lo script salva e pusha il progresso via git.

Uso:
  python scripts/sync_prices.py            # tutte le carte del catalogo locale
  python scripts/sync_prices.py --only-daily  # solo daily_expansion_codes
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
WEB_DB_PATH = REPO_ROOT / "web" / "public" / "data" / "cardtrader.db"
CHECKPOINT_EVERY = 300  # ~5 minuti al ritmo di 1 richiesta/secondo


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


def checkpoint_commit(conn, label: str):
    """Salva il DB copiato per il sito web e fa commit+push del progresso corrente,
    cosi' un job lungo interrotto a meta' non perde comunque il lavoro gia' fatto."""
    conn.commit()
    WEB_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(db.DB_PATH, WEB_DB_PATH)
    try:
        _git("add", "data/cardtrader.db", "web/public/data/cardtrader.db")
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

    db.init_db()
    client = CardTraderClient()
    conn = db.get_connection()

    if only_daily:
        config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        codes = config.get("daily_expansion_codes", [])
        placeholders = ",".join("?" * len(codes))
        blueprints = conn.execute(
            f"SELECT id, name, expansion_name FROM blueprints "
            f"WHERE expansion_code IN ({placeholders}) ORDER BY expansion_id, id",
            codes,
        ).fetchall()
    else:
        blueprints = conn.execute(
            "SELECT id, name, expansion_name FROM blueprints ORDER BY expansion_id, id"
        ).fetchall()

    if not blueprints:
        print("Nessuna carta nel catalogo locale. Lancia prima scripts/sync_catalog.py")
        sys.exit(1)

    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    now_iso = now.isoformat()

    print(f"Aggiorno i prezzi di {len(blueprints)} carte per il {today}...")

    ok, errors = 0, 0
    for i, (bp_id, name, expansion_name) in enumerate(blueprints, start=1):
        try:
            products = client.get_marketplace_products(bp_id)

            # Rimuove un eventuale snapshot già preso oggi per questa carta,
            # cosi' il job resta idempotente anche se lanciato più volte al giorno.
            conn.execute(
                "DELETE FROM price_snapshots WHERE blueprint_id = ? AND captured_at = ?",
                (bp_id, today),
            )
            db.insert_price_snapshot(conn, bp_id, today, now_iso, products)
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
        except Exception as exc:  # non bloccare l'intero job per una carta problematica
            print(f"  [ERRORE] {name} ({expansion_name}) id={bp_id}: {exc}", file=sys.stderr)
            errors += 1

        if i % 25 == 0:
            conn.commit()
            print(f"  ...{i}/{len(blueprints)} carte processate")

        if i % CHECKPOINT_EVERY == 0:
            checkpoint_commit(conn, label=f"{i}/{len(blueprints)}")

    db.set_meta(conn, "last_price_sync", now_iso)
    conn.commit()
    checkpoint_commit(conn, label="finale")
    conn.close()

    print(f"\nCompletato: {ok} carte aggiornate, {errors} errori.")


if __name__ == "__main__":
    main()

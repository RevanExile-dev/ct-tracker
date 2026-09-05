"""
Genera l'indice fingerprint visivo per lo scanner (web/public/data/scanner_index.json),
il "bonus opzionale" che web/lib/scanner/catalog.ts (loadVisualIndex) gia' sa
consumare quando esiste - senza, il riconoscimento resta solo OCR+testo.

Per ogni blueprint con image_url calcola due dHash (immagine intera + crop
artwork, stesso identico algoritmo dello spike M1a gia' misurato - vedi
scripts/scanner_common.py) e li scrive nell'indice.

Il catalogo ha 29mila+ blueprint con immagine: scaricarle e processarle
tutte non sta in un solo run breve (rischio rate-limit/timeout, segnalato
dalla review Gemini su PR #21). Come sync_prices.py, lo script e' pensato
per un run LUNGO con checkpoint periodici (commit+push del progresso), non
per essere ridispatchato a mano piu' volte - un job interrotto (timeout del
job, circuit breaker) riprende dal checkpoint piu' recente al run
successivo grazie alla cache, senza rifare il lavoro gia' fatto.

Cache incrementale: data/scanner_fingerprint_cache.json, chiave
blueprint_id -> {image_url, full_hash, art_hash}. Una carta viene
ricalcolata SOLO se il suo image_url e' cambiato rispetto alla cache (o se
non c'e' ancora una entry) - un sync catalogo che aggiorna migliaia di
blueprint non forza un ricalcolo totale.

Uso:
  python scripts/build_scanner_index.py            # tutte le carte da processare
  python scripts/build_scanner_index.py --limit N  # solo le prime N (debug/test)
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from scanner_common import artwork_crop, dhash_hex, fetch_image

REPO_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = REPO_ROOT / "data" / "cardtrader.db"
CACHE_PATH = REPO_ROOT / "data" / "scanner_fingerprint_cache.json"
WEB_DATA_DIR = REPO_ROOT / "web" / "public" / "data"
INDEX_PATH = WEB_DATA_DIR / "scanner_index.json"

CHECKPOINT_EVERY = 300  # meno del CHECKPOINT_EVERY=600 di sync_prices.py:
                         # il download+decodifica di un'immagine e' piu'
                         # pesante di una singola chiamata API prezzi.
MAX_CONSECUTIVE_ERRORS = 20


def _git(*args):
    subprocess.run(["git", *args], check=True, cwd=REPO_ROOT)


def _current_branch() -> str:
    result = subprocess.run(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        check=True, cwd=REPO_ROOT, capture_output=True, text=True,
    )
    return result.stdout.strip()


def _push_with_retry(branch: str, attempts: int = 3):
    """Stesso pattern di sync_prices.py: il branch puo' avanzare nel
    frattempo (altri commit, un altro sync in corso) - riprova con un
    rebase invece di fallire subito."""
    for attempt in range(1, attempts + 1):
        result = subprocess.run(["git", "push"], cwd=REPO_ROOT)
        if result.returncode == 0:
            return
        print(f"  [ATTENZIONE] push fallito (tentativo {attempt}/{attempts}), "
              f"provo un rebase sul remoto...", file=sys.stderr)
        subprocess.run(["git", "fetch", "origin", branch], check=True, cwd=REPO_ROOT)
        rebase = subprocess.run(["git", "rebase", f"origin/{branch}"], cwd=REPO_ROOT)
        if rebase.returncode != 0:
            subprocess.run(["git", "rebase", "--abort"], cwd=REPO_ROOT)
            print("  [ATTENZIONE] rebase fallito (conflitto), salto questo "
                  "checkpoint: il progresso resta salvato in locale e verra' "
                  "pushato al prossimo checkpoint.", file=sys.stderr)
            return
    print(f"  [ATTENZIONE] push non riuscito dopo {attempts} tentativi, "
          f"salto questo checkpoint.", file=sys.stderr)


def load_cache() -> dict[str, dict]:
    if not CACHE_PATH.exists():
        return {}
    try:
        return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        print("  [ATTENZIONE] cache fingerprint illeggibile, riparto da vuota "
              "(nessuna immagine viene persa, solo ricalcolata).", file=sys.stderr)
        return {}


def write_index(cache: dict[str, dict]):
    """L'indice per il client e' un array ordinato per blueprint_id -
    piu' semplice da diffare in git e da iterare lato browser rispetto a
    un dict con chiavi stringa."""
    entries = [
        {"blueprint_id": int(bid), "full_hash": v["full_hash"], "art_hash": v["art_hash"]}
        for bid, v in sorted(cache.items(), key=lambda kv: int(kv[0]))
        if v.get("full_hash") and v.get("art_hash")
    ]
    WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)
    INDEX_PATH.write_text(json.dumps(entries, separators=(",", ":")), encoding="utf-8")


def checkpoint_commit(cache: dict[str, dict], label: str):
    CACHE_PATH.write_text(json.dumps(cache, indent=0, sort_keys=True), encoding="utf-8")
    write_index(cache)
    try:
        _git("add", str(CACHE_PATH.relative_to(REPO_ROOT)), str(INDEX_PATH.relative_to(REPO_ROOT)))
        result = subprocess.run(["git", "diff", "--staged", "--quiet"], cwd=REPO_ROOT)
        if result.returncode == 0:
            return  # niente di nuovo da salvare
        _git("commit", "-m", f"chore: checkpoint indice fingerprint scanner ({label})")
        _push_with_retry(_current_branch())
    except subprocess.CalledProcessError as exc:
        print(f"  [ATTENZIONE] checkpoint commit/push fallito: {exc}", file=sys.stderr)


def main() -> None:
    limit = None
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])

    con = sqlite3.connect(str(DB_PATH))
    rows = con.execute(
        "SELECT id, image_url FROM blueprints WHERE image_url IS NOT NULL ORDER BY id"
    ).fetchall()
    con.close()
    if limit:
        rows = rows[:limit]

    cache = load_cache()

    todo = [(bid, url) for bid, url in rows if cache.get(str(bid), {}).get("image_url") != url]
    print(f"Blueprint totali con immagine: {len(rows)}, gia' in cache e invariati: "
          f"{len(rows) - len(todo)}, da (ri)calcolare: {len(todo)}", file=sys.stderr)

    if not todo:
        print("Niente da fare: l'indice e' gia' aggiornato per tutti i blueprint noti.")
        write_index(cache)
        return

    ok, errors, consecutive_errors = 0, 0, 0
    circuit_breaker_triggered = False
    for i, (bid, url) in enumerate(todo, start=1):
        try:
            img = fetch_image(url)
            cache[str(bid)] = {
                "image_url": url,
                "full_hash": dhash_hex(img),
                "art_hash": dhash_hex(artwork_crop(img)),
            }
            ok += 1
            consecutive_errors = 0
        except Exception as exc:  # una carta problematica non deve fermare il resto
            print(f"  [ERRORE] blueprint {bid}: {exc}", file=sys.stderr)
            errors += 1
            consecutive_errors += 1

        if i % 50 == 0:
            print(f"  ...{i}/{len(todo)} elaborate", file=sys.stderr)

        if i % CHECKPOINT_EVERY == 0:
            checkpoint_commit(cache, label=f"{i}/{len(todo)}")

        if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
            circuit_breaker_triggered = True
            print(
                f"  [ATTENZIONE] {consecutive_errors} carte di fila fallite: mi "
                f"fermo qui invece di continuare a perdere tempo, {i}/{len(todo)} "
                f"tentate. Le carte non raggiunte verranno riprese al prossimo run "
                f"(non sono in cache con l'image_url corrente).",
                file=sys.stderr,
            )
            break

    checkpoint_commit(cache, label="finale")

    print(f"\nCompletato: {ok} calcolate, {errors} errori, indice ora con "
          f"{sum(1 for v in cache.values() if v.get('full_hash'))} blueprint.")

    if circuit_breaker_triggered:
        # Progresso comunque salvato (checkpoint sopra), ma il job va
        # segnato come fallito, non "verde" - altrimenti sembra un giro
        # completo quando in realta' si e' fermato a meta' (stesso motivo
        # di sync_prices.py).
        print(
            "Interrotto dal circuit breaker prima di finire tutti i blueprint "
            "da processare: il job termina con errore anche se il progresso "
            "fatto e' salvo.",
            file=sys.stderr,
        )
        sys.exit(1)


if __name__ == "__main__":
    main()

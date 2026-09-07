"""Costruisce l'indice visivo dello scanner (dHash carta intera + artwork).

Chiude un gap reale del codice esistente: web/lib/scanner/catalog.ts sa gia'
leggere web/public/data/scanner_index.json e combinare il segnale visivo con
OCR nome/numero (rankScannerCandidates), ma quel file non era mai stato
generato. Lo scanner in produzione girava quindi SOLO su OCR — nessun
segnale visivo di riserva quando il testo e' illeggibile (foil, glare, full
art, font particolari) — nonostante lo spike M1 (scripts/scanner_m1_spike.py,
issue #20/#21, docs/card_scanner_architecture.md sezioni 6-8) avesse gia'
validato l'approccio (dHash carta intera + dHash artwork).

Il crop artwork usa le stesse coordinate frazionarie di ARTWORK_BOX in
web/lib/scanner/image.ts, cosi' l'hash calcolato qui a build-time (sulle
immagini di riferimento del catalogo) resta confrontabile via distanza di
Hamming con quello calcolato nel browser sulla foto scansionata.

Incrementale: una carta gia' in cache con lo stesso image_url e la stessa
FINGERPRINT_VERSION non viene riscaricata (sezione 7.3). Alzare
FINGERPRINT_VERSION forza il ricalcolo completo quando l'algoritmo cambia.

Deve girare in GitHub Actions: le immagini sono su cardtrader.com, il cui
accesso e' bloccato dal sandbox di sviluppo locale (stesso vincolo di
scanner_m1_spike.py).
"""

from __future__ import annotations

import argparse
import io
import json
import sqlite3
import sys
import time
from pathlib import Path

import requests
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = REPO_ROOT / "data" / "cardtrader.db"
CACHE_PATH = REPO_ROOT / "data" / "scanner_fingerprint_cache.json"
INDEX_PATH = REPO_ROOT / "web" / "public" / "data" / "scanner_index.json"

HASH_SIZE = 8  # dHash 8x8 -> hash a 64 bit, stesso schema dello spike M1.
# Deve restare identico ad ARTWORK_BOX in web/lib/scanner/image.ts.
ARTWORK_BOX = (0.09, 0.10, 0.91, 0.58)  # (left, top, right, bottom) frazioni

# Alzare quando l'algoritmo di hashing cambia, per forzare il ricalcolo di
# tutta la cache anche se image_url non e' cambiato.
FINGERPRINT_VERSION = 1

REQUEST_TIMEOUT = 20
REQUEST_RETRIES = 3
CHECKPOINT_EVERY = 200  # salva la cache periodicamente: una run interrotta non riparte da zero


def dhash(img: Image.Image, hash_size: int = HASH_SIZE) -> str:
    """Difference hash classico: confronta pixel adiacenti dopo resize+grayscale.

    Identico a scanner_m1_spike.py (nessuna dipendenza oltre Pillow, vedi
    sezione 23 del documento di architettura) e alla stessa logica bit-a-bit
    di dhash() in web/lib/scanner/image.ts (confronto riga per riga,
    sinistra > destra), cosi' i due hash restano confrontabili.
    """
    small = img.convert("L").resize((hash_size + 1, hash_size), Image.LANCZOS)
    pixels = list(small.getdata())
    bits = 0
    for row in range(hash_size):
        row_start = row * (hash_size + 1)
        for col in range(hash_size):
            bits <<= 1
            if pixels[row_start + col] > pixels[row_start + col + 1]:
                bits |= 1
    return f"{bits:016x}"


def artwork_crop(img: Image.Image) -> Image.Image:
    w, h = img.size
    left, top, right, bottom = ARTWORK_BOX
    return img.crop((int(w * left), int(h * top), int(w * right), int(h * bottom)))


def fetch_image(url: str) -> Image.Image:
    last_err: Exception | None = None
    for attempt in range(REQUEST_RETRIES):
        try:
            resp = requests.get(url, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            return Image.open(io.BytesIO(resp.content)).convert("RGB")
        except Exception as exc:  # rete instabile sul runner, non e' l'oggetto della misura
            last_err = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Download fallito per {url}: {last_err}")


def load_cache() -> dict:
    if not CACHE_PATH.exists():
        return {}
    try:
        return json.loads(CACHE_PATH.read_text())
    except Exception:
        return {}


def save_cache(cache: dict) -> None:
    CACHE_PATH.write_text(json.dumps(cache, indent=2, sort_keys=True))


def load_blueprints(con: sqlite3.Connection) -> list[tuple[int, str]]:
    cur = con.cursor()
    cur.execute("SELECT id, image_url FROM blueprints WHERE image_url IS NOT NULL")
    return [(int(bid), str(url)) for bid, url in cur.fetchall()]


def write_index(cache: dict) -> int:
    entries = [
        {"blueprint_id": int(bid), "full_hash": data["full_hash"], "art_hash": data["art_hash"]}
        for bid, data in cache.items()
        if data.get("full_hash") and data.get("art_hash")
    ]
    entries.sort(key=lambda e: e["blueprint_id"])
    INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {"fingerprint_version": FINGERPRINT_VERSION, "entries": entries}
    INDEX_PATH.write_text(json.dumps(payload, separators=(",", ":")))
    return len(entries)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Numero massimo di blueprint da (ri)calcolare in questa run (0 = nessun limite). "
        "Utile per spalmare un catalogo di decine di migliaia di carte su piu' run pianificate "
        "invece di un job lunghissimo/instabile.",
    )
    args = parser.parse_args()

    con = sqlite3.connect(str(DB_PATH))
    blueprints = load_blueprints(con)
    con.close()

    cache = load_cache()
    pending: list[tuple[int, str]] = []
    reused = 0
    for blueprint_id, image_url in blueprints:
        entry = cache.get(str(blueprint_id))
        if (
            entry
            and entry.get("image_url") == image_url
            and entry.get("fingerprint_version") == FINGERPRINT_VERSION
            and entry.get("full_hash")
            and entry.get("art_hash")
        ):
            reused += 1
            continue
        pending.append((blueprint_id, image_url))

    print(
        f"{len(blueprints)} blueprint con immagine, {reused} gia' in cache, {len(pending)} da calcolare",
        file=sys.stderr,
    )

    if args.limit > 0 and len(pending) > args.limit:
        pending = pending[: args.limit]
        print(f"--limit={args.limit}: elaboro {len(pending)} blueprint in questa run", file=sys.stderr)

    failures = 0
    for i, (blueprint_id, image_url) in enumerate(pending, start=1):
        try:
            img = fetch_image(image_url)
            cache[str(blueprint_id)] = {
                "image_url": image_url,
                "full_hash": dhash(img),
                "art_hash": dhash(artwork_crop(img)),
                "fingerprint_version": FINGERPRINT_VERSION,
            }
        except Exception as exc:
            failures += 1
            print(f"SKIP {blueprint_id} ({image_url}): {exc}", file=sys.stderr)
        if i % CHECKPOINT_EVERY == 0:
            print(f"  {i}/{len(pending)}", file=sys.stderr)
            save_cache(cache)

    # Blueprint rimossi dal catalogo: non tenerli in cache/indice all'infinito.
    valid_ids = {str(bid) for bid, _ in blueprints}
    for stale_id in [bid for bid in cache if bid not in valid_ids]:
        del cache[stale_id]

    save_cache(cache)
    written = write_index(cache)
    print(
        f"Indice scritto: {written} entries -> {INDEX_PATH} ({failures} fallimenti di download)",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()

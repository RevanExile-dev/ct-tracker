#!/usr/bin/env python3
"""Controllo leggero del sito in produzione (pagine e API principali).

Solo libreria standard, nessun segreto, nessun accesso diretto al database:
chiama gli stessi URL pubblici che usa un visitatore (la cache CDN di Vercel
risponde per la maggior parte, quindi Neon viene toccato pochissimo).
Esce con codice 1 se una pagina non risponde, ha un contenuto sbagliato, e'
troppo lenta (dopo un secondo tentativo) o se i prezzi non si aggiornano
da troppo tempo. Uso: site_check.py [URL_BASE]
"""
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone

BASE = (sys.argv[1] if len(sys.argv) > 1 else os.environ.get("SITE_URL", "https://ct-tracker-eight.vercel.app")).rstrip("/")
PRICE_MAX_AGE_H = float(os.environ.get("PRICE_MAX_AGE_H", "12"))
RETRY_WAIT_S = 5


def fetch(path, timeout=15):
    req = urllib.request.Request(BASE + path, headers={"User-Agent": "cartaviva-site-check/1"})
    t0 = time.monotonic()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
        return r.status, body, time.monotonic() - t0


def j(b):
    return json.loads(b)


def v_page(b):
    return b"CartaViva" in b or "pagina senza il marchio CartaViva"


def v_meta(b):
    d = j(b)
    ts = d.get("last_price_sync")
    if not ts:
        return "last_price_sync mancante"
    age = (datetime.now(timezone.utc) - datetime.fromisoformat(ts)).total_seconds() / 3600
    if age > PRICE_MAX_AGE_H:
        return f"prezzi non aggiornati da {age:.1f} h (soglia {PRICE_MAX_AGE_H:g} h)"
    return True


def v_movers(b):
    d = j(b)
    return bool(d.get("cards")) or "nessuna carta in /api/movers"


def v_cards(b):
    d = j(b)
    return (isinstance(d, list) and len(d) > 0) or "ricerca senza risultati"


def v_card(b):
    return (j(b).get("id") == 402962) or "scheda carta con id sbagliato"


def v_stats(b):
    return (j(b).get("totalCards", 0) > 20000) or "catalogo sotto 20.000 carte"


def v_expansions(b):
    return (len(j(b)) > 50) or "meno di 50 espansioni"


# (nome, percorso, validatore, secondi massimi dopo i quali e' "lento")
CHECKS = [
    ("Home", "/", v_page, 4),
    ("Movers (pagina)", "/movers", v_page, 4),
    ("Scheda carta (pagina)", "/card/402962", v_page, 5),
    ("Scanner (pagina)", "/scan", v_page, 4),
    ("API meta + freschezza prezzi", "/api/meta", v_meta, 4),
    ("API movers", "/api/movers", v_movers, 6),
    ("API ricerca", "/api/cards?q=charizard&limit=1", v_cards, 6),
    ("API scheda", "/api/cards/402962", v_card, 5),
    ("API statistiche catalogo", "/api/catalog-stats", v_stats, 5),
    ("API espansioni", "/api/expansions", v_expansions, 5),
]


def run_one(path, validator, slow_s):
    try:
        status, body, dt = fetch(path)
    except Exception as e:  # rete, timeout, HTTP != 2xx
        return False, 0.0, f"{type(e).__name__}: {e}"
    if status != 200:
        return False, dt, f"HTTP {status}"
    try:
        res = validator(body)
    except Exception as e:
        return False, dt, f"contenuto non valido ({type(e).__name__}: {e})"
    if res is not True:
        return False, dt, str(res)
    if dt > slow_s:
        return False, dt, f"lento: {dt:.1f} s (soglia {slow_s} s)"
    return True, dt, ""


def main():
    rows, failed = [], 0
    for name, path, validator, slow_s in CHECKS:
        ok, dt, msg = run_one(path, validator, slow_s)
        if not ok:
            time.sleep(RETRY_WAIT_S)  # un solo secondo tentativo: evita falsi allarmi da avvio a freddo
            ok, dt, msg = run_one(path, validator, slow_s)
        failed += not ok
        rows.append((name, path, ok, dt, msg))
        print(f"{'OK  ' if ok else 'FAIL'} {dt:5.2f}s {path}  {msg}")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(f"### Controllo sito {BASE}\n\n| Controllo | Tempo | Esito |\n|---|---|---|\n")
            for name, path, ok, dt, msg in rows:
                f.write(f"| {name} (`{path}`) | {dt:.2f} s | {'OK' if ok else 'ERRORE: ' + msg} |\n")
    if failed:
        print(f"::error::{failed} controlli su {len(CHECKS)} falliti su {BASE}")
        sys.exit(1)
    print(f"Tutti i {len(CHECKS)} controlli sono ok")


if __name__ == "__main__":
    main()

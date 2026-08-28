"""
Sincronizza il catalogo (espansioni + blueprint/carte) di CardTrader
per tutte le espansioni elencate in config/tracked_sets.json.

Va lanciato quando aggiungi una nuova espansione da tracciare, o quando
esce un set nuovo. Non serve lanciarlo tutti i giorni: il catalogo
(nomi, immagini) cambia raramente. I prezzi li aggiorna sync_prices.py.

Uso: python scripts/sync_catalog.py
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from api_client import CardTraderClient
import db

CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "tracked_sets.json"

# Import PREMIUM_RARITY_KEYWORDS-like logic: dato che il nome del blueprint
# spesso riporta indicazioni utili (es. "(Illustration Rare)"), usiamo un
# controllo euristico sul nome. La rarità precisa arriva più avanti dai
# prodotti a mercato (properties_hash), ma questo basta per una prima marcatura.
PREMIUM_KEYWORDS = [
    "illustration rare", "special illustration rare", "hyper rare",
    "secret rare", "ultra rare", "full art", "rainbow rare",
    "gold rare", "alternate art", "promo", "sir", "vstar", "vmax",
]


def is_premium_name(name: str) -> bool:
    lowered = name.lower()
    return any(kw in lowered for kw in PREMIUM_KEYWORDS)


def main():
    if not CONFIG_PATH.exists():
        print(f"ERRORE: {CONFIG_PATH} non trovato.", file=sys.stderr)
        sys.exit(1)

    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    codes = config.get("expansion_codes", [])
    if not codes:
        print("Nessuna espansione in config/tracked_sets.json, niente da fare.")
        return

    db.init_db()
    client = CardTraderClient()

    print("Recupero elenco espansioni da CardTrader...")
    all_expansions = client.get_expansions()
    by_code = {e["code"]: e for e in all_expansions}

    conn = db.get_connection()
    synced_at = datetime.now(timezone.utc).isoformat()

    total_cards = 0
    for code in codes:
        expansion = by_code.get(code)
        if not expansion:
            print(f"  [ATTENZIONE] Codice espansione '{code}' non trovato su CardTrader, salto.")
            continue

        print(f"\nEspansione: {expansion['name']} ({code}, id={expansion['id']})")
        db.upsert_expansion(conn, expansion)
        conn.commit()

        blueprints = client.get_blueprints(expansion["id"])
        print(f"  {len(blueprints)} carte trovate")

        for bp in blueprints:
            premium = is_premium_name(bp.get("name", ""))
            db.upsert_blueprint(
                conn, bp,
                expansion_code=expansion["code"],
                expansion_name=expansion["name"],
                is_premium=premium,
                synced_at=synced_at,
            )
        conn.commit()
        total_cards += len(blueprints)

    db.set_meta(conn, "last_catalog_sync", synced_at)
    conn.commit()
    conn.close()

    print(f"\nFatto. {total_cards} carte sincronizzate nel catalogo locale.")


if __name__ == "__main__":
    main()

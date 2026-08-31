"""
Sincronizza il catalogo (espansioni + blueprint/carte) di CardTrader
per tutte le espansioni elencate in config/tracked_sets.json.

Va lanciato quando aggiungi una nuova espansione da tracciare, o quando
esce un set nuovo. Non serve rilanciare sempre il catalogo completo: la
modalita' --only-missing sincronizza soltanto i codici tracciati che non
hanno ancora carte nel database ed e' adatta al controllo automatico
periodico dei set appena aggiunti da CardTrader.

Uso:
  python scripts/sync_catalog.py
  python scripts/sync_catalog.py --only-missing
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from api_client import CardTraderClient
import db

CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "tracked_sets.json"

# Categoria CardTrader "Pokémon Singles" (le carte vere e proprie). Ogni
# espansione su CardTrader mischia le carte con prodotti sigillati/accessori
# (booster, box, theme deck, sleeve, dadi...) sotto altre category_id: li
# escludiamo, non sono carte da tracciare. Verificato con lo script
# scripts/list_categories.py.
POKEMON_SINGLES_CATEGORY_ID = 73

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

    unknown_args = [arg for arg in sys.argv[1:] if arg != "--only-missing"]
    if unknown_args:
        print(f"Argomenti non riconosciuti: {' '.join(unknown_args)}", file=sys.stderr)
        sys.exit(2)
    only_missing = "--only-missing" in sys.argv[1:]

    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    codes = config.get("expansion_codes", [])
    if not codes:
        print("Nessuna espansione in config/tracked_sets.json, niente da fare.")
        return

    db.init_db()
    conn = db.get_connection()
    history_conn = db.get_history_connection()

    if only_missing:
        # Un'espansione e' considerata gia' sincronizzata solo se nel DB esiste
        # almeno una sua carta. Usare la sola tabella expansions non basta:
        # CardTrader puo' pubblicare prima il contenitore del set e aggiungere
        # i blueprint Singles in un secondo momento. In quel caso vogliamo
        # continuare a riprovarci nei giri automatici successivi.
        existing_codes = {
            row[0]
            for row in conn.execute(
                "SELECT DISTINCT expansion_code FROM blueprints "
                "WHERE expansion_code IS NOT NULL"
            ).fetchall()
        }
        codes = [code for code in codes if code not in existing_codes]
        if not codes:
            print("Nessuna espansione tracciata mancante: catalogo invariato.")
            conn.close()
            history_conn.close()
            return
        print(
            f"Modalita' --only-missing: controllo {len(codes)} codici "
            "non ancora presenti nel catalogo."
        )

    client = CardTraderClient()

    print("Recupero elenco espansioni Pokemon da CardTrader...")
    all_expansions = client.get_pokemon_expansions()
    by_code = {e["code"]: e for e in all_expansions}
    synced_at = datetime.now(timezone.utc).isoformat()

    total_cards = 0
    synced_sets = 0
    for code in codes:
        expansion = by_code.get(code)
        if not expansion:
            print(f"  [ATTENZIONE] Codice espansione '{code}' non trovato su CardTrader, salto.")
            continue

        print(f"\nEspansione: {expansion['name']} ({code}, id={expansion['id']})")
        db.upsert_expansion(conn, expansion)
        conn.commit()

        all_blueprints = client.get_blueprints(expansion["id"])
        blueprints = [
            bp for bp in all_blueprints
            if bp.get("category_id") == POKEMON_SINGLES_CATEGORY_ID
        ]
        skipped = len(all_blueprints) - len(blueprints)
        print(f"  {len(blueprints)} carte trovate" + (f" ({skipped} prodotti non-carta esclusi)" if skipped else ""))

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
        if blueprints:
            synced_sets += 1

    # Pulizia: rimuove eventuali prodotti non-carta (e i loro dati di prezzo
    # collegati, per via del vincolo di foreign key) inseriti da sync
    # precedenti a questo filtro (booster, box, sleeve...).
    non_card_ids = [
        row[0] for row in conn.execute(
            "SELECT id FROM blueprints WHERE category_id IS NOT NULL AND category_id != ?",
            (POKEMON_SINGLES_CATEGORY_ID,),
        ).fetchall()
    ]
    if non_card_ids:
        placeholders = ", ".join("?" * len(non_card_ids))
        history_conn.execute(
            f"DELETE FROM price_snapshots WHERE blueprint_id IN ({placeholders})",
            non_card_ids,
        )
        conn.execute(
            f"DELETE FROM latest_prices WHERE blueprint_id IN ({placeholders})",
            non_card_ids,
        )
        conn.execute(
            f"DELETE FROM price_listings WHERE blueprint_id IN ({placeholders})",
            non_card_ids,
        )
    removed = conn.execute(
        "DELETE FROM blueprints WHERE category_id IS NOT NULL AND category_id != ?",
        (POKEMON_SINGLES_CATEGORY_ID,),
    ).rowcount
    if removed:
        print(f"\nRimossi {removed} prodotti non-carta residui da sync precedenti.")

    # In modalita' --only-missing, se CardTrader conosce i codici ma non ha
    # ancora pubblicato alcuna carta Singles, non tocchiamo meta/DB: in questo
    # modo il controllo giornaliero resta davvero un no-op e non genera commit
    # binari inutili. Quei codici verranno riprovati al giro successivo.
    if only_missing and synced_sets == 0 and removed == 0:
        conn.close()
        history_conn.close()
        print("\nNessuna nuova carta disponibile: catalogo invariato.")
        return

    db.set_meta(conn, "last_catalog_sync", synced_at)
    conn.commit()
    history_conn.commit()
    conn.close()
    history_conn.close()

    print(f"\nFatto. {total_cards} carte sincronizzate nel catalogo locale.")


if __name__ == "__main__":
    main()

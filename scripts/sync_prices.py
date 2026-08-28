"""
Interroga il marketplace CardTrader per ogni carta (blueprint) delle
espansioni tracciate e salva uno snapshot di prezzo per la giornata odierna.

Eseguito automaticamente ogni giorno dal workflow GitHub Actions
'.github/workflows/sync_prices.yml'. E' idempotente: se lanciato più
volte nello stesso giorno, sovrascrive lo snapshot del giorno invece
di duplicarlo.

Uso: python scripts/sync_prices.py
"""
import sys
from datetime import datetime, timezone

from api_client import CardTraderClient
import db


def main():
    db.init_db()
    client = CardTraderClient()
    conn = db.get_connection()

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

    db.set_meta(conn, "last_price_sync", now_iso)
    conn.commit()
    conn.close()

    print(f"\nCompletato: {ok} carte aggiornate, {errors} errori.")


if __name__ == "__main__":
    main()

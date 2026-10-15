"""
Riempie la rarita' mancante dei blueprint gia' nel DB usando il catalogo
CardTrader (fixed_properties.pokemon_rarity del bulk /blueprints/export, una
sola chiamata per espansione). Serve per le carte vecchie (promo XY/BW/SM...)
che non hanno inserzioni live: il sync prezzi non le ha mai potute riempire.
Scrive solo dove la rarita' e' vuota, mai sopra un valore esistente.

Uso:
  python scripts/backfill_rarity.py            # applica
  python scripts/backfill_rarity.py --dry-run  # mostra solo i numeri
"""
import sys

import db
from api_client import CardTraderClient


def main():
    dry_run = "--dry-run" in sys.argv[1:]
    conn = db.get_connection()
    cur = conn.cursor()
    cur.execute(
        "SELECT expansion_id, expansion_code, count(*) FROM blueprints "
        "WHERE rarity IS NULL OR rarity = '' GROUP BY 1, 2 ORDER BY 3 DESC"
    )
    targets = cur.fetchall()
    print(f"{len(targets)} espansioni con carte senza rarita'." + (" [DRY RUN]" if dry_run else ""))

    client = CardTraderClient()
    filled = 0
    for expansion_id, code, missing in targets:
        try:
            blueprints = client.get_blueprints(expansion_id)
        except Exception as exc:
            print(f"  {code}: ERRORE {exc}", file=sys.stderr)
            continue
        rows = [(db._blueprint_rarity(bp), bp["id"]) for bp in blueprints]
        rows = [r for r in rows if r[0]]
        print(f"  {code}: {missing} senza rarita', {len(rows)} con rarita' nel catalogo")
        if dry_run:
            filled += len(rows)
            continue
        for rarity, bp_id in rows:
            cur.execute(
                "UPDATE blueprints SET rarity = %s WHERE id = %s AND (rarity IS NULL OR rarity = '')",
                (rarity, bp_id),
            )
            filled += cur.rowcount
        conn.commit()

    print(f"\nFatto. {filled} rarita' {'trovabili' if dry_run else 'scritte'}.")
    conn.close()


if __name__ == "__main__":
    main()

"""
Toglie dalla tabella expansions i set che non hanno nessuna carta E non sono
Pokemon (game_id != 5): residui di sync vecchi di altri giochi (Lorcana,
Flesh and Blood...). Nessuna altra tabella li referenzia e il sito non li
legge. Mai toccati set Pokemon, ne' blueprints.

Uso:
  python scripts/cleanup_empty_expansions.py --dry-run   # elenca soltanto
  python scripts/cleanup_empty_expansions.py             # cancella
"""
import sys

import db

POKEMON_GAME_ID = 5

SELECT_SQL = (
    "SELECT id, code, name, game_id FROM expansions e "
    "WHERE game_id IS DISTINCT FROM %s "
    "AND NOT EXISTS (SELECT 1 FROM blueprints b WHERE b.expansion_id = e.id) "
    "ORDER BY id"
)


def main():
    dry_run = "--dry-run" in sys.argv[1:]
    conn = db.get_connection()
    cur = conn.cursor()
    cur.execute(SELECT_SQL, (POKEMON_GAME_ID,))
    rows = cur.fetchall()
    print(f"{len(rows)} set non-Pokemon senza carte" + (" [DRY RUN]" if dry_run else ""))
    for row in rows:
        print(f"  id={row[0]} code={row[1]!r} name={row[2]!r} game_id={row[3]}")
    if not dry_run and rows:
        cur.execute(
            "DELETE FROM expansions WHERE id = ANY(%s) "
            "AND game_id IS DISTINCT FROM %s "
            "AND NOT EXISTS (SELECT 1 FROM blueprints b WHERE b.expansion_id = expansions.id)",
            ([r[0] for r in rows], POKEMON_GAME_ID),
        )
        print(f"Cancellati {cur.rowcount} set.")
        conn.commit()
    cur.execute("SELECT count(*) FROM expansions")
    print(f"Set rimasti in expansions: {cur.fetchone()[0]}")
    conn.close()


if __name__ == "__main__":
    main()

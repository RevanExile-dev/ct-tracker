"""
Corregge image_url per i blueprint il cui dato nel bulk /blueprints/export
e' disallineato dal file reale (vedi commento su CardTraderClient.get_blueprint
in api_client.py): richiama l'endpoint singolo per-blueprint, che ha dati
piu' freschi, e aggiorna il DB solo se l'URL e' davvero cambiato.

Il sottoinsieme sospetto e' individuato dal suffisso "(2).jpg" nell'URL
salvato - un marcatore di versione che CardTrader toglie quando rielabora/
rinomina un'immagine senza aggiornare l'export bulk (verificato su un caso
reale, blueprint 406700).

Uso:
  python scripts/backfill_image_urls.py              # applica le correzioni
  python scripts/backfill_image_urls.py --dry-run     # mostra solo cosa cambierebbe
"""
import sys

import psycopg2

import db
from api_client import CardTraderClient

MAX_DB_RETRIES = 3


def _update_image_url(conn, bp_id, new_url):
    """Scrive l'UPDATE con un retry automatico se la connessione cade a
    meta' - osservato in produzione (run 36995062905): la run intera dura
    ~10 minuti per ~2.464 blueprint, rallentata dal rate limit di
    CardTraderClient (4 req/s), e a meta' l'endpoint pooled di Neon ha
    chiuso la connessione ("SSL connection has been closed unexpectedly"),
    facendo fallire l'intero script ben PRIMA di arrivare ai blueprint con
    id piu' alto (es. 30th Celebration) in fondo alla lista ordinata per
    id - quindi proprio le carte piu' recenti, le piu' probabili ad avere
    l'URL disallineato, restavano non corrette. Ritorna la connessione
    (nuova se ha dovuto riconnettersi), da riassegnare nel chiamante."""
    for attempt in range(1, MAX_DB_RETRIES + 1):
        try:
            with conn.cursor() as cur:
                cur.execute("UPDATE blueprints SET image_url = %s WHERE id = %s", (new_url, bp_id))
            conn.commit()
            return conn
        except psycopg2.OperationalError as exc:
            if attempt == MAX_DB_RETRIES:
                raise
            print(f"    connessione caduta ({exc}), riconnessione (tentativo {attempt}/{MAX_DB_RETRIES})...",
                  file=sys.stderr)
            conn = db.get_connection()


def main():
    dry_run = "--dry-run" in sys.argv[1:]
    unknown = [a for a in sys.argv[1:] if a != "--dry-run"]
    if unknown:
        print(f"Argomenti non riconosciuti: {' '.join(unknown)}", file=sys.stderr)
        sys.exit(2)

    conn = db.get_connection()
    cur = conn.cursor()
    cur.execute(
        "SELECT id, name, image_url FROM blueprints WHERE image_url LIKE %s ORDER BY id",
        ("%(2).jpg",),
    )
    rows = cur.fetchall()
    print(f"{len(rows)} blueprint con URL sospetto ('(2).jpg') da ricontrollare."
          + (" [DRY RUN, nessuna scrittura]" if dry_run else ""))

    client = CardTraderClient()
    updated = unchanged = missing = errors = 0

    for i, (bp_id, name, old_url) in enumerate(rows, start=1):
        try:
            bp = client.get_blueprint(bp_id)
        except Exception as exc:
            print(f"  [{i}/{len(rows)}] {bp_id} {name!r}: ERRORE {exc}", file=sys.stderr)
            errors += 1
            continue

        if not bp:
            print(f"  [{i}/{len(rows)}] {bp_id} {name!r}: non trovato (404)")
            missing += 1
            continue

        new_url = db._best_image_url(bp)
        if not new_url or new_url == old_url:
            unchanged += 1
            continue

        print(f"  [{i}/{len(rows)}] {bp_id} {name!r}:\n"
              f"      prima: {old_url}\n"
              f"      dopo:  {new_url}")
        updated += 1
        if not dry_run:
            conn = _update_image_url(conn, bp_id, new_url)

    print(f"\nFatto. {updated} aggiornati, {unchanged} invariati, "
          f"{missing} non trovati, {errors} errori su {len(rows)} totali.")
    if dry_run and updated:
        print("Dry run: nessuna modifica scritta. Rilancia senza --dry-run per applicarle.")

    conn.close()


if __name__ == "__main__":
    main()

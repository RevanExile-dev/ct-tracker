"""
Scarica i prezzi TCGplayer (in dollari) da tcgcsv.com e li salva in
external_prices, agganciati alle carte del catalogo tramite
blueprints.tcg_player_id (= productId TCGplayer, lo stesso numero che
CardTrader riporta nel blueprint).

Perche' tcgcsv e non l'API TCGplayer: TCGplayer non concede piu' nuovo
accesso API (docs.tcgplayer.com/docs/getting-started). tcgcsv.com e' uno
specchio pubblico e gratuito dei dati dell'API, aggiornato ogni giorno verso
le 20:00 UTC, con UNA richiesta per set. Misura reale del 2026-10-09: 683
richieste (Pokemon EN categoria 3 + Pokemon Giappone categoria 85), 11,4 MB,
~4 minuti con una pausa di 0,25 s tra le richieste (come nell'esempio del
loro FAQ), nessun errore; il 93% delle carte campione con tcg_player_id era
presente. Nessun termine d'uso scritto: una richiesta alla volta, User-Agent
identificabile, e i dati restano un "riferimento" (vedi schema.sql).

Cosa NON fa, di proposito:
  - non tocca latest_prices / price_listings / price_snapshots, ne' gli
    allarmi o i movers: sono medie per prodotto, non annunci con lingua e
    condizione esatte (principio del progetto: mai un prezzo di un profilo
    diverso spacciato per lo stesso);
  - non cancella righe: una riga che sparisce dalla fonte resta, e chi legge
    usa fetched_at per scartare quelle vecchie;
  - non chiama CardTrader.

Uso:
  python scripts/sync_external_prices.py            # giro completo, scrive su Postgres
  python scripts/sync_external_prices.py --dry-run  # scarica e riporta, non scrive
  python scripts/sync_external_prices.py --limit-groups 5   # prova veloce

Scrive a blocchi (un commit ogni COMMIT_EVERY_GROUPS set), cosi' un'interruzione
a meta' conserva il lavoro fatto. Idempotente: si puo' rilanciare quando si
vuole. Esce con codice 1 se troppi set falliscono (fonte giu' o cambiata).
"""
import argparse
import json
import math
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

# psycopg2 e db (che lo importa) si caricano solo dove servono: i test delle
# parti pure girano in CI senza installare le dipendenze del sync.

TCGCSV_BASE = "https://tcgcsv.com/tcgplayer"
CATEGORIES = {3: "Pokemon", 85: "Pokemon Giappone"}
SOURCE = "tcgplayer"
CURRENCY = "USD"
USER_AGENT = "CartaViva/1.0 (+https://github.com/RevanExile-dev/ct-tracker; sync prezzi di riferimento, 1 richiesta alla volta)"

REQUEST_DELAY_SECONDS = 0.25  # pausa tra le richieste, come l'esempio del FAQ di tcgcsv
FETCH_TRIES = 4
COMMIT_EVERY_GROUPS = 25
MAX_CONSECUTIVE_FAILURES = 15  # fonte giu': inutile continuare, il run diventa rosso
MAX_FAILED_GROUPS_PCT = 5  # oltre questa quota di set falliti il run esce con errore
INT32_MAX = 2_147_483_647


def to_cents(value) -> int | None:
    """Dollari (float/int/str) -> centesimi interi. None per tutto cio' che
    non e' un prezzo valido: assente, non numerico, negativo, NaN/inf, fuori
    dal range INTEGER di Postgres. Un prezzo a 0 resta 0 (la fonte lo riporta
    cosi' per carte senza vendite: il lettore decide come mostrarlo)."""
    if value is None or isinstance(value, bool):
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f) or f < 0:
        return None
    cents = round(f * 100)
    return cents if cents <= INT32_MAX else None


def build_rows(results: list, product_map: dict[int, list[int]]) -> list[tuple]:
    """Righe della risposta /prices di un set -> tuple (blueprint_id, source,
    variant, currency, price, low, mid, high) per le sole carte che
    conosciamo. Una riga senza nessun prezzo valido viene scartata. Lo stesso
    productId puo' appartenere a piu' blueprint (capita: 1 caso su 24.349):
    si scrive per tutti. Duplicati (blueprint, variante) dentro lo stesso set:
    vince l'ultimo con un prezzo di mercato."""
    out: dict[tuple, tuple] = {}
    for p in results:
        bps = product_map.get(p.get("productId"))
        if not bps:
            continue
        price = to_cents(p.get("marketPrice"))
        low = to_cents(p.get("lowPrice"))
        mid = to_cents(p.get("midPrice"))
        high = to_cents(p.get("highPrice"))
        if price is None and low is None and mid is None and high is None:
            continue
        variant = (p.get("subTypeName") or "").strip()
        for bp in bps:
            key = (bp, SOURCE, variant)
            prev = out.get(key)
            if prev is None or price is not None or prev[4] is None:
                out[key] = (bp, SOURCE, variant, CURRENCY, price, low, mid, high)
    return list(out.values())


def fetch_json(url: str):
    """GET con retry e backoff crescente. Ritorna None dopo FETCH_TRIES
    fallimenti (rete, 429, 5xx, JSON illeggibile): decide il chiamante."""
    last = None
    for i in range(FETCH_TRIES):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.load(r)
            if isinstance(data, dict) and data.get("success") is False:
                raise RuntimeError(f"success=false: {data.get('errors')}")
            return data
        except (urllib.error.URLError, TimeoutError, RuntimeError, json.JSONDecodeError, OSError) as e:
            last = e
            time.sleep(2 * (i + 1))
    print(f"  ! {url}: {last}", file=sys.stderr)
    return None


def load_product_map(conn) -> dict[int, list[int]]:
    """productId TCGplayer -> blueprint_id (lista: il caso raro di due
    blueprint con lo stesso id esiste davvero). Solo id numerici."""
    m: dict[int, list[int]] = {}
    with conn.cursor() as cur:
        cur.execute("SELECT id, tcg_player_id FROM blueprints WHERE tcg_player_id ~ '^[0-9]+$'")
        for bid, tid in cur.fetchall():
            m.setdefault(int(tid), []).append(bid)
    return m


UPSERT_SQL = """
INSERT INTO external_prices
  (blueprint_id, source, variant, currency, price_cents, low_cents, mid_cents, high_cents, fetched_at)
SELECT v.blueprint_id, v.source, v.variant, v.currency,
       v.price_cents, v.low_cents, v.mid_cents, v.high_cents, v.fetched_at
FROM (VALUES %s) AS v(blueprint_id, source, variant, currency,
                      price_cents, low_cents, mid_cents, high_cents, fetched_at)
-- Il join scarta in silenzio le carte cancellate dal catalogo tra il momento
-- in cui abbiamo letto la mappa e adesso (sync_catalog le elimina): senza,
-- una sola violazione di chiave esterna farebbe fallire l'intero blocco.
JOIN blueprints b ON b.id = v.blueprint_id
ON CONFLICT (blueprint_id, source, variant) DO UPDATE SET
  currency = EXCLUDED.currency,
  price_cents = EXCLUDED.price_cents,
  low_cents = EXCLUDED.low_cents,
  mid_cents = EXCLUDED.mid_cents,
  high_cents = EXCLUDED.high_cents,
  fetched_at = EXCLUDED.fetched_at
"""
UPSERT_TEMPLATE = "(%s::integer, %s, %s, %s, %s::integer, %s::integer, %s::integer, %s::integer, %s::timestamptz)"


def write_rows(conn, rows: list[tuple], fetched_at: datetime) -> None:
    """Un solo INSERT multi-riga per blocco. Le chiavi duplicate dentro lo
    stesso INSERT farebbero fallire ON CONFLICT DO UPDATE ("cannot affect row
    a second time"): si deduplica prima (vince l'ultima)."""
    import psycopg2.extras

    unique: dict[tuple, tuple] = {(r[0], r[1], r[2]): r for r in rows}
    if not unique:
        return
    values = [r + (fetched_at,) for r in unique.values()]
    with conn.cursor() as cur:
        psycopg2.extras.execute_values(cur, UPSERT_SQL, values, template=UPSERT_TEMPLATE, page_size=1000)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="scarica e riporta, senza scrivere sul database")
    ap.add_argument("--limit-groups", type=int, default=0, help="solo i primi N set per categoria (prova veloce)")
    ap.add_argument("--delay", type=float, default=REQUEST_DELAY_SECONDS, help="secondi tra una richiesta e l'altra")
    args = ap.parse_args()

    import db

    if not args.dry_run:
        db.init_db()
    conn = db.get_connection()
    started = time.time()
    fetched_at = datetime.now(timezone.utc)
    try:
        product_map = load_product_map(conn)
        print(f"Carte con tcg_player_id numerico: {sum(len(v) for v in product_map.values())} "
              f"({len(product_map)} prodotti distinti)")

        total_groups = failed_groups = consecutive_failures = 0
        seen_products: set[int] = set()
        written = 0
        pending: list[tuple] = []
        groups_since_commit = 0

        def flush():
            nonlocal pending, groups_since_commit, written
            if pending and not args.dry_run:
                write_rows(conn, pending, fetched_at)
                conn.commit()
            written += len({(r[0], r[1], r[2]) for r in pending})
            pending = []
            groups_since_commit = 0

        for cat, label in CATEGORIES.items():
            groups = fetch_json(f"{TCGCSV_BASE}/{cat}/groups")
            if groups is None:
                print(f"ERRORE: elenco set della categoria {cat} ({label}) non scaricabile.", file=sys.stderr)
                return 1
            group_list = groups.get("results", [])
            if args.limit_groups:
                group_list = group_list[: args.limit_groups]
            print(f"Categoria {cat} ({label}): {len(group_list)} set")
            for g in group_list:
                total_groups += 1
                time.sleep(args.delay)
                d = fetch_json(f"{TCGCSV_BASE}/{cat}/{g['groupId']}/prices")
                if d is None:
                    failed_groups += 1
                    consecutive_failures += 1
                    if consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                        flush()
                        print(f"ERRORE: {consecutive_failures} set di fila falliti, mi fermo (fonte non raggiungibile?).",
                              file=sys.stderr)
                        return 1
                    continue
                consecutive_failures = 0
                results = d.get("results", [])
                seen_products.update(p["productId"] for p in results if p.get("productId") in product_map)
                pending.extend(build_rows(results, product_map))
                groups_since_commit += 1
                if groups_since_commit >= COMMIT_EVERY_GROUPS:
                    flush()
        flush()

        if not args.dry_run:
            db.set_meta(conn, "last_external_prices_sync", fetched_at.isoformat())
            conn.commit()

        covered_cards = sum(len(product_map[p]) for p in seen_products)
        total_cards = sum(len(v) for v in product_map.values())
        pct = 100 * covered_cards / total_cards if total_cards else 0
        print(f"Set scaricati: {total_groups - failed_groups}/{total_groups} (falliti {failed_groups})")
        print(f"Carte con almeno un prezzo: {covered_cards}/{total_cards} ({pct:.1f}%), righe {'previste' if args.dry_run else 'scritte'}: {written}")
        print(f"Tempo: {time.time() - started:.0f} s")
        if total_groups and 100 * failed_groups / total_groups > MAX_FAILED_GROUPS_PCT:
            print(f"ERRORE: oltre il {MAX_FAILED_GROUPS_PCT}% dei set e' fallito.", file=sys.stderr)
            return 1
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())

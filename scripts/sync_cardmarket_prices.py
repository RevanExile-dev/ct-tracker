"""
Scarica i prezzi Cardmarket (in euro) da TCGdex e li salva in external_prices
come "riferimento di mercato" (source = 'cardmarket').

Perche' TCGdex e non l'API Cardmarket: Cardmarket non concede piu' nuovo
accesso API. TCGdex (api.tcgdex.net, open source, senza chiave, licenza MIT
sul database) riporta dentro ogni carta i prezzi Cardmarket (trend, low, avg,
medie a 1/7/30 giorni, piu' le righe "-holo") e li rinnova UNA volta al
giorno, in blocco, verso le 22:54 UTC. Misure reali del 2026-10-09: 0,18 s
per richiesta, 0 errori su ~250 richieste, prezzo Cardmarket presente nel 96%
delle carte trovate, anche per le giapponesi.

Come funziona (tre passi, tutti idempotenti):

  1. ABBINAMENTO carta CardTrader -> carta TCGdex, per set e numero di
     collezione (CardTrader e TCGdex non hanno una chiave in comune: l'id
     CardTrader compare in TCGdex solo nel ~6% delle carte). Le regole di
     scripts/sync_artists.py (set per codice PTCGO / nome / id giapponese,
     numero senza zeri, nome simile per le inglesi) sono riusate cosi' come
     sono, piu' un ripiego per nome sul set per i set usciti dopo lo snapshot
     degli artisti. Il risultato (external_card_map) viene salvato e riusato:
     si rifa' solo per le carte nuove e, ogni RECHECK_UNMATCHED_DAYS giorni,
     per quelle non trovate. Una carta e' abbinata solo se il numero e' unico:
     se due carte CardTrader cadono sulla stessa carta TCGdex nessuna delle
     due viene abbinata.
  2. CONTROLLO DI IDENTITA' a ogni scarico: se TCGdex riporta l'id CardTrader
     o TCGplayer della carta e NON coincide col nostro, l'abbinamento viene
     annullato e il prezzo non viene scritto (meglio nessun riferimento che
     quello di un'altra carta; misurato: 0 abbinamenti sbagliati su 72
     verificabili del campione).
  3. SCARICO a fasce (un solo giro al giorno, dopo le 23:00 UTC):
       - ogni giorno: carte nel binder / nei desideri / con un allarme attivo
         di qualunque utente, carte di valore (>= HIGH_VALUE_CENTS) e carte
         abbinate che non hanno ancora nessun prezzo Cardmarket;
       - le altre a rotazione, 1/ROTATION_DAYS al giorno (id % 7 == giorno).
     Cosi' si fanno ~8.000 richieste al giorno invece di ~22.000, con 4
     richieste in parallelo (~6-8 minuti), e nessuna carta resta piu' di una
     settimana senza aggiornamento.

Cosa NON fa, di proposito:
  - non tocca latest_prices / price_listings / price_snapshots, ne' gli
    allarmi o i movers: sono medie per prodotto, non annunci con lingua e
    condizione esatte (principio del progetto: mai un prezzo di un profilo
    diverso spacciato per lo stesso);
  - non cancella righe: una riga che sparisce dalla fonte resta, e chi legge
    usa fetched_at / source_updated_at per scartare quelle vecchie;
  - non chiama CardTrader.

Neon (free): la connessione al database viene aperta solo per leggere, poi
per ogni blocco di CHUNK_CARDS carte, e chiusa durante le attese di rete (un
database che si sospende a meta' non rompe il run). Scritture a blocchi con un
solo INSERT multiplo per blocco.

Uso:
  python scripts/sync_cardmarket_prices.py             # giro del giorno, scrive su Postgres
  python scripts/sync_cardmarket_prices.py --dry-run   # abbina e scarica, non scrive
  python scripts/sync_cardmarket_prices.py --limit 50  # prova veloce su 50 carte
  python scripts/sync_cardmarket_prices.py --all       # tutte le carte abbinate, senza rotazione

Esce con codice 1 se troppe richieste falliscono (fonte giu' o cambiata).
"""
import argparse
import json
import math
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone

import sync_artists as sa  # solo libreria standard: nessuna dipendenza in piu'

# psycopg2 e db (che lo importa) si caricano solo dove servono: i test delle
# parti pure girano in CI senza installare le dipendenze del sync.

TCGDEX = "https://api.tcgdex.net/v2"
SOURCE = "cardmarket"
CURRENCY = "EUR"
USER_AGENT = "CartaViva/1.0 (+https://github.com/RevanExile-dev/ct-tracker; sync prezzi di riferimento, 4 richieste in parallelo al giorno)"

THREADS = 4  # misurato: 8 thread -> ~40 richieste/s senza errori; 4 e' piu' che sufficiente e piu' educato
REQUEST_DELAY_SECONDS = 0.1  # pausa per thread dopo ogni richiesta -> ~13 richieste/s in tutto
FETCH_TRIES = 4
CHUNK_CARDS = 400  # carte scaricate e poi scritte (un commit) alla volta
HIGH_VALUE_CENTS = 1000  # sotto i 10 EUR una carta si aggiorna a rotazione
ROTATION_DAYS = 7
RECHECK_UNMATCHED_DAYS = 14  # una carta non trovata si riprova dopo tanto (TCGdex aggiunge set/carte col tempo)
MAX_CARDS_PER_RUN = 15000  # tetto di sicurezza sulle richieste di un giro
MAX_CONSECUTIVE_FAILURES = 25  # fonte giu': inutile continuare, il run diventa rosso
MAX_FAILED_PCT = 5  # oltre questa quota di carte fallite il run esce con errore
INT32_MAX = 2_147_483_647


# ----------------------------------------------------------- parti pure ----

def to_cents(value) -> int | None:
    """Euro (float) -> centesimi interi. None per valori assenti o assurdi:
    None, bool, NaN/inf, zero o negativi (TCGdex scrive 0 dove la riga non
    esiste, es. 'trend-holo': 0 con tutti gli altri campi holo null; un
    prezzo Cardmarket vero e' sempre >= 0,02) o oltre INT32."""
    if value is None or isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if isinstance(value, float) and not math.isfinite(value):
        return None
    cents = round(value * 100)
    if cents <= 0 or cents > INT32_MAX:
        return None
    return int(cents)


def parse_ts(value) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


# (suffisso della chiave TCGdex, nome variante nella tabella)
_VARIANT_SUFFIXES = (("", ""), ("-holo", "holo"))


def parse_pricing(pricing) -> list[dict]:
    """pricing di una carta TCGdex -> righe per external_prices (una per
    variante con almeno un prezzo). [] se Cardmarket non c'e' o non e' in euro."""
    cm = pricing.get("cardmarket") if isinstance(pricing, dict) else None
    if not isinstance(cm, dict):
        return []
    if cm.get("unit") not in (None, "EUR"):
        return []
    updated = parse_ts(cm.get("updated"))
    rows = []
    for suffix, variant in _VARIANT_SUFFIXES:
        vals = {
            "price_cents": to_cents(cm.get("trend" + suffix)),
            "low_cents": to_cents(cm.get("low" + suffix)),
            "mid_cents": to_cents(cm.get("avg" + suffix)),
            "avg1_cents": to_cents(cm.get("avg1" + suffix)),
            "avg7_cents": to_cents(cm.get("avg7" + suffix)),
            "avg30_cents": to_cents(cm.get("avg30" + suffix)),
        }
        if all(v is None for v in vals.values()):
            continue
        rows.append({"variant": variant, "source_updated_at": updated, **vals})
    return rows


def identity_conflict(card: dict, blueprint_id: int, tcg_player_id: str | None) -> str | None:
    """Se TCGdex riporta l'id CardTrader (o, in mancanza, TCGplayer) della
    carta e non coincide col nostro -> motivo del conflitto, altrimenti None
    (nessun id riportato = nessuna verifica possibile, non un conflitto)."""
    ct, tp = set(), set()
    for v in card.get("variants_detailed") or []:
        third = v.get("thirdParty") if isinstance(v, dict) else None
        if not isinstance(third, dict):
            continue
        if third.get("cardtrader") is not None:
            ct.add(str(third["cardtrader"]))
        if third.get("tcgplayer") is not None:
            tp.add(str(third["tcgplayer"]))
    if ct:
        return None if str(blueprint_id) in ct else "cardtrader_id"
    if tp and tcg_player_id:
        return None if str(tcg_player_id) in tp else "tcgplayer_id"
    return None


_BARE_NUMBER = re.compile(r"^\s*([A-Za-z]{0,5}\d{1,3}[a-z]?)\s*$")


def parse_number(version: str | None) -> str | None:
    """Numero di collezione da blueprints.version. Come
    sync_artists.parse_version, piu' il caso del numero "nudo" ("62", usato da
    CardTrader per molti promo): li' parse_version non trova nulla perche' non
    c'e' ne' '/' ne' un prefisso. Sicuro perche' per le carte inglesi il nome
    deve comunque combaciare."""
    num, _ = sa.parse_version(version)
    if num:
        return num
    m = _BARE_NUMBER.match(version or "")
    return m.group(1) if m else None


def make_external_id(lang: str, tcgdex_id: str) -> str:
    return f"{lang}:{tcgdex_id}"


def split_external_id(external_id: str) -> tuple[str, str]:
    lang, _, cid = external_id.partition(":")
    return lang, cid


# Set CardTrader che le regole di sync_artists non risolvono -> id set TCGdex
# (lingua, id). Verificati a mano sui dati veri del 2026-10-09: 'promosv' sono
# i promo giapponesi ("001/SV-P"), TCGdex li ha come SV-P.
SET_OVERRIDES: dict[str, list[tuple[str, str]]] = {
    "promosv": [("ja", "SV-P")],
}


def resolve_candidates(code: str, exp_name: str, snap: dict, en_sets: dict[str, str], ja_ids: dict[str, str],
                       en_ids: dict[str, str] | None = None) -> list[tuple[str, str]]:
    """Per un set CardTrader -> [(lingua, id set TCGdex)].
    en_sets: name_key(nome set TCGdex en) -> id; ja_ids / en_ids: id TCGdex in
    minuscolo -> id vero. Parte dalle regole di sync_artists (codice PTCGO /
    nome / id giapponese, set "fratelli" Trainer Gallery ecc.; l'id del set
    pokemon-tcg-data coincide spesso con quello TCGdex: svp, swshp, smp, xyp,
    bwp, cel25...) e, se non trovano nulla, ripiega sul nome del set
    CardTrader (set usciti dopo lo snapshot degli artisti)."""
    if code.lower() in SET_OVERRIDES:
        return list(SET_OVERRIDES[code.lower()])
    en_ids = en_ids or {}
    cands = sa.candidate_sets(code, exp_name, snap)
    out: list[tuple[str, str]] = []
    for ptd in cands["en"]:
        name = (snap["en_sets"].get(ptd) or {}).get("name") or ""
        sid = en_sets.get(sa.name_key(name)) if name else None
        sid = sid or en_ids.get(ptd.lower())
        if sid:
            out.append(("en", sid))
    for jid in cands["ja"]:
        real = ja_ids.get(jid.lower())
        if real:
            out.append(("ja", real))
    if not out:
        key = sa.name_key(exp_name)
        if key and key in en_sets:
            out.append(("en", en_sets[key]))
        if code and code.lower() in ja_ids:
            out.append(("ja", ja_ids[code.lower()]))
    seen, uniq = set(), []
    for c in out:
        if c not in seen:
            seen.add(c)
            uniq.append(c)
    return uniq


def match_expansion(bps: list[dict], set_cards: dict[tuple[str, str], list[dict]], cands: list[tuple[str, str]]) -> dict[int, str | None]:
    """bps: carte CardTrader di UN'espansione (id, name, version).
    set_cards: (lingua, id set) -> carte TCGdex del set ({id, localId, name}).
    Ritorna {blueprint_id: external_id | None} per tutte le bps (None = non
    trovata / nome diverso / numero ambiguo). Sceglie la lingua che fa
    combaciare piu' carte, come sync_artists.match_all."""
    def try_lang(lang: str):
        merged: dict[str, tuple[str, str]] = {}
        prefixes: set[str] = set()
        used = False
        for (l, sid) in cands:
            if l != lang:
                continue
            for c in set_cards.get((l, sid)) or []:
                used = True
                local_id = c.get("localId")
                k = sa.number_keys(str(local_id) if local_id is not None else None, set())
                if not k:
                    continue
                merged.setdefault(k[0], (c["id"], c.get("name") or ""))
                m = re.match(r"([A-Z]+)\d", k[0])
                if m:
                    prefixes.add(m.group(1))
        if not used:
            return None
        hits: dict[int, str] = {}
        for bp in bps:
            num = parse_number(bp.get("version"))
            found = None
            for k in sa.number_keys(num, prefixes, digit_fallback=(lang == "en")):
                if k in merged:
                    found = merged[k]
                    break
            if not found:
                continue
            tid, tname = found
            if lang == "en" and not sa.similar_names(bp.get("name") or "", tname):
                continue
            hits[bp["id"]] = make_external_id(lang, tid)
        return hits

    results = {lang: try_lang(lang) for lang in ("en", "ja")}
    usable = {l: r for l, r in results.items() if r is not None}
    hits = max(usable.values(), key=len) if usable else {}
    # Numero ambiguo: due carte CardTrader sulla stessa carta TCGdex -> nessuna
    # delle due (non si sa quale delle due sia quella del prezzo).
    claims = Counter(hits.values())
    return {bp["id"]: (hits.get(bp["id"]) if hits.get(bp["id"]) and claims[hits[bp["id"]]] == 1 else None) for bp in bps}


def needs_mapping(map_rows: dict[int, tuple[str | None, datetime]], blueprint_id: int, now: datetime) -> bool:
    row = map_rows.get(blueprint_id)
    if row is None:
        return True
    external_id, checked_at = row
    return external_id is None and checked_at < now - timedelta(days=RECHECK_UNMATCHED_DAYS)


def select_cards(blueprints: list[dict], map_rows: dict, user_ids: set[int], priced_ids: set[int], now: datetime, all_cards: bool = False) -> list[dict]:
    """Carte (gia' abbinate) da scaricare oggi, prioritarie per prime.
    Prioritarie: dell'utente (binder/desideri/allarmi), di valore, o appena
    abbinate e ancora senza prezzo (solo nei primi ROTATION_DAYS giorni
    dall'abbinamento: una carta che TCGdex non prezza mai non va richiesta
    ogni giorno per sempre, poi segue la rotazione come le altre)."""
    slot = now.date().toordinal() % ROTATION_DAYS
    new_since = now - timedelta(days=ROTATION_DAYS)
    priority, rotation = [], []
    for bp in blueprints:
        row = map_rows.get(bp["id"])
        if not row or not row[0]:
            continue
        item = {**bp, "external_id": row[0]}
        is_priority = (
            all_cards
            or bp["id"] in user_ids
            or (bp.get("best_price_cents") or 0) >= HIGH_VALUE_CENTS
            or (bp["id"] not in priced_ids and row[1] >= new_since)
        )
        if is_priority:
            priority.append(item)
        elif bp["id"] % ROTATION_DAYS == slot:
            rotation.append(item)
    return priority + rotation


def coverage_too_low(failed: int, attempted: int, max_pct: float = MAX_FAILED_PCT) -> bool:
    return attempted > 0 and failed * 100 > attempted * max_pct


# ------------------------------------------------------------------- rete --

def fetch_json(url: str):
    """GET con retry e backoff. Ritorna (stato, dati): (200, json), (404, None)
    se la carta non esiste piu', (None, None) dopo FETCH_TRIES fallimenti
    (rete, 429, 5xx, JSON illeggibile): decide il chiamante."""
    last = None
    for i in range(FETCH_TRIES):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=40) as r:
                return 200, json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return 404, None
            last = e
            retry_after = e.headers.get("Retry-After") if e.headers else None
            time.sleep(min(float(retry_after), 60) if retry_after and retry_after.isdigit() else 2 * (i + 1))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as e:
            last = e
            time.sleep(2 * (i + 1))
    print(f"  ! {url}: {last}", file=sys.stderr)
    return None, None


def card_url(external_id: str) -> str:
    lang, cid = split_external_id(external_id)
    return f"{TCGDEX}/{lang}/cards/{urllib.parse.quote(cid, safe='')}"


def fetch_card(item: dict):
    status, data = fetch_json(card_url(item["external_id"]))
    time.sleep(REQUEST_DELAY_SECONDS)
    return item, status, data


# --------------------------------------------------------------- database --

def load_state(conn):
    """Legge in una volta sola tutto quello che serve (poi la connessione si
    chiude durante le attese di rete)."""
    import psycopg2

    with conn.cursor() as cur:
        cur.execute(
            "SELECT b.id, b.name, b.version, b.expansion_id, b.expansion_code, b.expansion_name, "
            "b.tcg_player_id, COALESCE(lp.best_price_cents, lp.min_price_cents) "
            "FROM blueprints b LEFT JOIN latest_prices lp ON lp.blueprint_id = b.id"
        )
        cols = ["id", "name", "version", "expansion_id", "expansion_code", "expansion_name", "tcg_player_id", "best_price_cents"]
        blueprints = [dict(zip(cols, r)) for r in cur.fetchall()]
        user_ids: set[int] = set()
        for sql in (
            "SELECT blueprint_id FROM binder_cards",
            "SELECT blueprint_id FROM wishlist_cards",
            "SELECT blueprint_id FROM price_alerts WHERE state = 'armed'",
        ):
            cur.execute(sql)
            user_ids.update(r[0] for r in cur.fetchall())
        map_rows: dict[int, tuple[str | None, datetime]] = {}
        priced_ids: set[int] = set()
        try:
            cur.execute("SELECT blueprint_id, external_id, checked_at FROM external_card_map WHERE source = %s", (SOURCE,))
            map_rows = {r[0]: (r[1], r[2]) for r in cur.fetchall()}
            cur.execute("SELECT DISTINCT blueprint_id FROM external_prices WHERE source = %s", (SOURCE,))
            priced_ids = {r[0] for r in cur.fetchall()}
        except psycopg2.errors.UndefinedTable:
            conn.rollback()  # --dry-run su un database dove lo schema non e' ancora stato applicato
    conn.rollback()  # niente transazione aperta durante le attese di rete che seguono
    return blueprints, user_ids, map_rows, priced_ids


def write_map(conn, rows: list[tuple[int, str | None]], checked_at: datetime):
    import psycopg2.extras

    if not rows:
        return
    with conn.cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            "INSERT INTO external_card_map (blueprint_id, source, external_id, checked_at) "
            "SELECT v.* FROM (VALUES %s) AS v(blueprint_id, source, external_id, checked_at) "
            "JOIN blueprints b ON b.id = v.blueprint_id "
            "ON CONFLICT (blueprint_id, source) DO UPDATE SET "
            "external_id = EXCLUDED.external_id, checked_at = EXCLUDED.checked_at",
            [(bid, SOURCE, ext, checked_at) for bid, ext in rows],
            template="(%s::integer, %s, %s::text, %s::timestamptz)",
            page_size=1000,
        )


def write_prices(conn, rows: list[tuple], fetched_at: datetime):
    import psycopg2.extras

    if not rows:
        return
    with conn.cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            "INSERT INTO external_prices (blueprint_id, source, variant, currency, price_cents, low_cents, "
            "mid_cents, avg1_cents, avg7_cents, avg30_cents, source_updated_at, fetched_at) "
            "SELECT v.* FROM (VALUES %s) AS v(blueprint_id, source, variant, currency, price_cents, low_cents, "
            "mid_cents, avg1_cents, avg7_cents, avg30_cents, source_updated_at, fetched_at) "
            "JOIN blueprints b ON b.id = v.blueprint_id "  # una carta tolta dal catalogo nel frattempo viene saltata
            "ON CONFLICT (blueprint_id, source, variant) DO UPDATE SET "
            "currency = EXCLUDED.currency, price_cents = EXCLUDED.price_cents, low_cents = EXCLUDED.low_cents, "
            "mid_cents = EXCLUDED.mid_cents, avg1_cents = EXCLUDED.avg1_cents, avg7_cents = EXCLUDED.avg7_cents, "
            "avg30_cents = EXCLUDED.avg30_cents, source_updated_at = EXCLUDED.source_updated_at, "
            "fetched_at = EXCLUDED.fetched_at",
            [r + (fetched_at,) for r in rows],
            template="(%s::integer, %s, %s, %s, %s::integer, %s::integer, %s::integer, %s::integer, "
                     "%s::integer, %s::integer, %s::timestamptz, %s::timestamptz)",
            page_size=1000,
        )


# ------------------------------------------------------------ abbinamento --

def run_mapping(blueprints: list[dict], todo_ids: set[int], snap: dict) -> dict[int, str | None]:
    """Abbina le carte in todo_ids; ritorna {blueprint_id: external_id | None}."""
    status, en_list = fetch_json(f"{TCGDEX}/en/sets")
    status_ja, ja_list = fetch_json(f"{TCGDEX}/ja/sets")
    if not en_list or not ja_list:
        print("ERRORE: elenco set TCGdex non raggiungibile.", file=sys.stderr)
        sys.exit(1)
    en_sets = {sa.name_key(s["name"]): s["id"] for s in en_list}
    ja_ids = {s["id"].lower(): s["id"] for s in ja_list}
    en_ids = {s["id"].lower(): s["id"] for s in en_list}

    by_exp: dict[int, list[dict]] = defaultdict(list)
    for bp in blueprints:
        if bp["id"] in todo_ids:
            by_exp[bp["expansion_id"]].append(bp)
    exp_cands = {}
    for eid, bps in by_exp.items():
        b0 = bps[0]
        exp_cands[eid] = resolve_candidates(b0["expansion_code"] or "", b0["expansion_name"] or "", snap, en_sets, ja_ids, en_ids)

    needed = sorted({c for cands in exp_cands.values() for c in cands})

    def get_set(key):
        lang, sid = key
        st, d = fetch_json(f"{TCGDEX}/{lang}/sets/{urllib.parse.quote(sid, safe='')}")
        time.sleep(REQUEST_DELAY_SECONDS)
        # None = lettura fallita (rete, 5xx): diverso da "set senza carte" ([]).
        return key, ((d or {}).get("cards") or []) if st == 200 else None

    with ThreadPoolExecutor(THREADS) as ex:
        set_cards = dict(ex.map(get_set, needed))

    result: dict[int, str | None] = {}
    no_set = Counter()
    skipped = 0
    for eid, bps in by_exp.items():
        if any(set_cards.get(c) is None for c in exp_cands[eid]):
            # Un set non letto non e' un set vuoto: non scrivo "non trovata"
            # (che bloccherebbe il riprovare per RECHECK_UNMATCHED_DAYS), lascio
            # le carte da abbinare al prossimo giro.
            skipped += len(bps)
            continue
        if not exp_cands[eid]:
            no_set[(bps[0]["expansion_code"], bps[0]["expansion_name"])] += len(bps)
        result.update(match_expansion(bps, set_cards, exp_cands[eid]))
    if skipped:
        print(f"  ! {skipped} carte lasciate da abbinare: lettura di un set TCGdex fallita (si riprova al prossimo giro).", file=sys.stderr)
    matched = sum(1 for v in result.values() if v)
    print(f"Abbinamento: {matched}/{len(result)} carte abbinate su {len(by_exp)} espansioni ({len(needed)} set TCGdex letti).")
    if no_set:
        print("  Espansioni senza set TCGdex corrispondente (carte):", dict(no_set.most_common(12)))
    return result


# ------------------------------------------------------------------- main --

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="abbina e scarica, ma non scrive sul database")
    ap.add_argument("--limit", type=int, help="scarica al massimo N carte (prove)")
    ap.add_argument("--all", action="store_true", help="tutte le carte abbinate, senza rotazione")
    ap.add_argument("--remap", action="store_true", help="rifa' l'abbinamento di tutte le carte, anche quelle gia' abbinate")
    args = ap.parse_args()

    import db  # import tardivo: i test non devono richiedere psycopg2

    if not args.dry_run:
        db.init_db()
    now = datetime.now(timezone.utc)

    conn = db.get_connection()
    try:
        blueprints, user_ids, map_rows, priced_ids = load_state(conn)
    finally:
        conn.close()
    print(f"Catalogo: {len(blueprints)} carte, {len(map_rows)} abbinamenti gia' salvati, {len(priced_ids)} con prezzo Cardmarket.")

    # 1. abbinamento delle carte nuove / da riprovare
    todo = {bp["id"] for bp in blueprints if args.remap or needs_mapping(map_rows, bp["id"], now)}
    if todo:
        snap = sa.load_snapshot()
        new_map = run_mapping(blueprints, todo, snap)
        if not args.dry_run:
            conn = db.get_connection()
            try:
                write_map(conn, list(new_map.items()), now)
                conn.commit()
            finally:
                conn.close()
        for bid, ext in new_map.items():
            map_rows[bid] = (ext, now)
    else:
        print("Abbinamento: nessuna carta nuova da abbinare.")

    # 2. quali carte scaricare oggi
    cards = select_cards(blueprints, map_rows, user_ids, priced_ids, now, args.all)
    cap = args.limit if args.limit else MAX_CARDS_PER_RUN
    if len(cards) > cap:
        print(f"Attenzione: {len(cards)} carte da scaricare, ne faccio {cap} (tetto).")
        cards = cards[:cap]
    mapped_total = sum(1 for r in map_rows.values() if r[0])
    print(f"Oggi: {len(cards)} carte da scaricare (su {mapped_total} abbinate).")

    # 3. scarico a blocchi, scrittura a blocchi
    stats = Counter()
    consecutive_fail = 0
    aborted = False
    for start in range(0, len(cards), CHUNK_CARDS):
        chunk = cards[start:start + CHUNK_CARDS]
        with ThreadPoolExecutor(THREADS) as ex:
            fetched = list(ex.map(fetch_card, chunk))
        price_rows, map_updates = [], []
        for item, status, data in fetched:
            stats["richieste"] += 1
            if status is None:
                stats["errori"] += 1
                consecutive_fail += 1
                continue
            consecutive_fail = 0
            if status == 404:
                stats["carta_sparita"] += 1
                map_updates.append((item["id"], None))
                continue
            reason = identity_conflict(data, item["id"], item.get("tcg_player_id"))
            if reason:
                stats["conflitto_" + reason] += 1
                map_updates.append((item["id"], None))
                continue
            rows = parse_pricing(data.get("pricing"))
            if not rows:
                stats["senza_prezzo"] += 1
                continue
            stats["con_prezzo"] += 1
            for r in rows:
                price_rows.append((
                    item["id"], SOURCE, r["variant"], CURRENCY, r["price_cents"], r["low_cents"], r["mid_cents"],
                    r["avg1_cents"], r["avg7_cents"], r["avg30_cents"], r["source_updated_at"],
                ))
        if not args.dry_run and (price_rows or map_updates):
            conn = db.get_connection()
            try:
                write_prices(conn, price_rows, now)
                write_map(conn, map_updates, now)
                conn.commit()
            finally:
                conn.close()
        stats["righe_scritte"] += len(price_rows)
        print(f"  {min(start + CHUNK_CARDS, len(cards))}/{len(cards)} carte, {stats['righe_scritte']} righe", flush=True)
        if consecutive_fail >= MAX_CONSECUTIVE_FAILURES:
            print(f"ERRORE: {consecutive_fail} richieste fallite di fila, mi fermo (TCGdex non raggiungibile?).", file=sys.stderr)
            aborted = True
            break

    if not args.dry_run and not aborted and stats["richieste"]:
        conn = db.get_connection()
        try:
            db.set_meta(conn, "last_cardmarket_sync", now.isoformat(timespec="seconds"))
            conn.commit()
        finally:
            conn.close()

    print("Riepilogo:", dict(stats))
    if args.dry_run:
        print("--dry-run: nessuna scrittura.")
    if aborted or coverage_too_low(stats["errori"], stats["richieste"]):
        print("ERRORE: troppe richieste fallite.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

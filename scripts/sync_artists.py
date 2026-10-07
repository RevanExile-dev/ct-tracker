"""
Associa a ogni carta del catalogo (blueprints) il suo illustratore, per il
filtro "Artista" del sito.

CardTrader NON espone l'illustratore, quindi il dato viene da due fonti
pubbliche e gratuite, entrambe con il campo illustratore per carta:

  - pokemon-tcg-data (github.com/PokemonTCG/pokemon-tcg-data, il dataset
    dietro pokemontcg.io): carte in inglese, un file JSON per set, campo
    "artist". Copre le espansioni occidentali fino a Perfect Order/Pitch
    Black/30th Celebration (2026).
  - TCGdex (api.tcgdex.net, open source, senza chiave), lingua "ja": le carte
    giapponesi (SV4a, S12a, M2a, promo SV-P, ...), che pokemon-tcg-data non ha
    e che nel nostro catalogo sono oltre meta' dei set. Campo "illustrator".
    Limite noto: TCGdex non ha ancora le carte di molti set giapponesi piu'
    vecchi (Sword & Shield S1-S8a, XY, Black & White, Sun & Moon "+", promo JP)
    -> quelle carte restano senza artista.
  - TCGdex in lingua "en", solo per i set recenti dove pokemon-tcg-data ha le
    carte ma non ancora il campo artista (verificato a mano: sv7-sv10, me1,
    me3 ...); i due dataset coincidono al 99,6% sulle carte dove hanno
    entrambi l'artista (campione di 2.500 carte, 2026-10-07).

Due passi, volutamente separati (la parte lenta e' scaricare, non incrociare):

  python scripts/sync_artists.py --refresh
      Scarica le due fonti e riscrive lo snapshot versionato
      data/card_artists.json.gz (circa 30k carte, ~10 minuti per le chiamate
      TCGdex). Non tocca il database. Da rilanciare quando escono set nuovi.

  python scripts/sync_artists.py [--dry-run]
      Incrocia lo snapshot col catalogo nel Postgres (POSTGRES_URL) e scrive
      blueprints.artist. --dry-run stampa solo il rapporto (quante carte
      combaciano, quali set restano scoperti) senza scrivere nulla.
      Idempotente: si puo' rilanciare dopo ogni sync_catalog per i blueprint
      nuovi.

Come si decide che una carta combacia (regole strette: meglio una carta
senza artista che una con l'artista sbagliato):
  1. Il set CardTrader viene associato a un set della fonte: codice
     CardTrader = codice PTCGO del set inglese (obf, svi, brs, ...) oppure
     id TCGdex del set giapponese in minuscolo (sv4a, s12a, m2a, ...). Se
     entrambe le lingue sono candidate vince quella che fa combaciare piu'
     carte.
  2. Dentro il set la carta si cerca per numero di collezione (il numero
     prima di "/" in blueprints.version, es. "Ultra Rare | 221/197" -> 221).
  3. Per le carte inglesi si verifica anche il nome (CardTrader vs
     pokemon-tcg-data): se non assomigliano, la carta NON riceve l'artista.
     Le carte giapponesi hanno nomi in giapponese nella fonte, quindi li' il
     controllo e' sul totale stampato del set (il "/197" deve coincidere col
     numero di carte ufficiali del set TCGdex).
"""
import argparse
import difflib
import gzip
import json
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT_PATH = REPO_ROOT / "data" / "card_artists.json.gz"
TOP_ARTISTS_PATH = REPO_ROOT / "web" / "config" / "top_artists.json"

PTD_RAW = "https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master"
TCGDEX_JA = "https://api.tcgdex.net/v2/ja"
TCGDEX_EN = "https://api.tcgdex.net/v2/en"

# Set CardTrader il cui codice non coincide col codice PTCGO / id TCGdex (o
# ambigui) -> (fonte, id set nella fonte). Verificati a mano guardando i
# rapporti del --dry-run; il resto si risolve da solo (vedi _candidate_sets).
SET_OVERRIDES: dict[str, list[tuple[str, str]]] = {
    "xy-en": [("en", "xy1")],
    # promo: CardTrader le chiama in modo diverso dalle fonti
    "bwbsp": [("en", "bwp")],
    "swshbs": [("en", "swshp")],
    "smbs": [("en", "smp")],
    "xybsp": [("en", "xyp")],
    "svpromo": [("en", "svp")],
    "c25": [("en", "cel25"), ("en", "cel25c")],
    "pkmgo": [("en", "pgo")],
}


# ---------------------------------------------------------------- snapshot --

def _get_json(url: str, tries: int = 5):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "cartaviva-sync-artists"})
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.load(r)
        except Exception as e:  # rete instabile: riprova con attesa crescente
            last = e
            import time
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"{url}: {last}")


def _fetch_en() -> tuple[dict, list]:
    sets = _get_json(f"{PTD_RAW}/sets/en.json")
    en_cards: list[list] = []
    en_sets: dict[str, dict] = {}
    for s in sets:
        en_sets[s["id"]] = {"name": s["name"], "ptcgo": s.get("ptcgoCode"), "printed": s.get("printedTotal")}
        for c in _get_json(f"{PTD_RAW}/cards/en/{s['id']}.json"):
            # [set, numero, nome, artista]
            en_cards.append([s["id"], c["number"], c["name"], c.get("artist")])
    _fill_missing_from_tcgdex_en(en_sets, en_cards)
    return en_sets, en_cards


def _fill_missing_from_tcgdex_en(en_sets: dict, en_cards: list):
    """pokemon-tcg-data aggiunge le carte di un set nuovo prima degli artisti:
    per i set dove manca l'artista nella maggior parte delle carte, lo si
    prende da TCGdex (lingua en), abbinando il set per nome e la carta per
    numero. Solo per riempire buchi: dove pokemon-tcg-data ha l'artista, vince."""
    by_set: dict[str, list[list]] = defaultdict(list)
    for row in en_cards:
        by_set[row[0]].append(row)
    gap_sets = [sid for sid, rows in by_set.items()
                if sum(1 for r in rows if not r[3]) / len(rows) > 0.3]
    if not gap_sets:
        return
    tcgdex_sets = {name_key(s["name"]): s["id"] for s in _get_json(f"{TCGDEX_EN}/sets")}
    for sid in gap_sets:
        tid = tcgdex_sets.get(name_key(en_sets[sid]["name"]))
        if not tid:
            print(f"  [en] {sid} ({en_sets[sid]['name']}): nessun set TCGdex con lo stesso nome, resta senza artista", file=sys.stderr)
            continue
        cards = _get_json(f"{TCGDEX_EN}/sets/{urllib.parse.quote(tid, safe='')}").get("cards", [])

        def one(c):
            d = _get_json(f"{TCGDEX_EN}/cards/{urllib.parse.quote(c['id'], safe='')}")
            return c["localId"], d.get("illustrator")

        with ThreadPoolExecutor(16) as ex:
            found = {number_keys(n, set())[0]: a for n, a in ex.map(one, cards) if a}
        filled = 0
        for row in by_set[sid]:
            if not row[3]:
                a = found.get(number_keys(row[1], set())[0])
                if a:
                    row[3] = a
                    filled += 1
        print(f"  [en] {sid} ({en_sets[sid]['name']}): {filled}/{len(by_set[sid])} artisti presi da TCGdex")


def _fetch_ja() -> tuple[dict, list]:
    ja_sets_raw = _get_json(f"{TCGDEX_JA}/sets")
    ja_sets: dict[str, dict] = {}
    ja_ids: list[tuple[str, str]] = []
    for s in ja_sets_raw:
        d = _get_json(f"{TCGDEX_JA}/sets/{urllib.parse.quote(s['id'], safe='')}")
        ja_sets[s["id"]] = {"name": s["name"], "official": d.get("cardCount", {}).get("official")}
        for c in d.get("cards", []):
            ja_ids.append((s["id"], c["id"]))

    def one(t):
        sid, cid = t
        # gli id con '+' (SM1+, SM5+, ...) vanno codificati: un '+' nel path
        # darebbe 404 e il set sparirebbe in silenzio dallo snapshot.
        d = _get_json(f"{TCGDEX_JA}/cards/{urllib.parse.quote(cid, safe='')}")
        return [sid, d.get("localId"), d.get("name"), d.get("illustrator")]

    with ThreadPoolExecutor(16) as ex:
        ja_cards = list(ex.map(one, ja_ids))
    return ja_sets, ja_cards


def refresh_snapshot(only: str | None = None) -> dict:
    """Scarica le fonti e ritorna lo snapshot (non scrive su disco). Con
    only='en' o 'ja' riscarica solo quella parte e tiene l'altra da quello
    esistente (la parte giapponese richiede ~10 minuti di chiamate)."""
    base = load_snapshot() if only else {}
    if only != "ja":
        en_sets, en_cards = _fetch_en()
    else:
        en_sets, en_cards = base["en_sets"], base["en_cards"]
    if only != "en":
        ja_sets, ja_cards = _fetch_ja()
    else:
        ja_sets, ja_cards = base["ja_sets"], base["ja_cards"]
    return {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "sources": {
            "en": "pokemon-tcg-data (github.com/PokemonTCG/pokemon-tcg-data) + buchi dei set recenti da TCGdex en",
            "ja": "TCGdex (api.tcgdex.net/v2/ja)",
        },
        "en_sets": en_sets, "en_cards": en_cards,
        "ja_sets": ja_sets, "ja_cards": ja_cards,
    }


def load_snapshot() -> dict:
    with gzip.open(SNAPSHOT_PATH, "rt", encoding="utf-8") as f:
        return json.load(f)


def save_snapshot(snap: dict):
    SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(SNAPSHOT_PATH, "wt", encoding="utf-8", compresslevel=9) as f:
        json.dump(snap, f, ensure_ascii=False, separators=(",", ":"))


# ------------------------------------------------------------- normalizzare --

def _fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    return "".join(ch for ch in s if not unicodedata.combining(ch))


def name_key(s: str) -> str:
    """Chiave per confrontare nomi di carta/artista: minuscolo, senza accenti
    ne' punteggiatura ('Pokémon' = 'pokemon', 'N's Zorua' = 'ns zorua')."""
    return re.sub(r"[^a-z0-9]+", "", _fold(s).lower())


def number_keys(raw: str | None, set_prefixes: set[str], digit_fallback: bool = False) -> list[str]:
    """Chiavi con cui cercare un numero di collezione, dalla piu' specifica.
    'TG01' -> ['TG1'], '001' -> ['1'] (+ eventuale prefisso proprio del set,
    es. SVP/SWSH per i promo dove CardTrader omette il prefisso)."""
    if not raw:
        return []
    token = re.sub(r"[^A-Za-z0-9]", "", raw).upper()
    token = re.sub(r"(?<![0-9])0+(?=[0-9])", "", token)  # zeri iniziali di ogni gruppo di cifre
    keys = [token]
    if token.isdigit():
        keys += [p + token for p in sorted(set_prefixes)]
    else:
        m = re.fullmatch(r"[A-Z]{2,5}([0-9]+)", token)
        if digit_fallback and m and not set_prefixes:
            # promo: CardTrader scrive "SVP 002", la fonte ha solo "002" (set
            # senza prefissi propri). Tentativo di ripiego: per le carte
            # inglesi il controllo del nome impedisce abbinamenti sbagliati.
            keys.append(m.group(1))
    return keys


_VERSION_NUM = [
    # "Ultra Rare | 221/197", "TG01/TG30", "001/SV-P", "021/028 | s8a"
    re.compile(r"(?<![A-Za-z0-9])([A-Za-z]{0,5}\d{1,3}[a-z]?)\s*/\s*([A-Za-z0-9+\-]+)"),
    # "MEP 025", "SVP 002", "BW01", "SM01", "MEW001", "MEE 001"
    re.compile(r"(?<![A-Za-z0-9])([A-Z]{2,5})[\s\-]?(\d{1,3}[a-z]?)(?![A-Za-z0-9/])"),
    # "Holo Promo | 001"
    re.compile(r"\|\s*(\d{1,3}[a-z]?)\s*$"),
]


def parse_version(version: str | None) -> tuple[str | None, str | None]:
    """(numero, totale stampato) da blueprints.version, o (None, None)."""
    if not version:
        return None, None
    m = _VERSION_NUM[0].search(version)
    if m:
        return m.group(1), m.group(2)
    m = _VERSION_NUM[1].search(version)
    if m:
        return m.group(1) + m.group(2), None
    m = _VERSION_NUM[2].search(version)
    if m:
        return m.group(1), None
    return None, None


# ------------------------------------------------------------- artisti top --

def _title_if_shouting(s: str) -> str:
    # 'AKIRA EGAWA' -> 'Akira Egawa'; i nomi misti ('5ban Graphics', 'kawayoo',
    # 'PLANETA Mochizuki') restano come sono scritti nella fonte.
    letters = [c for c in s if c.isalpha()]
    if letters and all(c.isupper() for c in letters) and len(letters) > 4:
        return s.title()
    return s


def build_artist_resolver():
    """name_key -> nome canonico. Parte dalla lista curata (alias inclusi) e
    per tutti gli altri artisti usa la grafia piu' frequente nelle fonti."""
    cfg = json.loads(TOP_ARTISTS_PATH.read_text(encoding="utf-8")) if TOP_ARTISTS_PATH.exists() else {"artists": []}
    alias_to_canon: dict[str, str] = {}
    for a in cfg["artists"]:
        for n in [a["name"], *a.get("aliases", [])]:
            alias_to_canon[name_key(n)] = a["name"]
    return alias_to_canon


def canonical_artists(snap: dict) -> dict[str, str]:
    alias_to_canon = build_artist_resolver()
    spellings: dict[str, Counter] = defaultdict(Counter)
    for row in snap["en_cards"]:
        if row[3]:
            spellings[name_key(row[3])][row[3]] += 1
    for row in snap["ja_cards"]:
        if row[3]:
            spellings[name_key(row[3])][row[3]] += 1
    out: dict[str, str] = {}
    for k, cnt in spellings.items():
        if k in alias_to_canon:
            out[k] = alias_to_canon[k]
        else:
            # grafia piu' comune, preferendo quella non tutta maiuscola
            best = sorted(cnt.items(), key=lambda kv: (kv[0].isupper(), -kv[1]))[0][0]
            out[k] = _title_if_shouting(best)
    return out


# ------------------------------------------------------------------ incrocio --

def _en_index(snap: dict):
    by_set: dict[str, dict[str, tuple]] = defaultdict(dict)
    prefixes: dict[str, set[str]] = defaultdict(set)
    for sid, number, name, artist in snap["en_cards"]:
        key = number_keys(number, set())[0]
        by_set[sid][key] = (name, artist)
        m = re.match(r"([A-Z]+)\d", key)
        if m:
            prefixes[sid].add(m.group(1))
    return by_set, prefixes


def _ja_index(snap: dict):
    by_set: dict[str, dict[str, tuple]] = defaultdict(dict)
    for sid, number, name, artist in snap["ja_cards"]:
        if number:
            by_set[sid][number_keys(number, set())[0]] = (name, artist)
    return by_set


def candidate_sets(code: str, exp_name: str, snap: dict) -> dict[str, list[str]]:
    """Per un set CardTrader: {'en': [id set pokemon-tcg-data...], 'ja': [id TCGdex...]}.
    Inglese: codice PTCGO uguale al codice CardTrader, altrimenti stesso nome
    del set; si aggiungono i set "fratelli" (Trainer Gallery, Galarian
    Gallery, Shiny Vault: id = id del set + tg/gg/sv/c).
    Giapponese: id TCGdex uguale al codice CardTrader (maiuscole ignorate)."""
    cands: dict[str, list[str]] = {"en": [], "ja": []}
    if code in SET_OVERRIDES:
        for src, sid in SET_OVERRIDES[code]:
            cands[src].append(sid)
        return cands
    for sid, s in snap["en_sets"].items():
        if (s.get("ptcgo") or "").lower() == code.lower():
            cands["en"].append(sid)
    if not cands["en"]:
        key = name_key(exp_name)
        for sid, s in snap["en_sets"].items():
            if key and name_key(s["name"]) == key:
                cands["en"].append(sid)
    for sid in list(cands["en"]):
        for other in snap["en_sets"]:
            if other != sid and other not in cands["en"] and re.fullmatch(re.escape(sid) + r"(tg|gg|sv|c)", other):
                cands["en"].append(other)
    for sid in snap["ja_sets"]:
        if sid.lower() == code.lower():
            cands["ja"].append(sid)
    return cands


def similar_names(a: str, b: str) -> bool:
    ka, kb = name_key(a), name_key(b)
    if not ka or not kb:
        return False
    if ka == kb or ka.startswith(kb) or kb.startswith(ka):
        return True
    return difflib.SequenceMatcher(None, ka, kb).ratio() >= 0.8


def match_all(blueprints: list[dict], snap: dict):
    """blueprints: dict con id, name, version, expansion_code, expansion_name.
    Ritorna (assegnazioni {id: artista}, rapporto per set, contatori)."""
    canon = canonical_artists(snap)
    en_by_set, en_prefixes = _en_index(snap)
    ja_by_set = _ja_index(snap)

    by_exp: dict[tuple, list[dict]] = defaultdict(list)
    for bp in blueprints:
        by_exp[(bp["expansion_id"], bp["expansion_code"], bp["expansion_name"])].append(bp)

    assignments: dict[int, str] = {}
    report: list[dict] = []
    totals = Counter()

    for (_eid, code, exp_name), bps in sorted(by_exp.items(), key=lambda kv: kv[0][1] or ""):
        cands = candidate_sets(code or "", exp_name or "", snap)

        def try_lang(lang: str):
            if not cands[lang]:
                return None
            idx = en_by_set if lang == "en" else ja_by_set
            merged: dict[str, tuple] = {}
            prefixes: set[str] = set()
            for sid in cands[lang]:
                for k, v in idx.get(sid, {}).items():
                    merged.setdefault(k, v)
                if lang == "en":
                    prefixes |= en_prefixes.get(sid, set())
            hits: dict[int, str | None] = {}
            rejected = 0
            for bp in bps:
                num, _den = parse_version(bp.get("version"))
                found = None
                for k in number_keys(num, prefixes, digit_fallback=(lang == "en")):
                    if k in merged:
                        found = merged[k]
                        break
                if not found:
                    continue
                name, artist = found
                if lang == "en" and not similar_names(bp["name"] or "", name or ""):
                    rejected += 1
                    continue
                hits[bp["id"]] = artist
            return hits, rejected

        results = {lang: try_lang(lang) for lang in ("en", "ja")}
        usable = {l: r for l, r in results.items() if r is not None}
        if not usable:
            lang, hits, rejected = None, {}, 0
        else:
            lang = max(usable, key=lambda l: len(usable[l][0]))
            hits, rejected = usable[lang]

        got = 0
        no_artist = 0
        for bid, artist in hits.items():
            if not artist:
                no_artist += 1
                continue
            assignments[bid] = canon[name_key(artist)]
            got += 1
        report.append({
            "code": code, "name": exp_name, "total": len(bps), "assigned": got,
            "lang": lang, "rejected_name": rejected, "source_no_artist": no_artist,
            "candidates": cands,
        })
        totals["total"] += len(bps)
        totals["assigned"] += got
        totals["rejected_name"] += rejected
        totals["source_no_artist"] += no_artist
    return assignments, report, totals


# ---------------------------------------------------------------------- CLI --

def print_report(report: list[dict], totals: Counter):
    print(f"{'set':<10} {'lingua':<5} {'carte':>6} {'con artista':>11} {'nome diverso':>12}  nome")
    for r in report:
        flag = "" if r["lang"] else "  <-- nessuna fonte"
        print(f"{(r['code'] or '-'):<10} {(r['lang'] or '-'):<5} {r['total']:>6} {r['assigned']:>11} "
              f"{r['rejected_name']:>12}  {r['name']}{flag}")
    pct = 100 * totals["assigned"] / totals["total"] if totals["total"] else 0
    print(f"\nTOTALE: {totals['assigned']} carte su {totals['total']} con artista ({pct:.1f}%), "
          f"{totals['rejected_name']} scartate per nome diverso, "
          f"{totals['source_no_artist']} presenti nella fonte ma senza artista")


def apply_to_db(dry_run: bool):
    import db  # import tardivo: --refresh non deve richiedere psycopg2/POSTGRES_URL

    snap = load_snapshot()
    conn = db.get_connection()
    try:
        with conn.cursor() as cur:
            # Additivo e idempotente (stessa idea di db.init_db(), ma qui serve
            # prima di scrivere anche se lo schema non e' ancora stato applicato).
            cur.execute("ALTER TABLE blueprints ADD COLUMN IF NOT EXISTS artist TEXT")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_blueprint_artist ON blueprints (artist)")
            cur.execute("SELECT id, name, version, expansion_id, expansion_code, expansion_name FROM blueprints")
            cols = ["id", "name", "version", "expansion_id", "expansion_code", "expansion_name"]
            blueprints = [dict(zip(cols, row)) for row in cur.fetchall()]
        assignments, report, totals = match_all(blueprints, snap)
        print_report(report, totals)
        top = Counter(assignments.values())
        print("\nArtisti piu' presenti nel nostro catalogo:", top.most_common(15))
        if dry_run:
            conn.rollback()
            print("\n--dry-run: nessuna scrittura.")
            return
        import psycopg2.extras
        with conn.cursor() as cur:
            # Riallineamento completo ma scrivendo solo le righe che cambiano
            # (nessuna riscrittura dei ~30k blueprint ad ogni run): chi non
            # combacia piu' torna NULL, mai un artista rimasto da un incrocio
            # vecchio e poi non piu' valido.
            cur.execute(
                "UPDATE blueprints SET artist = NULL WHERE artist IS NOT NULL AND NOT (id = ANY(%s))",
                (list(assignments),),
            )
            cleared = cur.rowcount
            psycopg2.extras.execute_values(
                cur,
                "UPDATE blueprints b SET artist = v.artist FROM (VALUES %s) AS v(id, artist) "
                "WHERE b.id = v.id AND b.artist IS DISTINCT FROM v.artist",
                list(assignments.items()),
                page_size=2000,
            )
        conn.commit()
        print(f"\nblueprints.artist allineato: {len(assignments)} carte con artista ({cleared} svuotate perche' non combaciano piu').")
    finally:
        conn.close()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--refresh", action="store_true", help="riscarica le fonti e riscrive lo snapshot (non tocca il DB)")
    ap.add_argument("--only", choices=["en", "ja"], help="con --refresh: riscarica solo la parte inglese o giapponese")
    ap.add_argument("--dry-run", action="store_true", help="solo rapporto, nessuna scrittura sul DB")
    args = ap.parse_args()
    if args.refresh:
        snap = refresh_snapshot(args.only)
        save_snapshot(snap)
        print(f"Snapshot scritto: {len(snap['en_cards'])} carte EN, {len(snap['ja_cards'])} carte JA -> {SNAPSHOT_PATH}")
        return
    apply_to_db(args.dry_run)


if __name__ == "__main__":
    sys.exit(main())

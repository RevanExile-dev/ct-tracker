"""Diagnostica 4: con language=XX l'espansione e' completa? (l'unione dei
linguaggi ricostruisce esattamente il singolo blueprint?)"""
import random
import sys
import time

from api_client import CardTraderClient

URL = "https://api.cardtrader.com/api/v2/marketplace/products"
LANGS = ["it", "en", "de", "fr", "es", "jp", "kr", "pt", "zh-CN", "zh-TW", "ru", "id", "th", "nl", "pl"]


def lang_of(p):
    ph = p.get("properties_hash") or {}
    return ph.get("pokemon_language") or ph.get("mtg_language")


def main():
    c = CardTraderClient()
    random.seed(3)
    exp_id = int(sys.argv[1])
    per_lang = {}
    for lg in LANGS:
        t = time.time()
        r = c.session.get(URL, params={"expansion_id": exp_id, "language": lg}, timeout=120)
        dt = time.time() - t
        if r.status_code != 200:
            print(f"lang {lg}: HTTP {r.status_code} {r.text[:120]}")
            continue
        d = r.json()
        per_lang[lg] = d
        print(f"lang {lg}: {dt:.1f}s {len(r.content)/1048576:.1f} MB, bp {len(d)}, offerte {sum(len(v) for v in d.values())}")
        time.sleep(1)
    bids = random.sample(list(per_lang["it"]), 6) + random.sample(list(per_lang["en"]), 4)
    tot_single = tot_union = tot_common = 0
    for b in bids:
        single = c.get_marketplace_products(int(b))
        sid = {p["id"] for p in single}
        union = {}
        for lg, d in per_lang.items():
            for p in d.get(b, []):
                union[p["id"]] = p
        common = len(sid & set(union))
        wrong_lang = [p["id"] for lg, d in per_lang.items() for p in d.get(b, []) if (lang_of(p) or "").lower() != lg.lower()]
        print(f"  bp {b}: singolo {len(sid)}, unione lingue {len(union)}, in comune {common}, offerte con lingua diversa dal filtro {len(wrong_lang)}")
        tot_single += len(sid); tot_union += len(union); tot_common += common
    print(f"TOTALE singolo {tot_single}, unione {tot_union}, in comune {tot_common} ({tot_common/max(1,tot_single):.0%})")
    print("fine")


if __name__ == "__main__":
    main()

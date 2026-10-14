"""Diagnostica (sola lettura): GET /marketplace/products?expansion_id=X dà
gli stessi riassunti del singolo blueprint? Quanto costa (tempo, byte)?"""
import json
import random
import sys
import time

import db
from api_client import CardTraderClient

FIELDS = ("min_price_cents", "best_price_cents", "it_nm_zero_price_cents", "listings_count", "languages_available")


def main():
    c = CardTraderClient()
    random.seed(1)
    for exp_id in (int(x) for x in sys.argv[1:]):
        t = time.time()
        resp = c.session.get(
            "https://api.cardtrader.com/api/v2/marketplace/products",
            params={"expansion_id": exp_id}, timeout=120,
        )
        dt = time.time() - t
        print(f"expansion {exp_id}: HTTP {resp.status_code}, {dt:.1f}s, {len(resp.content)/1048576:.1f} MB, "
              f"gzip={resp.headers.get('content-encoding')}")
        if resp.status_code != 200:
            print(resp.text[:300])
            continue
        data = resp.json()
        print(f"  blueprint con offerte: {len(data)}, offerte totali {sum(len(v) for v in data.values())}")
        ids = list(data)
        sample = random.sample(ids, min(12, len(ids)))
        same, diff = 0, 0
        for bid in sample:
            single = c.get_marketplace_products(int(bid))
            a, b = db._summarize_products(data[bid]), db._summarize_products(single)
            ov = len({p["id"] for p in data[bid]} & {p["id"] for p in single}) / max(1, len({p["id"] for p in single}))
            eq = all(a[f] == b[f] for f in FIELDS) if a and b else a == b
            same += eq
            diff += not eq
            tag = "uguale" if eq else "DIVERSO"
            print(f"  bp {bid}: {tag}, offerte {len(data[bid])} vs {len(single)}, id in comune {ov:.0%}"
                  + ("" if eq else f" | exp={ {f: a[f] for f in FIELDS} } sing={ {f: b[f] for f in FIELDS} }"))
        print(f"  riassunto uguale su {same}/{same+diff}")
    print("fine")


if __name__ == "__main__":
    main()

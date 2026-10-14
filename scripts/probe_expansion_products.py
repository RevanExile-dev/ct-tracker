"""Diagnostica 7: per OGNI espansione Pokemon, quanto e' completa la risposta
per espansione rispetto alle chiamate singole (3 blueprint campione)."""
import random
import sys
import time

from api_client import CardTraderClient

URL = "https://api.cardtrader.com/api/v2/marketplace/products"


def main():
    c = CardTraderClient()
    random.seed(7)
    exps = sorted(c.get_pokemon_expansions(), key=lambda e: e["id"])
    print(f"{len(exps)} espansioni")
    print("exp_id,code,bp_resp,offers_resp,MB,sample_exp,sample_single,ratio")
    t_all = time.time()
    for e in exps:
        r = c.session.get(URL, params={"expansion_id": e["id"]}, timeout=180)
        c._marketplace_limiter.wait()
        if r.status_code != 200:
            print(f"{e['id']},{e.get('code')},HTTP{r.status_code}")
            continue
        d = r.json()
        offers = sum(len(v) for v in d.values())
        if not d:
            print(f"{e['id']},{e.get('code')},0,0,0,0,0,")
            continue
        keys = sorted(d, key=lambda k: -len(d[k]))
        sample = keys[:2] + ([random.choice(keys[2:])] if len(keys) > 2 else [])
        se = ss = 0
        for b in sample:
            single = c.get_marketplace_products(int(b))
            se += len(d[b]); ss += len(single)
        print(f"{e['id']},{e.get('code')},{len(d)},{offers},{len(r.content)/1048576:.1f},{se},{ss},{se/max(1,ss):.2f}", flush=True)
    print(f"fine in {time.time()-t_all:.0f}s")


if __name__ == "__main__":
    main()

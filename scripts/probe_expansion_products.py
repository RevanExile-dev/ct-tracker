"""Diagnostica 3: perche' l'espansione ha meno offerte del singolo blueprint?
Cache vecchia (ripetendo la chiamata dopo 2 minuti) o filtro (che offerte mancano?)."""
import collections
import random
import sys
import time

from api_client import CardTraderClient

URL = "https://api.cardtrader.com/api/v2/marketplace/products"


def ids(lst):
    return {p["id"] for p in lst}


def main():
    c = CardTraderClient()
    random.seed(2)
    exp_id = int(sys.argv[1])
    e1 = c.session.get(URL, params={"expansion_id": exp_id}, timeout=120).json()
    bids = random.sample(list(e1), 6)
    s1 = {b: c.get_marketplace_products(int(b)) for b in bids}
    print("t0: espansione e singoli presi")
    for b in bids:
        print(f"  bp {b}: exp {len(e1[b])} singolo {len(s1[b])} in comune {len(ids(e1[b]) & ids(s1[b]))}")
    # offerte mancanti nell'espansione: che classe sono?
    miss = collections.Counter()
    tot = collections.Counter()
    price_miss, price_all = [], []
    for b in bids:
        ei = ids(e1[b])
        for p in s1[b]:
            ph = p.get("properties_hash") or {}
            u = p.get("user") or {}
            keyset = (ph.get("condition"), bool(u.get("can_sell_via_hub")), u.get("on_vacation") if "on_vacation" in u else p.get("on_vacation"), p.get("graded"))
            tot[keyset] += 1
            price_all.append(p["price"]["cents"])
            if p["id"] not in ei:
                miss[keyset] += 1
                price_miss.append(p["price"]["cents"])
    print("classi (condizione, hub, vacanza, graded): mancanti/totali")
    for k, v in tot.most_common(12):
        print(f"  {k}: {miss[k]}/{v}")
    price_miss.sort(); price_all.sort()
    q = lambda a, f: a[int(len(a) * f)] if a else None
    print("prezzo offerte mancanti p10/p50/p90:", q(price_miss, .1), q(price_miss, .5), q(price_miss, .9))
    print("prezzo tutte      p10/p50/p90:", q(price_all, .1), q(price_all, .5), q(price_all, .9))
    time.sleep(120)
    e2 = c.session.get(URL, params={"expansion_id": exp_id}, timeout=120).json()
    s2 = {b: c.get_marketplace_products(int(b)) for b in bids}
    print("t+2min:")
    for b in bids:
        print(f"  bp {b}: exp1~exp2 comune {len(ids(e1[b]) & ids(e2[b]))}/{len(ids(e1[b]))}; "
              f"sing1~sing2 comune {len(ids(s1[b]) & ids(s2[b]))}/{len(ids(s1[b]))}; "
              f"exp2~sing2 comune {len(ids(e2[b]) & ids(s2[b]))} (exp2 {len(e2[b])}, sing2 {len(s2[b])})")
    print("fine")


if __name__ == "__main__":
    main()

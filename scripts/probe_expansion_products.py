"""Diagnostica 8: che regola decide quali offerte entrano nella risposta per espansione?"""
import collections
import random
import sys

from api_client import CardTraderClient

URL = "https://api.cardtrader.com/api/v2/marketplace/products"


def main():
    c = CardTraderClient()
    random.seed(11)
    exp_id = int(sys.argv[1])
    e = c.session.get(URL, params={"expansion_id": exp_id}, timeout=180).json()
    bids = random.sample(list(e), 12)  # campione UNIFORME di blueprint
    users = collections.defaultdict(lambda: [0, 0])
    mod = {m: collections.Counter() for m in (2, 3, 4, 5, 7, 10)}
    modu = {m: collections.Counter() for m in (2, 3, 4, 5, 7, 10)}
    ratios = []
    price_rank = collections.Counter()
    for b in bids:
        s = c.get_marketplace_products(int(b))
        eid = {p["id"] for p in e[b]}
        ratios.append((b, len(e[b]), len(s)))
        for rank, p in enumerate(sorted(s, key=lambda p: p["price"]["cents"])):
            pres = p["id"] in eid
            users[p["user"]["id"]][0 if pres else 1] += 1
            for m in mod:
                mod[m][(p["id"] % m, pres)] += 1
                modu[m][(p["user"]["id"] % m, pres)] += 1
            price_rank[(min(rank // 25, 8), pres)] += 1
    print("blueprint (bulk, singolo):", ratios)
    tot = len(users)
    full = sum(1 for a, b in users.values() if a and not b)
    none = sum(1 for a, b in users.values() if b and not a)
    print(f"venditori: {tot}; tutte presenti {full}; tutte assenti {none}; miste {tot - full - none}")
    for m in mod:
        print(f"offerta id%{m}:", dict(sorted(mod[m].items())))
    for m in modu:
        print(f"venditore id%{m}:", dict(sorted(modu[m].items())))
    print("posizione per prezzo (gruppi di 25), presenti/assenti:", dict(sorted(price_rank.items())))
    print("fine")


if __name__ == "__main__":
    main()

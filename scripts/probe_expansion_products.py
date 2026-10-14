"""Diagnostica 6: intestazioni, paginazione, filtri foil sull'espansione."""
import sys

from api_client import CardTraderClient

URL = "https://api.cardtrader.com/api/v2/marketplace/products"


def ids(d):
    return {p["id"] for v in d.values() for p in v}


def get(c, **params):
    r = c.session.get(URL, params=params, timeout=120)
    return r


def main():
    c = CardTraderClient()
    exp_id = int(sys.argv[1])
    base = get(c, expansion_id=exp_id)
    print("HTTP", base.status_code, "intestazioni:", {k: v for k, v in base.headers.items() if k.lower() not in ("set-cookie",)})
    d = base.json()
    print("blueprint", len(d), "offerte", len(ids(d)))
    for extra in ({"page": 2}, {"page": 1}, {"per_page": 1000}, {"limit": 100000}, {"foil": "true"}, {"foil": "false"}):
        r = get(c, expansion_id=exp_id, **extra)
        if r.status_code != 200:
            print(extra, "->", r.status_code, r.text[:100])
            continue
        x = r.json()
        a = ids(x)
        print(extra, "-> bp", len(x), "offerte", len(a), "nuove rispetto alla base", len(a - ids(d)), "MB", round(len(r.content)/1048576, 1))
    # un solo blueprint con molte offerte: quante ne da con blueprint_id, e con expansion_id+blueprint_id?
    bid = max(d, key=lambda k: len(d[k]))
    r = get(c, blueprint_id=bid)
    s = r.json()[bid]
    print("blueprint", bid, "singolo", len(s), "espansione", len(d[bid]))
    for extra in ({"blueprint_id": bid, "expansion_id": exp_id},):
        r = get(c, **extra)
        print(extra, "->", r.status_code, r.text[:150] if r.status_code != 200 else len(r.json().get(bid, [])))
    print("fine")


if __name__ == "__main__":
    main()

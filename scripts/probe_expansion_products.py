"""Diagnostica 5: che cosa distingue le offerte che l'espansione include da quelle che omette?"""
import collections
import json
import random
import sys

from api_client import CardTraderClient

URL = "https://api.cardtrader.com/api/v2/marketplace/products"


def flat(p):
    f = {}
    for k, v in (p.get("properties_hash") or {}).items():
        f["ph." + k] = v
    for k, v in (p.get("user") or {}).items():
        if k not in ("username", "id"):
            f["user." + k] = v
    f["quantity"] = p.get("quantity")
    f["graded"] = p.get("graded")
    f["on_vacation"] = p.get("on_vacation")
    f["has_desc"] = bool(p.get("description"))
    return f


def main():
    c = CardTraderClient()
    random.seed(5)
    exp_id = int(sys.argv[1])
    e = c.session.get(URL, params={"expansion_id": exp_id}, timeout=120).json()
    bids = random.sample([b for b in e if len(e[b]) > 150], 5)
    present = collections.defaultdict(collections.Counter)
    absent = collections.defaultdict(collections.Counter)
    users_exp = users_single = n_exp = n_single = 0
    ex = None
    for b in bids:
        s = c.get_marketplace_products(int(b))
        eid = {p["id"] for p in e[b]}
        users_exp += len({(p.get("user") or {}).get("id") for p in e[b]})
        users_single += len({(p.get("user") or {}).get("id") for p in s})
        n_exp += len(e[b]); n_single += len(s)
        for p in s:
            tgt = present if p["id"] in eid else absent
            for k, v in flat(p).items():
                tgt[k][str(v)] += 1
            if ex is None and p["id"] not in eid:
                ex = p
        ids_s = [p["id"] for p in s]
        print(f"  bp {b}: exp {len(e[b])} sing {len(s)}; id min/max exp {min(eid)}-{max(eid)} ; ids mancanti ordinati (primi 8): {sorted(set(ids_s)-eid)[:8]}")
    print(f"offerte exp {n_exp}, utenti distinti in exp {users_exp}; offerte singolo {n_single}, utenti distinti {users_single}")
    keys = sorted(set(present) | set(absent))
    for k in keys:
        vals = set(present[k]) | set(absent[k])
        if len(vals) > 12:
            continue
        row = ", ".join(f"{v}: {present[k][v]}/{absent[k][v]}" for v in sorted(vals))
        print(f"  {k}  (incluse/omesse)  {row}")
    print("esempio offerta omessa:", json.dumps(ex)[:700])
    print("fine")


if __name__ == "__main__":
    main()

"""Diagnostica (sola lettura): GET /marketplace/products?expansion_id=X dà
davvero le stesse offerte del singolo blueprint? Quanto costa (tempo, byte)?"""
import json
import sys
import time

from api_client import CardTraderClient


def key(p):
    return (p.get("id"), p["price"]["cents"] if isinstance(p.get("price"), dict) else p.get("price_cents"))


def main():
    c = CardTraderClient()
    for exp_id in (int(x) for x in sys.argv[1:]):
        t = time.time()
        data = c._get("/marketplace/products", params={"expansion_id": exp_id}, limiter=c._marketplace_limiter)
        dt = time.time() - t
        raw = json.dumps(data)
        print(f"expansion {exp_id}: {dt:.1f}s, {len(raw)/1024:.0f} KB, blueprint con offerte: {len(data or {})}")
        if not data:
            continue
        sizes = [len(v) for v in data.values()]
        print(f"  offerte per blueprint: min {min(sizes)}, max {max(sizes)}, totale {sum(sizes)}")
        first = next(iter(data.values()))[0]
        print("  esempio offerta, chiavi:", sorted(first.keys()))
        # confronto con la chiamata singola su 4 blueprint (due con molte offerte, due con poche)
        ids = sorted(data, key=lambda k: -len(data[k]))
        sample = ids[:2] + ids[-2:]
        for bid in sample:
            single = c.get_marketplace_products(int(bid))
            a = sorted(key(p) for p in data[bid])
            b = sorted(key(p) for p in single)
            print(f"  bp {bid}: espansione {len(a)} offerte, singola {len(b)}, uguali: {a == b}")
        # blueprint senza offerte: assenti dalla risposta?
    print("fine")


if __name__ == "__main__":
    main()

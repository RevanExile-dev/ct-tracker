"""
Diagnostica temporanea: stampa la struttura JSON grezza di un'espansione e
di alcune inserzioni marketplace, per capire quali campi sono disponibili
(es. data di uscita espansione, flag "venditore professionale/Zero").

Uso: python scripts/inspect_raw.py
"""
import json

from api_client import CardTraderClient


def main():
    client = CardTraderClient()

    expansions = client.get_pokemon_expansions()
    sample_exp = next((e for e in expansions if e.get("code") == "pre"), expansions[0])
    print("=== ESPANSIONE (pre) ===")
    print(json.dumps(sample_exp, indent=2, ensure_ascii=False))

    blueprints = client.get_blueprints(sample_exp["id"])
    singles = [b for b in blueprints if b.get("category_id") == 73]
    sample_bp = singles[0]
    print("\n=== BLUEPRINT (prima carta singola di 'pre') ===")
    print(json.dumps(sample_bp, indent=2, ensure_ascii=False))

    products = client.get_marketplace_products(sample_bp["id"])
    print(f"\n=== MARKETPLACE PRODUCTS per blueprint {sample_bp['id']} ({sample_bp.get('name')}) ===")
    print(f"Totale offerte: {len(products)}")
    if products:
        print("\n--- Prima offerta (JSON completo) ---")
        print(json.dumps(products[0], indent=2, ensure_ascii=False))
        if len(products) > 1:
            print("\n--- Seconda offerta (JSON completo) ---")
            print(json.dumps(products[1], indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()

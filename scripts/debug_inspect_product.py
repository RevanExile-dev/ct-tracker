"""
Script diagnostico usa-e-getta: stampa il JSON grezzo del primo prodotto
restituito da /marketplace/products per un blueprint_id, cosi' si puo'
vedere quali campi offre davvero CardTrader (es. conteggio vendite/feedback
del venditore, paese di spedizione) che il codice normale non legge ancora.

Uso: python scripts/debug_inspect_product.py [blueprint_id]
"""
import json
import sys

from api_client import CardTraderClient

DEFAULT_BLUEPRINT_ID = 256084  # confermato con inserzioni live oggi


def main():
    bp_id = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_BLUEPRINT_ID
    products = CardTraderClient().get_marketplace_products(bp_id)
    if not products:
        print(f"Nessun prodotto live per blueprint {bp_id}.")
        return
    print(f"--- Prodotto 1 di {len(products)} per blueprint {bp_id} ---")
    print(json.dumps(products[0], indent=2, default=str, ensure_ascii=False))


if __name__ == "__main__":
    main()

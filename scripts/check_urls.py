"""
Diagnostica temporanea: verifica quale schema di URL per la pagina prodotto
CardTrader funziona davvero (nessun campo "url" diretto nell'API), provando
alcuni pattern comuni con una richiesta HTTP reale.

Uso: python scripts/check_urls.py
"""
import requests

BLUEPRINT_ID = 315075  # Umbreon ex, Prismatic Evolutions
SLUG = "umbreon-ex-special-illustration-rare-161-131-prismatic-evolutions"

CANDIDATES = [
    f"https://www.cardtrader.com/cards/{BLUEPRINT_ID}-{SLUG}",
    f"https://www.cardtrader.com/cards/{BLUEPRINT_ID}",
    f"https://www.cardtrader.com/it/cards/{BLUEPRINT_ID}-{SLUG}",
    f"https://www.cardtrader.com/blueprints/{BLUEPRINT_ID}",
    f"https://www.cardtrader.com/it/blueprints/{BLUEPRINT_ID}",
    f"https://www.cardtrader.com/it/pokemon/blueprint/{BLUEPRINT_ID}",
    f"https://www.cardtrader.com/products/{BLUEPRINT_ID}",
    f"https://www.cardtrader.com/it/products/{BLUEPRINT_ID}",
    f"https://cardtrader.com/cards/{BLUEPRINT_ID}-{SLUG}",
]

for url in CANDIDATES:
    try:
        resp = requests.get(url, timeout=10, allow_redirects=True)
        print(f"{resp.status_code}  {url}  -> final: {resp.url}")
    except Exception as exc:
        print(f"ERRORE  {url}  -> {exc}")

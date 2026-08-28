"""
Diagnostica: stampa le categorie CardTrader per il gioco Pokemon, con il
loro id. Usato per capire quale category_id corrisponde alle carte singole
(da tracciare) e quali a prodotti sigillati/accessori (da escludere).

Uso: python scripts/list_categories.py
"""
import unicodedata

from api_client import CardTraderClient


def _normalize(name: str) -> str:
    decomposed = unicodedata.normalize("NFKD", name)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).lower()


def main():
    client = CardTraderClient()
    games = client.get_games()
    pokemon = next((g for g in games if _normalize(g["name"]) == "pokemon"), None)
    if not pokemon:
        print("Gioco 'pokemon' non trovato.")
        return

    categories = client.get_categories(game_id=pokemon["id"])
    categories.sort(key=lambda c: c.get("name", ""))
    print(f"{'ID':<8} {'NOME CATEGORIA'}")
    print("-" * 60)
    for c in categories:
        print(f"{c['id']:<8} {c.get('name')}")


if __name__ == "__main__":
    main()

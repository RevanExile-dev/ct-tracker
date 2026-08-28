"""
Stampa l'elenco di tutte le espansioni Pokemon disponibili su CardTrader,
con il loro "code" da usare in config/tracked_sets.json.

Uso: python scripts/list_expansions.py
(nel repo, di solito lanciato tramite il workflow manuale "List expansions")
"""
import unicodedata

from api_client import CardTraderClient


def _normalize(name: str) -> str:
    """Confronto senza accenti: su CardTrader il gioco si chiama "Pokémon"."""
    decomposed = unicodedata.normalize("NFKD", name)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).lower()


def main():
    client = CardTraderClient()
    games = client.get_games()
    pokemon = next((g for g in games if _normalize(g["name"]) == "pokemon"), None)
    if not pokemon:
        print("Gioco 'pokemon' non trovato tra i games disponibili:")
        for g in games:
            print(f"  - {g['name']} (id={g['id']})")
        return

    print(f"Game Pokemon trovato: id={pokemon['id']}\n")
    expansions = client.get_expansions()
    pokemon_expansions = [e for e in expansions if e.get("game_id") == pokemon["id"]]
    pokemon_expansions.sort(key=lambda e: e["name"])

    print(f"{'CODE':<15} {'NOME ESPANSIONE'}")
    print("-" * 60)
    for e in pokemon_expansions:
        print(f"{e['code']:<15} {e['name']}")

    print(f"\nTotale: {len(pokemon_expansions)} espansioni.")
    print("Copia i 'code' che ti interessano dentro config/tracked_sets.json")


if __name__ == "__main__":
    main()

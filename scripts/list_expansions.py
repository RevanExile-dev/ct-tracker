"""
Stampa l'elenco di tutte le espansioni Pokemon disponibili su CardTrader,
con il loro "code" da usare in config/tracked_sets.json.

Uso: python scripts/list_expansions.py
(nel repo, di solito lanciato tramite il workflow manuale "List expansions")
"""
from api_client import CardTraderClient


def main():
    client = CardTraderClient()
    pokemon = client.get_pokemon_game()
    if not pokemon:
        print("Gioco 'pokemon' non trovato tra i games disponibili:")
        for g in client.get_games():
            print(f"  - {g['name']} (id={g['id']})")
        return

    print(f"Game Pokemon trovato: id={pokemon['id']}\n")
    pokemon_expansions = client.get_pokemon_expansions()
    pokemon_expansions.sort(key=lambda e: e["name"])

    print(f"{'CODE':<15} {'NOME ESPANSIONE'}")
    print("-" * 60)
    for e in pokemon_expansions:
        print(f"{e['code']:<15} {e['name']}")

    print(f"\nTotale: {len(pokemon_expansions)} espansioni.")
    print("Copia i 'code' che ti interessano dentro config/tracked_sets.json")


if __name__ == "__main__":
    main()

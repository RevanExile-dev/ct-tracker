"""
Stampa il JSON grezzo di uno o piu' blueprint di un'espansione, cosi' come
lo restituisce l'API CardTrader - utile per diagnosticare discrepanze tra
quello che salviamo (es. image_url) e quello che l'API offre davvero,
senza doverselo immaginare dal codice.

Uso:
  python scripts/inspect_blueprint.py <expansion_code>                  # elenca id/nome di tutti i blueprint
  python scripts/inspect_blueprint.py <expansion_code> <blueprint_id>   # JSON completo di un blueprint
"""
import json
import sys

from api_client import CardTraderClient


def main():
    if len(sys.argv) not in (2, 3):
        print(__doc__, file=sys.stderr)
        sys.exit(2)

    expansion_code = sys.argv[1]
    blueprint_id = int(sys.argv[2]) if len(sys.argv) == 3 else None

    client = CardTraderClient()
    expansions = client.get_pokemon_expansions()
    expansion = next((e for e in expansions if e["code"] == expansion_code), None)
    if not expansion:
        print(f"Espansione '{expansion_code}' non trovata tra quelle Pokemon.", file=sys.stderr)
        sys.exit(1)

    blueprints = client.get_blueprints(expansion["id"])
    print(f"Espansione: {expansion['name']} ({expansion_code}), {len(blueprints)} blueprint totali\n")

    if blueprint_id is None:
        for bp in blueprints:
            print(f"{bp['id']:>8}  {bp.get('name')!r}  version={bp.get('version')!r}")
        return

    match = next((bp for bp in blueprints if bp["id"] == blueprint_id), None)
    if not match:
        print(f"Blueprint {blueprint_id} non trovato in {expansion_code}.", file=sys.stderr)
        sys.exit(1)

    print(json.dumps(match, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()

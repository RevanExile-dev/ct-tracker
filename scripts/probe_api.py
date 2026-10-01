"""
Chiama un endpoint arbitrario dell'API CardTrader e stampa la risposta
grezza - per esplorare endpoint non ancora usati dal tool (es. verificare
se esiste un dettaglio singolo blueprint con dati più freschi del bulk
/blueprints/export) senza dover modificare api_client.py per un test.

Uso:
  python scripts/probe_api.py <path> [chiave=valore ...]
  es: python scripts/probe_api.py /blueprints/406700
      python scripts/probe_api.py /blueprints expansion_id=4679
"""
import json
import sys

from api_client import CardTraderClient


def main():
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        sys.exit(2)

    path = sys.argv[1]
    params = dict(arg.split("=", 1) for arg in sys.argv[2:]) if len(sys.argv) > 2 else None

    client = CardTraderClient()
    print(f"GET {path} params={params}\n")
    try:
        data = client._get(path, params=params)
    except Exception as exc:
        print(f"ERRORE: {exc}", file=sys.stderr)
        sys.exit(1)

    print(json.dumps(data, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()

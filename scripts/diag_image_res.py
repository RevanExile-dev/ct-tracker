"""Diagnostico temporaneo: ispeziona i campi immagine reali restituiti da
CardTrader per un blueprint e prova varianti dell'URL per capire se esiste
una versione a risoluzione piu' alta di quella 'preview_' che salviamo oggi.
Non fa parte della pipeline, va rimosso dopo l'uso."""
import json

import requests
from api_client import CardTraderClient

client = CardTraderClient()
expansions = client.get_pokemon_expansions()
print(f"Trovate {len(expansions)} espansioni Pokemon")

exp = expansions[0]
print("Espansione di test:", exp.get("code"), exp.get("name"))

blueprints = client.get_blueprints(exp["id"])
if isinstance(blueprints, dict):
    blueprints = list(blueprints.values())

bp = next((b for b in blueprints if b.get("image_url")), None)
if not bp:
    print("Nessun blueprint con image_url trovato in questa espansione")
    raise SystemExit(0)

print("\n--- CAMPI DISPONIBILI SUL BLUEPRINT ---")
print(sorted(bp.keys()))
print("\n--- CONTENUTO COMPLETO (troncato) ---")
print(json.dumps(bp, indent=2, ensure_ascii=False)[:4000])

img = bp["image_url"]
print("\nimage_url attuale:", img)

candidates = [img]
if "preview_" in img:
    candidates.append(img.replace("preview_", ""))
    candidates.append(img.replace("/preview_", "/original_"))
    candidates.append(img.replace("/preview_", "/large_"))
    candidates.append(img.replace("/preview_", "/big_"))
    candidates.append(img.replace("/preview_", "/full_"))

print("\n--- TEST VARIANTI URL ---")
for c in candidates:
    try:
        r = requests.head(c, timeout=10, allow_redirects=True)
        size = r.headers.get("content-length", "?")
        print(f"{r.status_code}  {size:>10}  {c}")
    except Exception as e:
        print(f"ERR  {c}  ({e})")

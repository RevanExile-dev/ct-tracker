"""
Script diagnostico usa-e-getta: verifica se GitHub Models e' davvero
utilizzabile da un workflow GitHub Actions senza nessun account/chiave
separata, usando solo il GITHUB_TOKEN automatico del job (con permesso
"models: read" dichiarato nel workflow).

Uso: python scripts/debug_github_models.py [model_id]
Token via variabile d'ambiente GH_MODELS_TOKEN.
"""
import json
import os
import sys

import requests

DEFAULT_MODEL = "openai/gpt-4o-mini"
ENDPOINT = "https://models.github.ai/inference/chat/completions"


def main():
    model = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_MODEL
    token = os.environ.get("GH_MODELS_TOKEN")
    if not token:
        print("ERRORE: GH_MODELS_TOKEN mancante.", file=sys.stderr)
        sys.exit(1)

    print(f"Provo il modello: {model}")
    resp = requests.post(
        ENDPOINT,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "messages": [
                {"role": "user", "content": "Rispondi con una sola parola: funziona."}
            ],
        },
        timeout=60,
    )
    print(f"Status: {resp.status_code}")
    print("--- corpo risposta ---")
    try:
        print(json.dumps(resp.json(), indent=2, ensure_ascii=False)[:3000])
    except ValueError:
        print(resp.text[:3000])


if __name__ == "__main__":
    main()

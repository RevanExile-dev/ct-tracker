"""
Diagnostico una tantum: verifica che GROQ_API_KEY funzioni davvero e che il
modello scelto risponda, prima di integrare Groq in scripts/ai_review.py.
Non fa parte del flusso normale - va rimosso (o tenuto come riferimento)
una volta confermato che l'integrazione vera funziona.

Uso: python scripts/debug_groq.py
Richiede GROQ_API_KEY nell'ambiente.
"""
import json
import os
import sys

import requests

MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
API_URL = "https://api.groq.com/openai/v1/chat/completions"


def main():
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        print("ERRORE: GROQ_API_KEY mancante.", file=sys.stderr)
        sys.exit(1)

    resp = requests.post(
        API_URL,
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "model": MODEL,
            "messages": [
                {"role": "user", "content": "Rispondi con una sola parola: funziona."}
            ],
        },
        timeout=30,
    )
    print(f"Modello: {MODEL}")
    print(f"Status: {resp.status_code}")
    print(f"Headers rate-limit rilevanti:")
    for h in resp.headers:
        if "ratelimit" in h.lower() or "retry" in h.lower():
            print(f"  {h}: {resp.headers[h]}")
    print("--- Corpo risposta ---")
    try:
        print(json.dumps(resp.json(), indent=2, ensure_ascii=False))
    except ValueError:
        print(resp.text[:2000])

    if not resp.ok:
        sys.exit(1)


if __name__ == "__main__":
    main()

"""
Chiede una review indipendente a Gemini (livello gratuito di Google AI
Studio) su un diff git + un compito specifico. Sostituisce Codex nel ruolo
di "secondo parere" descritto in CLAUDE.md: gira dentro un workflow GitHub
Actions (.github/workflows/ai_review.yml), non in locale, cosi' e'
richiamabile da Claude indipendentemente da dove sta girando (cloud,
locale, cellulare) - a differenza di un tool CLI installato solo su un PC.

Uso: python scripts/ai_review.py "<prompt>" <base_ref> <head_ref>
La API key va passata via variabile d'ambiente GEMINI_API_KEY (nel
workflow arriva da un Secret del repository, mai nel codice/log).
"""
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError

import requests

MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.6-flash")
API_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"

# Il timeout di 'requests' e' per-lettura (si resetta ad ogni singolo byte
# ricevuto), non un tetto sul tempo totale: una risposta che arriva a
# scaglioni lenti puo' tenere la richiesta aperta molto piu' a lungo senza
# mai far scattare quel timeout (osservato: una chiamata rimasta appesa >6
# minuti in CI, cancellata a mano). REQUEST_HARD_TIMEOUT_S e' un tetto
# reale sul tempo totale, applicato eseguendo la richiesta in un thread e
# abbandonandola se non risponde in tempo.
REQUEST_HARD_TIMEOUT_S = 90

# Un diff enorme sforerebbe il contesto utile (e il livello gratuito ha
# comunque un limite di token): tagliato con un avviso invece di fallire.
MAX_DIFF_CHARS = 200_000


def _git_diff(base_ref: str, head_ref: str) -> str:
    result = subprocess.run(
        ["git", "diff", f"{base_ref}...{head_ref}"],
        check=True, capture_output=True, text=True,
    )
    diff = result.stdout
    if len(diff) > MAX_DIFF_CHARS:
        diff = diff[:MAX_DIFF_CHARS] + "\n\n[... diff troncato, superava il limite ...]"
    return diff


def main():
    if len(sys.argv) < 4:
        print("Uso: python scripts/ai_review.py \"<prompt>\" <base_ref> <head_ref>", file=sys.stderr)
        sys.exit(1)
    prompt, base_ref, head_ref = sys.argv[1], sys.argv[2], sys.argv[3]

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("ERRORE: variabile d'ambiente GEMINI_API_KEY mancante.", file=sys.stderr)
        sys.exit(1)

    diff = _git_diff(base_ref, head_ref)
    if not diff.strip():
        print(f"Nessuna differenza tra {base_ref} e {head_ref}, niente da rivedere.")
        return

    full_prompt = (
        "Agisci come reviewer indipendente di codice per un progetto personale "
        "(niente processo di PR/approvazione, chi scrive il codice e' anche chi "
        "decide se applicare i tuoi rilievi). Analizza il diff qui sotto rispetto "
        f"al compito richiesto. Compito: {prompt}\n\n"
        "Cerca bug concreti, regressioni, edge case, problemi di sicurezza, "
        "complessita' inutile, incompatibilita' con il resto del codice. Sii "
        "specifico (file/riga quando possibile) e onesto: se non trovi problemi "
        "reali dillo chiaramente invece di inventarne per forza. Rispondi in "
        f"italiano.\n\n--- DIFF ({base_ref}...{head_ref}) ---\n{diff}"
    )

    def _call():
        return requests.post(
            API_URL,
            params={"key": api_key},
            json={"contents": [{"parts": [{"text": full_prompt}]}]},
            timeout=REQUEST_HARD_TIMEOUT_S,
        )

    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(_call)
        try:
            resp = future.result(timeout=REQUEST_HARD_TIMEOUT_S)
        except FutureTimeoutError:
            print(
                f"ERRORE: nessuna risposta da Gemini entro {REQUEST_HARD_TIMEOUT_S}s "
                "(tetto sul tempo totale, non solo per-lettura). Interrotto invece di "
                "restare appeso.",
                file=sys.stderr,
            )
            sys.exit(1)

    if not resp.ok:
        print(f"ERRORE chiamata Gemini ({resp.status_code}): {resp.text[:2000]}", file=sys.stderr)
        sys.exit(1)

    data = resp.json()
    candidates = data.get("candidates") or []
    if not candidates:
        reason = data.get("promptFeedback", {}).get("blockReason", "sconosciuto")
        print(f"Nessuna risposta da Gemini (motivo: {reason}). Risposta grezza: {data}", file=sys.stderr)
        sys.exit(1)

    parts = candidates[0].get("content", {}).get("parts", [])
    text = "".join(p.get("text", "") for p in parts).strip()
    print("=== REVIEW GEMINI ===")
    print(text or "(risposta vuota)")


if __name__ == "__main__":
    main()

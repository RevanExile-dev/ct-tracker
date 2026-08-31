"""
Chiede una review indipendente (Gemini o Groq, entrambi livello gratuito)
su un diff git + un compito specifico. Sostituisce Codex nel ruolo di
"secondo parere" descritto in CLAUDE.md: gira dentro un workflow GitHub
Actions (.github/workflows/ai_review.yml), non in locale, cosi' e'
richiamabile da Claude indipendentemente da dove sta girando (cloud,
locale, cellulare) - a differenza di un tool CLI installato solo su un PC.

Uso: python scripts/ai_review.py "<prompt>" <base_ref> <head_ref> [provider]
provider e' "gemini" (default), "groq", oppure "auto" (prova tutte le
chiavi Gemini, solo se sono TUTTE esaurite passa a Groq - fallback vero
tra provider, non solo tra chiavi dello stesso).
Le API key vanno passate via variabili d'ambiente GEMINI_API_KEY/
GEMINI_API_KEY_2/... oppure GROQ_API_KEY/GROQ_API_KEY_2/... (nel workflow
arrivano da Secret del repository, mai nel codice/log). Se una chiave e'
esaurita (quota giornaliera/di rate del livello gratuito), si passa
automaticamente alla successiva invece di fallire subito - ma per Groq il
rate limit e' per organizzazione, non per chiave: piu' chiavi dello STESSO
account Groq non aumentano la quota reale, serve un account diverso.

Per review grandi si puo' impostare AI_REVIEW_PATHS con una lista di path
separati da newline o virgola: il provider ricevera' solo quella parte del
diff. Se la variabile non e' impostata il comportamento resta invariato e
viene revisionato l'intero diff (esclusi lockfile/DB generati).
"""
import math
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError

import requests

GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.6-flash")
GEMINI_API_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"

# Confermato con una chiamata reale (GET /v1/models con chiave vera): il
# catalogo Groq oggi non ha piu' modelli Llama generalisti, solo whisper
# (STT), orpheus (TTS), guard/safety, qwen3.x e la famiglia gpt-oss.
# gpt-oss-120b e' il piu' grande adatto a review di codice.
GROQ_MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"

# Il timeout di 'requests' e' per-lettura (si resetta ad ogni singolo byte
# ricevuto), non un tetto sul tempo totale: una risposta che arriva a
# scaglioni lenti puo' tenere la richiesta aperta molto piu' a lungo senza
# mai far scattare quel timeout (osservato: una chiamata rimasta appesa >6
# minuti in CI, cancellata a mano). REQUEST_HARD_TIMEOUT_S e' un tetto
# reale sul tempo totale, applicato eseguendo la richiesta in un thread e
# abbandonandola se non risponde in tempo.
REQUEST_HARD_TIMEOUT_S = 90

# 5xx/503 "high demand" e brevi 429/TPM sono condizioni temporanee del
# provider, non errori del prompt. Un paio di retry evita di perdere una
# review valida per un picco momentaneo senza trasformare il workflow in un
# loop. Per 429 aspettiamo Retry-After se presente (massimo 20 secondi).
TRANSIENT_STATUS_CODES = {500, 502, 503, 504}
TRANSIENT_RETRIES = 2

# Un diff enorme sforerebbe il contesto utile (e il livello gratuito ha
# comunque un limite di token): tagliato con un avviso invece di fallire.
MAX_DIFF_CHARS = 200_000

# File generati automaticamente: cambiano spesso per intero (es. un solo
# bump di versione riscrive migliaia di righe di lockfile) senza contenere
# nulla da revisionare, ma possono da soli superare il limite di token per
# richiesta di un provider (osservato: un diff con package-lock.json ha
# fatto fallire Groq, 81.000 token contro un limite di 8.000/minuto sul
# livello gratuito) o mangiarsi MAX_DIFF_CHARS lasciando fuori il codice
# vero. Esclusi dal diff mandato ai provider, non dal repository.
DIFF_EXCLUDE_PATHSPECS = [
    ":(exclude)**/package-lock.json",
    ":(exclude)**/yarn.lock",
    ":(exclude)**/pnpm-lock.yaml",
    ":(exclude)**/*.db",
]


def _review_pathspecs() -> list[str]:
    """Restituisce i path da includere nella review.

    AI_REVIEW_PATHS e' intenzionalmente semplice: newline o virgole. I path
    vengono passati direttamente a `git diff --`, quindi possono essere file,
    directory o pathspec Git. Senza variabile mantiene il comportamento storico
    e revisiona tutto il repository.
    """
    raw = os.environ.get("AI_REVIEW_PATHS", "").strip()
    if not raw:
        return ["."]

    paths: list[str] = []
    for line in raw.splitlines():
        for part in line.split(","):
            value = part.strip()
            if value:
                paths.append(value)
    return paths or ["."]


def _git_diff(base_ref: str, head_ref: str) -> str:
    include_paths = _review_pathspecs()
    result = subprocess.run(
        ["git", "diff", f"{base_ref}...{head_ref}", "--", *include_paths, *DIFF_EXCLUDE_PATHSPECS],
        check=True, capture_output=True, text=True,
    )
    diff = result.stdout
    if len(diff) > MAX_DIFF_CHARS:
        diff = diff[:MAX_DIFF_CHARS] + "\n\n[... diff troncato, superava il limite ...]"
    return diff


def _collect_api_keys(env_prefix: str) -> list[str]:
    """<PREFIX>_API_KEY e' obbligatoria; <PREFIX>_API_KEY_2, _3, ... sono
    chiavi di riserva opzionali (es. da un altro account), provate in
    ordine solo se quella prima finisce la quota. Si ferma al primo numero
    mancante, quindi le chiavi vanno numerate senza buchi."""
    keys = []
    primary = os.environ.get(f"{env_prefix}_API_KEY")
    if primary:
        keys.append(primary)
    i = 2
    while True:
        k = os.environ.get(f"{env_prefix}_API_KEY_{i}")
        if not k:
            break
        keys.append(k)
        i += 1
    return keys


def _is_quota_error(resp: requests.Response) -> bool:
    """429 = rate limit su entrambi i provider; Google a volte usa anche
    403 RESOURCE_EXHAUSTED per la quota giornaliera del livello gratuito.
    Altri errori (400 richiesta malformata, 404 modello sbagliato, ...)
    fallirebbero identici su qualunque chiave: non ha senso ritentare con
    la prossima."""
    if resp.status_code == 429:
        return True
    if resp.status_code == 403 and "RESOURCE_EXHAUSTED" in resp.text:
        return True
    return False


def _retry_after_seconds(resp: requests.Response, retry: int) -> int:
    """Attesa corta per rate limit temporanei. Non aspettiamo mai piu' di
    20s: quote giornaliere/di account vanno gestite dal fallback, non dormendo
    per minuti nel runner."""
    header = resp.headers.get("Retry-After")
    if header:
        try:
            return max(2, min(20, math.ceil(float(header))))
        except ValueError:
            pass
    return min(20, 8 * (retry + 1))


def _run_with_hard_timeout(label: str, call):
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(call)
        try:
            return future.result(timeout=REQUEST_HARD_TIMEOUT_S)
        except FutureTimeoutError:
            print(
                f"ERRORE: nessuna risposta da {label} entro {REQUEST_HARD_TIMEOUT_S}s "
                "(tetto sul tempo totale, non solo per-lettura). Interrotto invece di "
                "restare appeso.",
                file=sys.stderr,
            )
            sys.exit(1)


def _call_gemini(api_key: str, full_prompt: str) -> requests.Response:
    return _run_with_hard_timeout(
        "Gemini",
        lambda: requests.post(
            GEMINI_API_URL,
            params={"key": api_key},
            json={"contents": [{"parts": [{"text": full_prompt}]}]},
            timeout=REQUEST_HARD_TIMEOUT_S,
        ),
    )


def _call_groq(api_key: str, full_prompt: str) -> requests.Response:
    return _run_with_hard_timeout(
        "Groq",
        lambda: requests.post(
            GROQ_API_URL,
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": GROQ_MODEL,
                "messages": [{"role": "user", "content": full_prompt}],
            },
            timeout=REQUEST_HARD_TIMEOUT_S,
        ),
    )


def _extract_gemini_text(data: dict) -> str | None:
    candidates = data.get("candidates") or []
    if not candidates:
        return None
    parts = candidates[0].get("content", {}).get("parts", [])
    return "".join(p.get("text", "") for p in parts).strip()


def _extract_groq_text(data: dict) -> str | None:
    choices = data.get("choices") or []
    if not choices:
        return None
    return (choices[0].get("message", {}).get("content") or "").strip()


PROVIDERS = {
    "gemini": {
        "env_prefix": "GEMINI",
        "call": _call_gemini,
        "extract_text": _extract_gemini_text,
    },
    "groq": {
        "env_prefix": "GROQ",
        "call": _call_groq,
        "extract_text": _extract_groq_text,
    },
}


def main():
    if len(sys.argv) < 4:
        print(
            "Uso: python scripts/ai_review.py \"<prompt>\" <base_ref> <head_ref> [gemini|groq|auto]",
            file=sys.stderr,
        )
        sys.exit(1)
    prompt, base_ref, head_ref = sys.argv[1], sys.argv[2], sys.argv[3]
    provider_name = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] else "gemini"

    if provider_name == "auto":
        # Fallback vero tra provider, non solo tra chiavi dello stesso: prova
        # prima tutte le chiavi Gemini (il piu' "capace" dei due, da riservare
        # ai controlli che contano), solo se sono tutte esaurite passa a
        # Groq. Cosi' un controllo importante non resta mai bloccato per una
        # sola quota finita.
        attempts = [("gemini", PROVIDERS["gemini"], k) for k in _collect_api_keys("GEMINI")]
        attempts += [("groq", PROVIDERS["groq"], k) for k in _collect_api_keys("GROQ")]
        if not attempts:
            print("ERRORE: nessuna chiave disponibile (ne' GEMINI_API_KEY ne' GROQ_API_KEY).", file=sys.stderr)
            sys.exit(1)
    else:
        provider = PROVIDERS.get(provider_name)
        if provider is None:
            print(f"ERRORE: provider sconosciuto '{provider_name}' (usa 'gemini', 'groq' o 'auto').", file=sys.stderr)
            sys.exit(1)
        api_keys = _collect_api_keys(provider["env_prefix"])
        if not api_keys:
            print(f"ERRORE: variabile d'ambiente {provider['env_prefix']}_API_KEY mancante.", file=sys.stderr)
            sys.exit(1)
        attempts = [(provider_name, provider, k) for k in api_keys]

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

    resp = None
    used_provider_name = None
    for i, (attempt_provider_name, attempt_provider, api_key) in enumerate(attempts, start=1):
        used_provider_name = attempt_provider_name

        # Retry sulla STESSA chiave per indisponibilita' 5xx e brevi finestre
        # TPM 429. Se dopo i retry la quota resta bloccata, il normale fallback
        # prova la chiave/provider successivo (quando disponibile).
        for retry in range(TRANSIENT_RETRIES + 1):
            resp = attempt_provider["call"](api_key, full_prompt)
            if resp.ok:
                break

            retryable_5xx = resp.status_code in TRANSIENT_STATUS_CODES
            retryable_rate = resp.status_code == 429
            if (retryable_5xx or retryable_rate) and retry < TRANSIENT_RETRIES:
                wait_s = _retry_after_seconds(resp, retry) if retryable_rate else 4 * (retry + 1)
                reason = "rate limit temporaneo" if retryable_rate else f"errore temporaneo {resp.status_code}"
                print(
                    f"  [{reason}] {attempt_provider_name}: riprovo tra {wait_s}s "
                    f"({retry + 1}/{TRANSIENT_RETRIES})",
                    file=sys.stderr,
                )
                time.sleep(wait_s)
                continue
            break

        if resp.ok:
            break
        if _is_quota_error(resp) and i < len(attempts):
            print(
                f"  [quota esaurita] tentativo {i}/{len(attempts)} ({attempt_provider_name}) -> provo il successivo",
                file=sys.stderr,
            )
            continue
        break  # errore non di quota, o ultimo tentativo rimasto: non ha senso ritentare ancora

    if resp is None or not resp.ok:
        status = resp.status_code if resp is not None else "nessuna risposta"
        detail = resp.text[:2000] if resp is not None else ""
        print(f"ERRORE chiamata {used_provider_name} ({status}): {detail}", file=sys.stderr)
        sys.exit(1)

    data = resp.json()
    text = PROVIDERS[used_provider_name]["extract_text"](data)
    if text is None:
        print(f"Nessuna risposta da {used_provider_name}. Risposta grezza: {data}", file=sys.stderr)
        sys.exit(1)

    print(f"=== REVIEW {used_provider_name.upper()} ===")
    print(text or "(risposta vuota)")


if __name__ == "__main__":
    main()

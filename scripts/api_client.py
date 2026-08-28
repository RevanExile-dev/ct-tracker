"""
Client minimale per l'API REST ufficiale di CardTrader.
Documentazione: https://www.cardtrader.com/en/docs/api/full/reference

Il token va passato via variabile d'ambiente CARDTRADER_API_TOKEN
(nel workflow GitHub Actions arriva da un Secret del repository,
non finisce mai nel codice o nei log).
"""
import os
import time
import sys
import requests

BASE_URL = "https://api.cardtrader.com/api/v2"


class RateLimiter:
    """Limita il numero di richieste al secondo verso un endpoint."""

    def __init__(self, per_second: float):
        self.min_interval = 1.0 / per_second
        self._last_call = 0.0

    def wait(self):
        now = time.monotonic()
        elapsed = now - self._last_call
        if elapsed < self.min_interval:
            time.sleep(self.min_interval - elapsed)
        self._last_call = time.monotonic()


class CardTraderClient:
    def __init__(self, token: str | None = None):
        self.token = token or os.environ.get("CARDTRADER_API_TOKEN")
        if not self.token:
            print("ERRORE: variabile d'ambiente CARDTRADER_API_TOKEN mancante.", file=sys.stderr)
            sys.exit(1)
        self.session = requests.Session()
        self.session.headers.update({"Authorization": f"Bearer {self.token}"})
        # Endpoint generali: stiamo larghi, ben sotto i 200 req/10s globali.
        self._general_limiter = RateLimiter(per_second=4.0)
        # /marketplace/products ha un limite dedicato più stretto.
        self._marketplace_limiter = RateLimiter(per_second=1.0)

    def _get(self, path: str, params: dict | None = None, limiter: RateLimiter | None = None,
              max_retries: int = 5):
        limiter = limiter or self._general_limiter
        url = f"{BASE_URL}{path}"
        for attempt in range(1, max_retries + 1):
            limiter.wait()
            resp = self.session.get(url, params=params, timeout=30)
            if resp.status_code == 429:
                # Rate limit superato: aspetta e riprova con backoff.
                wait_s = 2 ** attempt
                print(f"  [rate limit] {path} -> attendo {wait_s}s (tentativo {attempt})", file=sys.stderr)
                time.sleep(wait_s)
                continue
            if resp.status_code >= 500:
                wait_s = 2 ** attempt
                print(f"  [errore {resp.status_code}] {path} -> riprovo tra {wait_s}s", file=sys.stderr)
                time.sleep(wait_s)
                continue
            if resp.status_code == 401:
                print("ERRORE 401: token CardTrader non valido o scaduto.", file=sys.stderr)
                sys.exit(1)
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            return resp.json()
        raise RuntimeError(f"Troppi tentativi falliti su {path}")

    @staticmethod
    def _as_list(data):
        """Alcuni endpoint CardTrader (es. /games, /categories, /expansions)
        non restituiscono direttamente un array JSON, ma un oggetto che lo
        avvolge (es. {"games": [...]}) oppure un oggetto indicizzato per id
        (es. {"1": {...}, "2": {...}}). Normalizza sempre in una lista di
        oggetti, qualunque sia la forma della risposta."""
        if not data:
            return []
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            for value in data.values():
                if isinstance(value, list):
                    return value
            return list(data.values())
        return []

    # --- Endpoint pubblici usati dal tool ---

    def get_games(self):
        return self._as_list(self._get("/games"))

    def get_categories(self, game_id: int | None = None):
        params = {"game_id": game_id} if game_id else None
        return self._as_list(self._get("/categories", params=params))

    def get_expansions(self):
        return self._as_list(self._get("/expansions"))

    def get_blueprints(self, expansion_id: int):
        data = self._get("/blueprints/export", params={"expansion_id": expansion_id})
        return data or []

    def get_marketplace_products(self, blueprint_id: int):
        """Fino alle 25 offerte più economiche per quel blueprint."""
        data = self._get(
            "/marketplace/products",
            params={"blueprint_id": blueprint_id},
            limiter=self._marketplace_limiter,
        )
        if not data:
            return []
        # La risposta è un oggetto {"<blueprint_id>": [prodotti...]}
        return data.get(str(blueprint_id), [])

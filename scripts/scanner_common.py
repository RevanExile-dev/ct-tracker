"""Logica di hashing condivisa tra lo spike M1a (scanner_m1_spike.py) e
l'indice fingerprint di produzione (build_scanner_index.py).

Deliberatamente un modulo a parte invece di duplicare il codice: full_hash e
art_hash generati qui devono restare bit-per-bit lo stesso algoritmo usato
nello spike gia' misurato (top-1 100% su distorsioni sintetiche combinando
i due hash, vedi issue #20) - se i due script divergessero anche di poco
(dimensione hash diversa, crop diverso) gli hash prodotti da un sync futuro
non sarebbero piu' confrontabili con quanto validato.

Nota sul lato client (web/lib/scanner/image.ts): il dHash lì e' calcolato
con il resize nativo del Canvas 2D (qualita' di default del browser), non
LANCZOS come qui - un'approssimazione nota, non un algoritmo diverso: dHash
confronta l'ORDINE relativo di luminosita' tra pixel adiacenti dopo il
resize, non i valori assoluti, quindi resta ragionevolmente robusto a
piccole differenze nell'algoritmo di ricampionamento. Documentato qui
perche' e' l'unico punto dove build-time e client potrebbero disallinearsi.
"""

from __future__ import annotations

import io
import time

import requests
from PIL import Image

HASH_SIZE = 8  # dHash 8x8 -> hash a 64 bit, misura di partenza piu' semplice
                # (docs/card_scanner_architecture.md sezione 8.1)
# Crop artwork approssimato: percentuali fisse sull'immagine intera della
# carta. Le immagini CardTrader sono gia' inquadrate sul bordo carta (non
# fotografie grezze), quindi un crop fisso e' un'approssimazione ragionevole
# - la sezione 8.1 del documento nota esplicitamente che un crop per
# era/layout va introdotto solo se le misure lo giustificano.
ARTWORK_BOX = (0.09, 0.10, 0.91, 0.58)  # (left, top, right, bottom) frazioni

REQUEST_TIMEOUT = 20
REQUEST_RETRIES = 3


def fetch_image(url: str) -> Image.Image:
    last_err: Exception | None = None
    for attempt in range(REQUEST_RETRIES):
        try:
            resp = requests.get(url, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            return Image.open(io.BytesIO(resp.content)).convert("RGB")
        except Exception as exc:  # rete instabile sul runner, non e' l'oggetto della misura
            last_err = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Download fallito per {url}: {last_err}")


def dhash(img: Image.Image, hash_size: int = HASH_SIZE) -> int:
    """Difference hash classico: confronta pixel adiacenti dopo resize+grayscale.

    Scelto invece di un pHash basato su DCT per restare senza dipendenze
    oltre a Pillow (sezione 23 del documento -- non aggiungere dipendenze
    prima che uno spike ne dimostri la necessita').
    """
    small = img.convert("L").resize((hash_size + 1, hash_size), Image.LANCZOS)
    pixels = list(small.getdata())
    bits = 0
    for row in range(hash_size):
        row_start = row * (hash_size + 1)
        for col in range(hash_size):
            bits <<= 1
            if pixels[row_start + col] > pixels[row_start + col + 1]:
                bits |= 1
    return bits


def dhash_hex(img: Image.Image, hash_size: int = HASH_SIZE) -> str:
    """Stessa cosa di dhash(), ma come stringa hex a lunghezza fissa - il
    formato che web/lib/scanner/catalog.ts si aspetta in scanner_index.json
    (regex /^[0-9a-f]{16}$/i per hash_size=8)."""
    hex_digits = (hash_size * hash_size + 3) // 4
    return format(dhash(img, hash_size), f"0{hex_digits}x")


def hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


def artwork_crop(img: Image.Image, box: tuple[float, float, float, float] = ARTWORK_BOX) -> Image.Image:
    w, h = img.size
    left, top, right, bottom = box
    return img.crop((int(w * left), int(h * top), int(w * right), int(h * bottom)))

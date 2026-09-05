"""Scanner M1 -- spike di sola misura, nessuna UI di produzione.

Vedi issue #20 e docs/card_scanner_architecture.md (sezioni 6, 21, 25).
Obiettivo: capire se un hash percettivo semplice (dHash) su immagine intera
+ crop artwork riesce a ritrovare il blueprint_id giusto quando la foto e'
degradata in modi che assomigliano a uno scatto reale col telefono
(rotazione, sfocatura, ricompressione JPEG, riflesso/glare, variazione
luce) -- PRIMA di costruire geometria/OCR/UI.

*** ATTENZIONE: benchmark sintetico, non foto reali. ***
Le distorsioni qui sotto sono generate applicando trasformazioni note a
partire dalla STESSA immagine di riferimento del catalogo -- non sono foto
di carte fisiche scattate con una fotocamera vera (niente riflessi di
bustina/sleeve reali, niente prospettiva da oggetto 3D fotografato, niente
variazione di sensore). Servono solo a un primo controllo di plausibilita'
dell'approccio (hash percettivo abbastanza discriminante tra migliaia di
carte simili?), non sostituiscono il corpus con foto reali richiesto da
docs/card_scanner_architecture.md sezione 21.1 per il go/no-go finale.

Deve girare in GitHub Actions: le immagini sono su cardtrader.com, il cui
accesso e' bloccato dal sandbox di sviluppo locale.
"""

from __future__ import annotations

import io
import json
import random
import sqlite3
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from PIL import Image, ImageEnhance, ImageFilter, ImageDraw

from scanner_common import HASH_SIZE, artwork_crop, dhash, fetch_image, hamming

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "cardtrader.db"
REPORT_PATH = Path(__file__).resolve().parent.parent / "scanner_m1_report.json"

RNG_SEED = 20260920  # riproducibilita' tra run


@dataclass
class Distortion:
    name: str
    apply: Callable[[Image.Image], Image.Image]


def _rotate(img: Image.Image) -> Image.Image:
    angle = random.uniform(-7, 7)
    return img.rotate(angle, resample=Image.BICUBIC, expand=False, fillcolor=(30, 30, 30))


def _blur(img: Image.Image) -> Image.Image:
    return img.filter(ImageFilter.GaussianBlur(radius=random.uniform(1.2, 2.2)))


def _jpeg_recompress(img: Image.Image) -> Image.Image:
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=random.randint(28, 42))
    buf.seek(0)
    return Image.open(buf).convert("RGB")


def _brightness_contrast(img: Image.Image) -> Image.Image:
    out = ImageEnhance.Brightness(img).enhance(random.uniform(0.75, 1.3))
    out = ImageEnhance.Contrast(out).enhance(random.uniform(0.8, 1.25))
    return out


def _glare(img: Image.Image) -> Image.Image:
    """Simula un riflesso: un'ellisse bianca semi-trasparente in un angolo."""
    out = img.convert("RGBA")
    w, h = out.size
    overlay = Image.new("RGBA", out.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    cx, cy = random.choice([(0, 0), (w, 0), (w, h), (0, h)])
    r = int(min(w, h) * random.uniform(0.35, 0.55))
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(255, 255, 255, 110))
    overlay = overlay.filter(ImageFilter.GaussianBlur(radius=r * 0.3))
    return Image.alpha_composite(out, overlay).convert("RGB")


def _worst_case(img: Image.Image) -> Image.Image:
    return _jpeg_recompress(_blur(_glare(_brightness_contrast(_rotate(img)))))


DISTORTIONS: list[Distortion] = [
    Distortion("rotate", _rotate),
    Distortion("blur", _blur),
    Distortion("jpeg_low_quality", _jpeg_recompress),
    Distortion("brightness_contrast", _brightness_contrast),
    Distortion("glare", _glare),
    Distortion("worst_case_combined", _worst_case),
]


@dataclass
class CorpusEntry:
    blueprint_id: int
    name: str
    expansion_name: str
    image_url: str
    group: str


def select_corpus(con: sqlite3.Connection) -> list[CorpusEntry]:
    """Corpus curato seguendo la matrice sperimentale della sezione 25:
    piccolo ma pensato per essere avversariale, non carte facili a caso."""
    cur = con.cursor()
    entries: list[CorpusEntry] = []

    def add(rows, group):
        for blueprint_id, name, expansion_name, image_url in rows:
            entries.append(CorpusEntry(blueprint_id, name, expansion_name, image_url, group))

    # Gruppo 1: artwork molto distintiva (Illustration Rare / Special
    # Illustration Rare -- illustrazioni ampie e uniche, sezione 25 punto 3)
    cur.execute(
        """
        SELECT id, name, expansion_name, image_url FROM blueprints
        WHERE rarity IN ('Illustration Rare', 'Special Illustration Rare')
          AND image_url IS NOT NULL
        ORDER BY RANDOM() LIMIT 10
        """
    )
    add(cur.fetchall(), "distinctive_illustration")

    # Gruppo 2: stesso nome su molti set diversi (ambiguita' reale tra
    # varianti dello stesso Pokemon, sezione 25 punto 2)
    cur.execute(
        """
        SELECT name FROM blueprints
        WHERE image_url IS NOT NULL
        GROUP BY name HAVING COUNT(DISTINCT expansion_id) >= 6
        ORDER BY RANDOM() LIMIT 5
        """
    )
    names = [r[0] for r in cur.fetchall()]
    for name in names:
        cur.execute(
            """
            SELECT id, name, expansion_name, image_url FROM blueprints
            WHERE name = ? AND image_url IS NOT NULL
            ORDER BY RANDOM() LIMIT 2
            """,
            (name,),
        )
        add(cur.fetchall(), "same_name_multi_set")

    # Gruppo 3: carte comuni/vecchio layout, testo/bordo dominano piu'
    # dell'artwork (sezione 25 punto 4)
    cur.execute(
        """
        SELECT id, name, expansion_name, image_url FROM blueprints
        WHERE rarity IN ('Common', 'Uncommon') AND image_url IS NOT NULL
        ORDER BY RANDOM() LIMIT 10
        """
    )
    add(cur.fetchall(), "common_old_layout")

    # Gruppo 4: premium/rare a caso, per varieta' residua
    cur.execute(
        """
        SELECT id, name, expansion_name, image_url FROM blueprints
        WHERE is_premium = 1 AND image_url IS NOT NULL
        ORDER BY RANDOM() LIMIT 5
        """
    )
    add(cur.fetchall(), "premium_misc")

    # Dedup per blueprint_id mantenendo il primo gruppo assegnato
    seen: set[int] = set()
    unique: list[CorpusEntry] = []
    for e in entries:
        if e.blueprint_id in seen:
            continue
        seen.add(e.blueprint_id)
        unique.append(e)
    return unique


@dataclass
class MethodTally:
    top1: int = 0
    top3: int = 0
    total: int = 0
    # margine (distanza al secondo miglior candidato - distanza al migliore)
    # per i casi corretti vs sbagliati, utile per calibrare soglie di
    # confidenza in un giro futuro con dati reali invece di inventare un
    # numero -- sezione 12.1 del documento.
    correct_margins: list[int] = field(default_factory=list)
    wrong_margins: list[int] = field(default_factory=list)
    wrong_examples: list[dict] = field(default_factory=list)

    def accuracy(self) -> dict:
        if self.total == 0:
            return {"top1": None, "top3": None, "n": 0}
        return {
            "top1": round(self.top1 / self.total, 3),
            "top3": round(self.top3 / self.total, 3),
            "n": self.total,
            "mean_margin_when_correct": (
                round(sum(self.correct_margins) / len(self.correct_margins), 2)
                if self.correct_margins else None
            ),
            "mean_margin_when_wrong": (
                round(sum(self.wrong_margins) / len(self.wrong_margins), 2)
                if self.wrong_margins else None
            ),
        }


def nearest(hash_value: int, index: dict[int, int]) -> list[tuple[int, int]]:
    """Ritorna [(blueprint_id, distanza)] ordinato per distanza crescente."""
    return sorted(((bid, hamming(hash_value, h)) for bid, h in index.items()), key=lambda x: x[1])


def rank_of(blueprint_id: int, ranked: list[tuple[int, int]]) -> int:
    for i, (bid, _dist) in enumerate(ranked):
        if bid == blueprint_id:
            return i
    return len(ranked)


def main() -> None:
    random.seed(RNG_SEED)
    con = sqlite3.connect(str(DB_PATH))
    corpus = select_corpus(con)
    con.close()

    print(f"Corpus selezionato: {len(corpus)} blueprint", file=sys.stderr)
    for e in corpus:
        print(f"  [{e.group}] {e.blueprint_id} {e.name} ({e.expansion_name})", file=sys.stderr)

    reference_images: dict[int, Image.Image] = {}
    for e in corpus:
        try:
            reference_images[e.blueprint_id] = fetch_image(e.image_url)
        except Exception as exc:
            print(f"SKIP {e.blueprint_id} ({e.name}): {exc}", file=sys.stderr)

    full_index = {bid: dhash(img) for bid, img in reference_images.items()}
    art_index = {bid: dhash(artwork_crop(img)) for bid, img in reference_images.items()}

    tallies: dict[str, MethodTally] = {
        "full_hash": MethodTally(),
        "artwork_hash": MethodTally(),
        "weighted_full_plus_artwork": MethodTally(),
    }
    by_distortion: dict[str, dict[str, MethodTally]] = {}

    entry_by_id = {e.blueprint_id: e for e in corpus}

    for bid, ref_img in reference_images.items():
        entry = entry_by_id[bid]
        for distortion in DISTORTIONS:
            try:
                distorted = distortion.apply(ref_img)
            except Exception as exc:
                print(f"Distorsione {distortion.name} fallita su {bid}: {exc}", file=sys.stderr)
                continue

            full_h = dhash(distorted)
            art_h = dhash(artwork_crop(distorted))

            ranked_full = nearest(full_h, full_index)
            ranked_art = nearest(art_h, art_index)
            # combinazione pesata: media delle distanze normalizzate sulle
            # due classifiche (stessa idea della sezione 12, senza pesi
            # arbitrari ancora calibrati)
            full_dist = {b: d for b, d in ranked_full}
            art_dist = {b: d for b, d in ranked_art}
            combined = sorted(
                ((b, full_dist.get(b, HASH_SIZE * HASH_SIZE) + art_dist.get(b, HASH_SIZE * HASH_SIZE))
                 for b in full_index),
                key=lambda x: x[1],
            )

            group_bucket = by_distortion.setdefault(
                distortion.name,
                {"full_hash": MethodTally(), "artwork_hash": MethodTally(), "weighted_full_plus_artwork": MethodTally()},
            )

            for method_name, ranked in (
                ("full_hash", ranked_full),
                ("artwork_hash", ranked_art),
                ("weighted_full_plus_artwork", combined),
            ):
                r = rank_of(bid, ranked)
                margin = (ranked[1][1] - ranked[0][1]) if len(ranked) > 1 else 0
                for tally in (tallies[method_name], group_bucket[method_name]):
                    tally.total += 1
                    if r == 0:
                        tally.top1 += 1
                        tally.correct_margins.append(margin)
                    else:
                        tally.wrong_margins.append(margin)
                        if len(tally.wrong_examples) < 5:
                            tally.wrong_examples.append({
                                "true_blueprint_id": bid,
                                "true_name": entry.name,
                                "distortion": distortion.name,
                                "predicted_blueprint_id": ranked[0][0],
                                "predicted_name": entry_by_id.get(ranked[0][0], entry).name,
                                "margin": margin,
                            })
                    if r < 3:
                        tally.top3 += 1

    report = {
        "corpus_size": len(reference_images),
        "corpus_requested": len(corpus),
        "distortions_per_card": [d.name for d in DISTORTIONS],
        "warning": "Benchmark sintetico su distorsioni della stessa immagine di riferimento, NON foto reali di carte fisiche. Vedi docstring dello script.",
        "overall": {name: t.accuracy() for name, t in tallies.items()},
        "by_distortion": {
            dist_name: {method: t.accuracy() for method, t in methods.items()}
            for dist_name, methods in by_distortion.items()
        },
        "wrong_examples": {
            name: t.wrong_examples for name, t in tallies.items() if t.wrong_examples
        },
    }

    REPORT_PATH.write_text(json.dumps(report, indent=2, ensure_ascii=False))
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()

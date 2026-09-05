import { fetchCards, getDb, type CardRow } from "@/lib/db";
import type { ScannerCandidate, ScannerCatalogEntry } from "./types";

let catalogPromise: Promise<ScannerCatalogEntry[]> | null = null;
let visualIndexPromise: Promise<Map<number, string>> | null = null;

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCatalogName(value: string) {
  // CardTrader puo' esprimere la variante sia tra parentesi sia come suffix
  // libero (es. "Blitzle (Illustration Rare)" / "Blitzle Illustration Rare").
  // Queste parole NON sono stampate nel nome della carta fisica e non devono
  // diluire il match OCR. Rimuoviamo solo qualifier di prodotto conosciuti,
  // non parole Pokemon generiche.
  const withoutParens = value.replace(/\([^)]*\)/g, " ");
  return normalize(withoutParens)
    .replace(/\b(?:special illustration rare|illustration rare|ultra rare|secret rare|full art|trainer gallery|galarian gallery|alternate art|alt art|promo)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function editDistance(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  const current = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }
  return previous[b.length];
}

function wordSimilarity(a: string, b: string) {
  const longest = Math.max(a.length, b.length, 1);
  return Math.max(0, 1 - editDistance(a, b) / longest);
}

function normalizeOcrDigits(value: string) {
  return value
    .replace(/[Oo]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/\\/g, "/");
}

export function extractCollectorNumber(text: string): string | null {
  const repaired = normalizeOcrDigits(text);
  const matches = [...repaired.matchAll(/(?:^|\D)(\d{1,4})\s*[\/-]\s*(\d{1,4})(?=\D|$)/g)];
  if (!matches.length) return null;

  // Il crop in basso puo' contenere HP/danni o anno copyright: preferiamo
  // l'ultima coppia plausibile, normalmente quella stampata accanto al set.
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const numerator = Number(matches[i][1]);
    const denominator = Number(matches[i][2]);
    if (numerator <= 9999 && denominator > 0 && denominator <= 9999) {
      return `${matches[i][1]}/${matches[i][2]}`;
    }
  }
  return null;
}

export function collectorNumberFromImageUrl(imageUrl: string | null): string | null {
  if (!imageUrl) return null;
  let filename = imageUrl.split("/").pop()?.split("?")[0] ?? "";
  try {
    filename = decodeURIComponent(filename);
  } catch {
    // Un URL malformato non deve rompere l'intero catalogo.
  }

  // I filename CardTrader delle carte Pokémon includono normalmente il
  // collector number in forma slug, es. ...-147-128-30th-celebration.jpg.
  // Il blueprint id iniziale ha 5/6 cifre e non entra in questa regex.
  const matches = [...filename.matchAll(/(?:^|-)(\d{1,4})-(\d{1,4})(?=-|\.|$)/g)];
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const numerator = Number(matches[i][1]);
    const denominator = Number(matches[i][2]);
    if (numerator <= 9999 && denominator > 0 && denominator <= 9999) {
      return `${matches[i][1]}/${matches[i][2]}`;
    }
  }
  return null;
}

function collectorParts(value: string | null) {
  if (!value) return null;
  const match = value.match(/^(\d{1,4})\/(\d{1,4})$/);
  if (!match) return null;
  return { numerator: match[1], denominator: match[2] };
}

function collectorSimilarity(observed: string | null, expected: string | null) {
  const a = collectorParts(observed);
  const b = collectorParts(expected);
  if (!a || !b) return 0;
  if (a.numerator === b.numerator && a.denominator === b.denominator) return 1;

  const numeratorDistance = editDistance(a.numerator, b.numerator);
  const denominatorDistance = editDistance(a.denominator, b.denominator);
  if (a.denominator === b.denominator && numeratorDistance === 1) return 0.68;
  if (a.numerator === b.numerator && denominatorDistance === 1) return 0.58;
  if (a.denominator === b.denominator) return 0.34;
  return 0;
}

function entryCollectorNumber(entry: ScannerCatalogEntry) {
  return (
    extractCollectorNumber(entry.version ?? "") ??
    collectorNumberFromImageUrl(entry.image_url)
  );
}

function hammingHex(a: string, b: string) {
  try {
    let value = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
    let count = 0;
    while (value) {
      count += Number(value & BigInt(1));
      value >>= BigInt(1);
    }
    return count;
  } catch {
    return 64;
  }
}

export async function loadScannerCatalog(): Promise<ScannerCatalogEntry[]> {
  if (!catalogPromise) {
    catalogPromise = (async () => {
      const db = await getDb();
      const result = db.exec(`
        SELECT id, name, version, expansion_code, expansion_name, image_url, rarity
        FROM blueprints
        WHERE name IS NOT NULL
      `)[0];
      if (!result) return [];
      const idx = Object.fromEntries(result.columns.map((column, i) => [column, i]));
      return result.values.map((row) => ({
        id: Number(row[idx.id]),
        name: String(row[idx.name] ?? ""),
        version: row[idx.version] == null ? null : String(row[idx.version]),
        expansion_code: row[idx.expansion_code] == null ? null : String(row[idx.expansion_code]),
        expansion_name: row[idx.expansion_name] == null ? null : String(row[idx.expansion_name]),
        image_url: row[idx.image_url] == null ? null : String(row[idx.image_url]),
        rarity: row[idx.rarity] == null ? null : String(row[idx.rarity]),
      }));
    })().catch((error) => {
      catalogPromise = null;
      throw error;
    });
  }
  return catalogPromise;
}

/** Optional hook per l'indice visivo. Il nuovo ranking non dipende da esso:
 * numero collezione + nome funzionano gia' con il DB attuale. */
export async function loadVisualIndex(): Promise<Map<number, string>> {
  if (!visualIndexPromise) {
    visualIndexPromise = fetch("/data/scanner_index.json", { cache: "no-cache" })
      .then(async (response) => {
        if (!response.ok) return new Map<number, string>();
        const payload = await response.json() as unknown;
        const rows = Array.isArray(payload)
          ? payload
          : typeof payload === "object" && payload && "entries" in payload
            ? (payload as { entries?: unknown }).entries
            : [];
        const map = new Map<number, string>();
        if (!Array.isArray(rows)) return map;
        for (const raw of rows) {
          if (!raw || typeof raw !== "object") continue;
          const row = raw as Record<string, unknown>;
          const id = Number(row.blueprint_id ?? row.id);
          const hash = String(row.full_hash ?? row.full_dhash ?? row.dhash ?? "");
          if (Number.isFinite(id) && /^[0-9a-f]{16}$/i.test(hash)) map.set(id, hash);
        }
        return map;
      })
      .catch(() => new Map<number, string>());
  }
  return visualIndexPromise;
}

export function rankScannerCandidates(
  text: string,
  catalog: ScannerCatalogEntry[],
  scanHash?: string | null,
  visualIndex: Map<number, string> = new Map(),
  limit = 5,
): ScannerCandidate[] {
  const normalizedText = normalize(text);
  const ocrWords = normalizedText.split(" ").filter((word) => word.length >= 2);
  const observedNumber = extractCollectorNumber(text);
  const ranked: ScannerCandidate[] = [];

  for (const entry of catalog) {
    const name = normalizeCatalogName(entry.name);
    if (!name) continue;
    const nameWords = name.split(" ").filter(Boolean);
    let nameScore = normalizedText.includes(name) ? 1 : 0;

    if (nameScore < 1) {
      let total = 0;
      for (const word of nameWords) {
        let best = 0;
        for (const observed of ocrWords) {
          if (Math.abs(word.length - observed.length) > 3) continue;
          if (word === observed) {
            best = 1;
            break;
          }
          if (word.length >= 4 && observed.length >= 4) {
            best = Math.max(best, wordSimilarity(word, observed));
          }
        }
        total += best;
      }
      nameScore = total / Math.max(1, nameWords.length);
    }

    const expectedNumber = entryCollectorNumber(entry);
    const numberScore = collectorSimilarity(observedNumber, expectedNumber);

    let visualScore = 0;
    if (scanHash && visualIndex.has(entry.id)) {
      const distance = hammingHex(scanHash, visualIndex.get(entry.id)!);
      visualScore = Math.max(0, 1 - distance / 32);
    }

    if (nameScore < 0.38 && numberScore < 0.55 && visualScore < 0.62) continue;

    const hasNumberEvidence = Boolean(observedNumber && expectedNumber);
    const hasVisual = Boolean(scanHash && visualIndex.size > 0);
    let score: number;

    if (hasNumberEvidence) {
      // Il collector number e' il miglior disambiguatore tra ristampe/variant:
      // un match esatto vale piu' di un OCR del nome perfetto da solo.
      score = nameScore * 0.34 + numberScore * 0.56 + (hasVisual ? visualScore * 0.1 : 0);
      if (numberScore === 1) {
        score = Math.max(score, 0.58 + nameScore * 0.36 + (hasVisual ? visualScore * 0.06 : 0));
      } else if (numberScore === 0) {
        // Se leggiamo chiaramente un numero diverso, non lasciamo che una
        // ristampa omonima vinca solo per il nome.
        score *= 0.34;
      }
    } else if (hasVisual) {
      score = nameScore * 0.72 + visualScore * 0.28;
    } else {
      score = nameScore;
    }

    ranked.push({ ...entry, score: Math.min(1, score), nameScore, numberScore, visualScore });
  }

  return ranked.sort((a, b) => b.score - a.score).slice(0, limit);
}

export async function hydrateScannerCard(id: number, language?: string | null): Promise<{
  card: CardRow | null;
  exactLanguagePrice: boolean;
}> {
  if (language) {
    const localized = await fetchCards({ ids: [id], languages: [language] });
    if (localized[0]) return { card: localized[0], exactLanguagePrice: true };
  }
  const fallback = await fetchCards({ ids: [id] });
  return { card: fallback[0] ?? null, exactLanguagePrice: false };
}

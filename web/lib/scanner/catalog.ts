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
  return 1 - editDistance(a, b) / longest;
}

function collectorNumber(text: string) {
  const match = text.match(/\b(\d{1,4})\s*[\/-]\s*(\d{1,4})\b/);
  return match ? `${match[1]}/${match[2]}` : null;
}

function hammingHex(a: string, b: string) {
  try {
    let value = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
    let count = 0;
    while (value) {
      count += Number(value & 1n);
      value >>= 1n;
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

/**
 * Optional hook for the M1 dHash pipeline. The UI works with OCR alone;
 * when a generated scanner_index.json becomes available, visual distance
 * automatically contributes to ranking without changing the page.
 */
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
  const number = collectorNumber(normalizedText);
  const ranked: ScannerCandidate[] = [];

  for (const entry of catalog) {
    const name = normalize(entry.name);
    if (!name) continue;
    const nameWords = name.split(" ").filter(Boolean);
    let nameScore = normalizedText.includes(name) ? 1 : 0;

    if (nameScore < 1) {
      let total = 0;
      for (const word of nameWords) {
        let best = 0;
        for (const observed of ocrWords) {
          if (Math.abs(word.length - observed.length) > 2) continue;
          if (word === observed) {
            best = 1;
            break;
          }
          if (word.length >= 4 && observed.length >= 4) best = Math.max(best, wordSimilarity(word, observed));
        }
        total += best;
      }
      nameScore = total / Math.max(1, nameWords.length);
    }

    const version = normalize(entry.version ?? "");
    const entryText = `${name} ${version}`;
    const numberScore = number && entryText.includes(number) ? 1 : 0;
    let visualScore = 0;
    if (scanHash && visualIndex.has(entry.id)) {
      const distance = hammingHex(scanHash, visualIndex.get(entry.id)!);
      visualScore = Math.max(0, 1 - distance / 32);
    }

    // Evita di materializzare migliaia di candidati palesemente irrilevanti.
    if (nameScore < 0.42 && numberScore === 0 && visualScore < 0.62) continue;
    const hasVisual = scanHash && visualIndex.size > 0;
    const score = hasVisual
      ? nameScore * 0.58 + numberScore * 0.22 + visualScore * 0.2
      : nameScore * 0.76 + numberScore * 0.24;
    ranked.push({ ...entry, score, nameScore, numberScore, visualScore });
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

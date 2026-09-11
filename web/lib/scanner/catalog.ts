import { fetchCards, type CardRow } from "@/lib/db";
import type { ScannerCatalogRow } from "@/lib/types";
import type { ScannerCandidate, ScannerCatalogEntry } from "./types";
import { collectorParts, extractCollectorNumber, stripCollectorNumbers } from "./collector-number";
export { extractCollectorNumber } from "./collector-number";

export type VisualIndexEntry = { full: string; art: string | null };
export type ScanHash = { full: string; art: string | null };

let catalogPromise: Promise<ScannerCatalogEntry[]> | null = null;
let visualIndexPromise: Promise<Map<number, VisualIndexEntry>> | null = null;

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
  // CardTrader puo' includere nel blueprint sia qualifier commerciali sia
  // il collector number. Nessuno dei due fa parte del nome stampato in alto
  // sulla carta, quindi non deve diluire il confronto con l'OCR del nome.
  const withoutParens = value.replace(/\([^)]*\)/g, " ");
  const withoutCollector = stripCollectorNumbers(withoutParens);
  return normalize(withoutCollector)
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

// ".includes(name)" grezzo dava punteggio pieno a nomi di 1-2 lettere (es.
// "N", carta reale in piu' espansioni) ogni volta che quella sequenza
// compariva DENTRO un'altra parola dell'OCR (es. "n" e' contenuto in
// "resistenza") - bug reale trovato facendo girare il test Blitzle 195/182
// di questa stessa PR: "N" (BW Black Star Promos, nessun numero estraibile)
// batteva Blitzle 195/182 (nome VERO nome esatto) perche' otteneva comunque
// nameScore=1. Richiede che il nome compaia come parola/frase intera,
// delimitata da inizio/fine stringa o spazi.
// Ricerca a confini di parola senza RegExp: rankScannerCandidates() chiama
// questa funzione una volta per ciascuna delle ~30mila carte del catalogo
// PER OGNI scansione - costruire/compilare una RegExp in ogni iterazione
// (rilievo review Gemini su PR #25) e' allocazione GC inutile ripetuta
// migliaia di volte su un dispositivo mobile. haystack e needle sono gia'
// passati da normalize()/normalizeCatalogName(), quindi i separatori di
// parola sono sempre spazi singoli - un controllo sui caratteri adiacenti
// basta, non serve un motore regex.
function containsWholeWord(haystack: string, needle: string) {
  if (!needle) return false;
  let start = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, start);
    if (idx === -1) return false;
    const before = idx === 0 ? " " : haystack[idx - 1];
    const afterIdx = idx + needle.length;
    const after = afterIdx >= haystack.length ? " " : haystack[afterIdx];
    if (before === " " && after === " ") return true;
    start = idx + 1;
  }
}

export function collectorNumberFromImageUrl(imageUrl: string | null): string | null {
  if (!imageUrl) return null;
  let filename = imageUrl.split("/").pop()?.split("?")[0] ?? "";
  try {
    filename = decodeURIComponent(filename);
  } catch {
    // Un URL malformato non deve rompere l'intero catalogo.
  }

  return extractCollectorNumber(filename);
}

function collectorSimilarity(observed: string | null, expected: string | null) {
  const a = collectorParts(observed);
  const b = collectorParts(expected);
  if (!a || !b || a.prefix !== b.prefix) return 0;
  if (a.numerator === b.numerator && a.denominator === b.denominator) return 1;

  const numeratorDistance = editDistance(a.numerator, b.numerator);
  const denominatorDistance = editDistance(a.denominator, b.denominator);
  if (a.denominator === b.denominator && numeratorDistance === 1) return 0.68;
  if (a.numerator === b.numerator && denominatorDistance === 1) return 0.58;
  if (a.denominator === b.denominator) return 0.34;
  return 0;
}

function entryCollectorNumber(entry: ScannerCatalogEntry) {
  // Alcuni blueprint CardTrader hanno version=null e/o URL immagine non
  // canonico, ma riportano il numero nel nome del prodotto. Il nome e'
  // quindi una sorgente di metadata valida prima del fallback all'URL.
  return (
    extractCollectorNumber(entry.version ?? "") ??
    extractCollectorNumber(entry.name) ??
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
      const res = await fetch("/api/scanner-catalog", { cache: "no-store" });
      if (!res.ok) throw new Error(`/api/scanner-catalog fallita (${res.status})`);
      const rows = (await res.json()) as ScannerCatalogRow[];
      return rows.map((row) => ({
        id: row.id,
        name: row.name ?? "",
        version: row.version,
        expansion_code: row.expansion_code,
        expansion_name: row.expansion_name,
        image_url: row.image_url,
        rarity: row.rarity,
      }));
    })().catch((error) => {
      catalogPromise = null;
      throw error;
    });
  }
  return catalogPromise;
}

const HASH_PATTERN = /^[0-9a-f]{16}$/i;

export async function loadVisualIndex(): Promise<Map<number, VisualIndexEntry>> {
  if (!visualIndexPromise) {
    visualIndexPromise = fetch("/data/scanner_index.json", { cache: "no-cache" })
      .then(async (response) => {
        if (!response.ok) return new Map<number, VisualIndexEntry>();
        const payload = await response.json() as unknown;
        const rows = Array.isArray(payload)
          ? payload
          : typeof payload === "object" && payload && "entries" in payload
            ? (payload as { entries?: unknown }).entries
            : [];
        const map = new Map<number, VisualIndexEntry>();
        if (!Array.isArray(rows)) return map;
        for (const raw of rows) {
          if (!raw || typeof raw !== "object") continue;
          const row = raw as Record<string, unknown>;
          const id = Number(row.blueprint_id ?? row.id);
          const full = String(row.full_hash ?? row.full_dhash ?? row.dhash ?? "");
          const artRaw = row.art_hash ?? row.art_dhash ?? null;
          const art = artRaw != null && HASH_PATTERN.test(String(artRaw)) ? String(artRaw) : null;
          if (Number.isFinite(id) && HASH_PATTERN.test(full)) map.set(id, { full, art });
        }
        return map;
      })
      .catch(() => new Map<number, VisualIndexEntry>());
  }
  return visualIndexPromise;
}

export function rankScannerCandidates(
  text: string,
  catalog: ScannerCatalogEntry[],
  scanHash?: ScanHash | null,
  visualIndex: Map<number, VisualIndexEntry> = new Map(),
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
    let nameScore = containsWholeWord(normalizedText, name) ? 1 : 0;

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
    const visualEntry = scanHash ? visualIndex.get(entry.id) : undefined;
    if (scanHash && visualEntry) {
      const fullScore = Math.max(0, 1 - hammingHex(scanHash.full, visualEntry.full) / 32);
      if (scanHash.art && visualEntry.art) {
        // L'artwork da solo e' molto piu' resistente alle differenze di
        // lingua/testo stampato rispetto alla carta intera (sezione 8.1 di
        // docs/card_scanner_architecture.md): pesa di piu' quando e'
        // disponibile su entrambi i lati (indice + foto scansionata).
        const artScore = Math.max(0, 1 - hammingHex(scanHash.art, visualEntry.art) / 32);
        visualScore = artScore * 0.62 + fullScore * 0.38;
      } else {
        visualScore = fullScore;
      }
    }

    if (nameScore < 0.38 && numberScore < 0.55 && visualScore < 0.62) continue;

    const hasNumberEvidence = Boolean(observedNumber && expectedNumber);
    const hasVisual = Boolean(scanHash && visualIndex.size > 0);
    let score: number;

    if (hasNumberEvidence) {
      score = nameScore * 0.34 + numberScore * 0.56 + (hasVisual ? visualScore * 0.1 : 0);
      if (numberScore === 1) {
        score = Math.max(score, 0.58 + nameScore * 0.36 + (hasVisual ? visualScore * 0.06 : 0));
      } else if (numberScore === 0) {
        score *= 0.34;
      }
    } else if (hasVisual) {
      // *0.92: un candidato senza alcuna evidenza sul numero di collezione
      // non deve MAI poter superare un altro candidato il cui numero e'
      // stato verificato (branch hasNumberEvidence sopra, tetto ~0.94 con
      // numberScore=1) - l'assenza di un dato non e' evidenza a favore.
      //
      // Il nome pesa MOLTO meno del visivo (0.3 contro 0.7) quando manca il
      // numero, non il contrario come nella versione precedente (0.72/0.28).
      // Caso reale che ha rivelato il problema (foto vera, Hisuian Samurott
      // V GG51/GG70): l'OCR su un font decorativo (contorno sottile, corsivo)
      // ha prodotto un nome completamente illeggibile, MA per puro rumore
      // due parole corte di una carta sbagliata ("Weakness"/"Aron") hanno
      // combaciato per intero con l'unico frammento di testo letto -
      // nameScore=1 su una carta del tutto scorrelata. L'hash visivo della
      // carta giusta era invece nettamente il piu' vicino fra tutti i
      // candidati (distanza Hamming sull'artwork 11/32, il piu' vicino fra
      // gli altri era 28/32) - un hash cosi' vicino e' molto piu' difficile
      // da ottenere per puro caso di quanto lo sia un nameScore=1 da rumore
      // OCR su nomi brevi. Con il peso 0.72/0.28 precedente la carta
      // sbagliata vinceva comunque; verificato con Hamming distance reali
      // (non supposizione) che 0.3/0.7 la ribalta con margine anche nel
      // caso peggiore (nameScore=0 per la carta giusta).
      score = (nameScore * 0.3 + visualScore * 0.7) * 0.92;
    } else {
      score = nameScore * 0.92;
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

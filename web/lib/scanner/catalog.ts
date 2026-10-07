import { fetchCards, type CardRow } from "@/lib/db";
import type { ScannerCatalogRow } from "@/lib/types";
import type { ScanEvidence, ScanVerdict, ScannerCandidate, ScannerCatalogEntry } from "./types";
import { collectorParts, extractAllCollectorNumbers, extractCollectorNumber, stripCollectorNumbers } from "./collector-number";
export { extractCollectorNumber } from "./collector-number";

let catalogPromise: Promise<ScannerCatalogEntry[]> | null = null;

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

export function entryCollectorNumber(entry: ScannerCatalogEntry) {
  // Alcuni blueprint CardTrader hanno version=null e/o URL immagine non
  // canonico, ma riportano il numero nel nome del prodotto. Il nome e'
  // quindi una sorgente di metadata valida prima del fallback all'URL.
  return (
    extractCollectorNumber(entry.version ?? "") ??
    extractCollectorNumber(entry.name) ??
    collectorNumberFromImageUrl(entry.image_url)
  );
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

type IndexedEntry = {
  entry: ScannerCatalogEntry;
  name: string;
  nameWords: string[];
  number: string | null;
  parts: ReturnType<typeof collectorParts>;
};

// Normalizzare ~30mila nomi/numeri a ogni scansione e' lavoro ripetuto: si fa
// una volta per catalogo caricato.
const indexCache = new WeakMap<ScannerCatalogEntry[], IndexedEntry[]>();

function indexCatalog(catalog: ScannerCatalogEntry[]): IndexedEntry[] {
  const cached = indexCache.get(catalog);
  if (cached) return cached;
  const indexed = catalog.map((entry) => {
    const name = normalizeCatalogName(entry.name);
    const number = entryCollectorNumber(entry);
    return { entry, name, nameWords: name.split(" ").filter(Boolean), number, parts: collectorParts(number) };
  });
  indexCache.set(catalog, indexed);
  return indexed;
}

function collectorKey(parts: NonNullable<ReturnType<typeof collectorParts>>) {
  return `${parts.prefix}${parts.numerator}/${parts.prefix}${parts.denominator}`;
}

/** Numeri di collezione presenti nel catalogo: servono all'OCR per fermarsi
 * appena legge un numero che esiste davvero, invece di fidarsi di qualunque
 * sequenza "cifre/cifre". */
export function catalogNumberKeys(catalog: ScannerCatalogEntry[]): Set<string> {
  return new Set(indexCatalog(catalog).flatMap((item) => (item.parts ? [collectorKey(item.parts)] : [])));
}

/** true se il testo contiene, come parole intere, il nome di una carta del
 * catalogo (almeno 4 lettere): la lettura del nome e' gia' utile. */
export function catalogNameChecker(catalog: ScannerCatalogEntry[]): (text: string) => boolean {
  const names = new Set(indexCatalog(catalog).map((item) => item.name).filter((name) => name.length >= 4));
  return (text) => {
    const words = normalize(text).split(" ").filter(Boolean);
    for (let size = 1; size <= 4; size += 1) {
      for (let i = 0; i + size <= words.length; i += 1) {
        if (names.has(words.slice(i, i + size).join(" "))) return true;
      }
    }
    return false;
  };
}

type NumberEvidence = {
  exact: Set<string>;
  exactParts: NonNullable<ReturnType<typeof collectorParts>>[];
  pairs: Set<string>;
  streams: string[];
};

function readNumberEvidence(text: string): NumberEvidence {
  const exactParts = extractAllCollectorNumbers(text).flatMap((value) => {
    const parts = collectorParts(value);
    return parts ? [parts] : [];
  });
  const pairs = new Set<string>();
  const streams: string[] = [];
  for (const line of text.split(/\n+/)) {
    // Tesseract legge spesso la barra come spazio o come cifra: "139 128",
    // "1397 128". Due gruppi di cifre consecutivi sulla stessa riga, separati da
    // poco, sono una coppia numero/totale plausibile.
    const groups = [...line.matchAll(/\d+/g)];
    for (let i = 0; i + 1 < groups.length; i += 1) {
      const left = groups[i];
      const right = groups[i + 1];
      const gap = right.index! - (left.index! + left[0].length);
      if (gap > 3) continue;
      const den = String(Number(right[0]));
      for (const num of new Set([left[0], left[0].length === 4 ? left[0].slice(0, 3) : left[0]])) {
        if (num.length <= 3 && right[0].length <= 3) pairs.add(`${Number(num)}/${den}`);
      }
    }
    const digits = line.replace(/\D+/g, "");
    if (digits.length >= 5) streams.push(digits);
  }
  return { exact: new Set(exactParts.map(collectorKey)), exactParts, pairs, streams };
}

function numberEvidenceScore(evidence: NumberEvidence, parts: IndexedEntry["parts"]) {
  if (!parts) return 0;
  const key = collectorKey(parts);
  if (evidence.exact.has(key)) return 1;
  if (!parts.prefix && evidence.pairs.has(key)) return 0.9;
  let best = 0;
  for (const observed of evidence.exactParts) {
    best = Math.max(best, collectorSimilarity(collectorKey(observed), key));
  }
  if (best < 0.75 && !parts.prefix && parts.numerator.length + parts.denominator.length >= 5) {
    // Sequenza di cifre con al massimo un carattere spurio al posto della barra.
    const pad3 = (v: string) => v.padStart(3, "0");
    outer: for (const n of new Set([parts.numerator, pad3(parts.numerator)])) {
      for (const d of new Set([parts.denominator, pad3(parts.denominator)])) {
        for (const stream of evidence.streams) {
          if (stream.includes(n + d) || new RegExp(`${n}\\d${d}`).test(stream)) {
            best = 0.75;
            break outer;
          }
        }
      }
    }
  }
  return best;
}

function nameEvidenceScore(normalizedText: string, ocrWords: string[], item: IndexedEntry): { score: number; matchedWords: number } {
  if (!item.name || !normalizedText) return { score: 0, matchedWords: 0 };
  if (containsWholeWord(normalizedText, item.name)) return { score: 1, matchedWords: item.nameWords.length };
  let total = 0;
  let matchedWords = 0;
  for (const word of item.nameWords) {
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
    if (best >= STRONG_NAME) matchedWords += 1;
  }
  return { score: total / Math.max(1, item.nameWords.length), matchedWords };
}

export const STRONG_NAME = 0.75;
export const STRONG_NUMBER = 0.9;

function isStrong(candidate: ScannerCandidate) {
  return candidate.nameScore >= STRONG_NAME && candidate.numberScore >= STRONG_NUMBER;
}

/**
 * Il nome si cerca SOLO nella lettura della fascia del nome e il numero SOLO in
 * quella del numero. Una stringa unica (ricerca manuale "Latios 203/191", test)
 * vale per entrambi i campi.
 */
export function rankScannerCandidates(
  input: string | ScanEvidence,
  catalog: ScannerCatalogEntry[],
  limit = 5,
): ScannerCandidate[] {
  const evidence = typeof input === "string" ? { name: input, number: input } : input;
  const normalizedName = normalize(evidence.name);
  const ocrWords = normalizedName.split(" ").filter((word) => word.length >= 2);
  const numbers = readNumberEvidence(evidence.number);
  const ranked: ScannerCandidate[] = [];

  for (const item of indexCatalog(catalog)) {
    if (!item.name) continue;
    const { score: nameScore, matchedWords } = nameEvidenceScore(normalizedName, ocrWords, item);
    const numberScore = numberEvidenceScore(numbers, item.parts);

    // Nomi di 1-2 lettere (es. "N"): basta una lettera sperduta nell'OCR per un
    // "match" a punteggio pieno. Senza un indizio sul numero sono rumore.
    if (item.name.length <= 2 && numberScore < 0.68) continue;
    if (nameScore < 0.5 && numberScore < 0.68) continue;

    let score = nameScore * 0.45 + numberScore * 0.55;
    if (nameScore >= STRONG_NAME && numberScore >= STRONG_NUMBER) score += 0.1;
    // A parita' di lettura vince il nome piu' specifico: con "Alolan Exeggutor"
    // letto, "Exeggutor" (contenuto per intero) non deve passare davanti ad
    // "Alolan Exeggutor" (due parole riconosciute su due).
    score += 0.04 * Math.min(2, Math.max(0, matchedWords - 1));
    ranked.push({ ...item.entry, score: Math.min(1, score), nameScore, numberScore });
  }

  return ranked
    .sort((a, b) => b.score - a.score || b.numberScore - a.numberScore)
    .slice(0, limit);
}

/**
 * Decide quanto fidarsi del risultato. "certain" solo se due indizi
 * indipendenti puntano alla stessa, unica carta:
 *  - numero letto + nome letto (anche solo in parte, se il numero e' esatto), oppure
 *  - nome letto + immagine nettamente piu' simile di TUTTE le carte con quel
 *    nome (e nessun numero letto che la contraddica).
 * Tutto il resto e' una proposta da confermare: meglio chiedere che sbagliare.
 *
 * `complete` = la lista contiene tutte le carte compatibili (non e' stata
 * troncata): senza, la scelta per immagine non e' ammessa, perche' la carta
 * giusta potrebbe essere rimasta fuori dal confronto.
 */
export function assessScan(candidates: ScannerCandidate[], options: { complete?: boolean } = {}): ScanVerdict {
  const top = candidates[0];
  if (!top) return "none";
  const others = candidates.slice(1);
  const visual = (candidate: ScannerCandidate) => candidate.visualScore ?? null;

  // Un'altra carta con un nome che combacia nettamente meglio e un numero
  // "vicino" (una cifra di differenza) e' il segno di un numero letto male.
  const betterNamedNeighbour = others.some(
    (candidate) => candidate.nameScore >= top.nameScore + 0.1 && candidate.numberScore >= 0.5,
  );

  const exactNumberAndName = top.numberScore === 1 && top.nameScore >= 0.5;
  if (isStrong(top) || exactNumberAndName) {
    const agrees = (candidate: ScannerCandidate) =>
      isStrong(candidate) || (candidate.numberScore === 1 && candidate.nameScore >= 0.5);
    const rival = others.some((candidate) => agrees(candidate) && candidate.score >= top.score - 0.12);
    // L'immagine puo' solo togliere certezza quando nome e numero sono gia'
    // d'accordo: se un'altra proposta somiglia nettamente di piu' alla foto
    // qualcosa non torna.
    const topVisual = visual(top);
    const bestOtherVisual = Math.max(-1, ...others.map((candidate) => visual(candidate) ?? -1));
    const visuallyContradicted = topVisual !== null && bestOtherVisual > topVisual + 0.2;
    return rival || visuallyContradicted || betterNamedNeighbour ? "probable" : "certain";
  }

  const topVisual = visual(top);
  const clearlyMostSimilar =
    topVisual !== null &&
    topVisual >= 0.6 &&
    others.every((candidate) => (visual(candidate) ?? -1) <= topVisual - 0.12);

  // Numero esatto + immagine: il nome non e' stato letto (font stilizzati delle
  // ex/V), ma l'illustrazione della carta con quel numero combacia e nessun'altra
  // carta con lo stesso numero e' rimasta fuori dal confronto.
  const sameNumber = candidates.filter((candidate) => candidate.numberScore === 1);
  if (
    options.complete &&
    top.numberScore === 1 &&
    clearlyMostSimilar &&
    sameNumber.every((candidate) => visual(candidate) !== null) &&
    !betterNamedNeighbour
  ) {
    return "certain";
  }

  const sameName = candidates.filter((candidate) => candidate.nameScore >= STRONG_NAME);
  if (
    options.complete &&
    top.nameScore >= STRONG_NAME &&
    clearlyMostSimilar &&
    // tutte le carte con quel nome sono state confrontate con la foto
    sameName.every((candidate) => visual(candidate) !== null) &&
    // un numero letto con sicurezza che non e' il suo la esclude
    !others.some((candidate) => candidate.numberScore >= STRONG_NUMBER)
  ) {
    return "certain";
  }

  // Nome e numero letti solo in parte ma entrambi compatibili con la stessa
  // carta, e l'immagine la indica nettamente: tre indizi indipendenti
  // d'accordo. Vale solo se ogni carta compatibile con entrambe le letture e'
  // stata confrontata con la foto.
  const partlyAgrees = (candidate: ScannerCandidate) => candidate.nameScore >= 0.5 && candidate.numberScore >= 0.68;
  if (
    options.complete &&
    partlyAgrees(top) &&
    clearlyMostSimilar &&
    candidates.filter(partlyAgrees).every((candidate) => visual(candidate) !== null) &&
    !betterNamedNeighbour &&
    !others.some((candidate) => candidate.numberScore >= STRONG_NUMBER && candidate.numberScore > top.numberScore)
  ) {
    return "certain";
  }

  if (top.nameScore >= 0.5 || top.numberScore >= 0.68) return "probable";
  return "none";
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

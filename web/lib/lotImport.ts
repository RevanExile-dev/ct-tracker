// Parsing (puro, nessuna dipendenza da DB/rete) di una tabella Markdown con
// le carte comprate - formato tipico esportato da un assistente AI dopo una
// sessione di shopping su CardTrader (vedi richiesta utente, issue di
// origine di questa funzionalita'): una tabella con colonne "Carta"/"Set"/
// "Prezzo pagato" e opzionalmente "Data". Usato sia dalla UI (anteprima
// prima di inviare, web/components/LotImportPanel.tsx) sia dalla route
// server (web/app/api/account/lots/import/route.ts, che aggiunge poi il
// matching contro il catalogo - separato apposta perche' quella parte
// richiede il DB e questa no).

export type ParsedImportRow = {
  rowNumber: number; // 1-based, posizione nella tabella (non il valore della colonna "#" se presente)
  name: string;
  set: string | null;
  priceCents: number | null;
  acquiredAt: string | null; // YYYY-MM-DD, o null se assente/non riconosciuta nella riga
  // Rarita'/tipo dichiarati nella riga (es. "IR", "SIR", "Promo") - colonna
  // opzionale, non presente in ogni Markdown. Nome+Set spesso non bastano a
  // scegliere un blueprint unico: il catalogo puo' avere piu' stampe della
  // stessa carta nello stesso set a rarita' diverse (caso reale riscontrato
  // dall'utente: "Primarina" in "Pitch Black" esiste sia Holo Rare sia
  // Illustration Rare) - questo campo serve a restringere ulteriormente in
  // web/lib/lotImport.server.ts, o quantomeno a mostrarlo nella UI di
  // risoluzione manuale quando anche questo non basta.
  type: string | null;
};

export type ParseLotImportResult = {
  rows: ParsedImportRow[];
  warnings: string[];
};

const HEADER_ALIASES = {
  name: ["carta", "nome", "card"],
  set: ["set", "espansione", "expansion"],
  price: ["prezzo", "price", "costo"],
  date: ["data", "date"],
  type: ["tipo", "rarità", "rarita", "rarity", "tipologia"],
} as const;

function normalizeHeaderCell(cell: string): string {
  return cell.trim().toLowerCase();
}

function findColumn(headers: string[], aliases: readonly string[]): number {
  return headers.findIndex((h) => aliases.some((alias) => h.includes(alias)));
}

function splitTableRow(line: string): string[] {
  // Una riga di tabella Markdown puo' avere o no il pipe iniziale/finale
  // ("| a | b |" o "a | b") - trim di entrambi prima dello split cosi' non
  // resta una cella vuota fantasma in testa/coda.
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  // Riga tipo "|---|---|---|" o "| :-- | --: |" - separatore tra header e
  // dati, mai una riga di contenuto reale.
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell.trim()) || cell.trim() === "");
}

/** Prezzo da una cella tipo "€3.54", "3,54 €", "12.00": rimuove tutto tranne
 * cifre/virgola/punto, poi tratta l'ULTIMO separatore incontrato come
 * decimale (coerente con sia "3,54" che "3.54") - nessun tentativo di
 * interpretare un separatore delle migliaia: i prezzi di singole carte in
 * questo contesto non arrivano mai a quattro cifre intere. */
function parsePriceCents(cell: string): number | null {
  const cleaned = cell.replace(/[^0-9.,]/g, "");
  if (!cleaned) return null;
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  const decimalSepIndex = Math.max(lastComma, lastDot);
  let normalized: string;
  if (decimalSepIndex === -1) {
    normalized = cleaned;
  } else {
    const intPart = cleaned.slice(0, decimalSepIndex).replace(/[.,]/g, "");
    const fracPart = cleaned.slice(decimalSepIndex + 1).replace(/[.,]/g, "");
    normalized = `${intPart}.${fracPart}`;
  }
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/** Accetta sia YYYY-MM-DD sia DD/MM/YYYY (i due formati piu' probabili in un
 * Markdown scritto per un utente italiano) - qualunque altra cosa torna
 * null, MAI una data indovinata a caso: il chiamante deve poter distinguere
 * "data assente" da "data scritta in un formato che non riconosco", per non
 * silenziosamente scrivere una data sbagliata. */
function parseDateCell(cell: string): string | null {
  const trimmed = cell.trim();
  if (!trimmed) return null;
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return trimmed;
  const dmyMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

/** Estrae la PRIMA tabella Markdown valida dal testo che contenga sia una
 * colonna "Carta" sia una colonna "Prezzo" (nomi riconosciuti via
 * HEADER_ALIASES, case-insensitive) - un testo con piu' tabelle o con testo
 * libero intorno (es. il resto del contesto della collezione, vedi il file
 * allegato dall'utente) usa solo quella, ignorando il resto senza errore. */
export function parseLotImportMarkdown(text: string): ParseLotImportResult {
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/);

  let headerIndex = -1;
  let nameCol = -1, setCol = -1, priceCol = -1, dateCol = -1, typeCol = -1;

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes("|")) continue;
    const cells = splitTableRow(lines[i]).map(normalizeHeaderCell);
    const candidateName = findColumn(cells, HEADER_ALIASES.name);
    const candidatePrice = findColumn(cells, HEADER_ALIASES.price);
    if (candidateName === -1 || candidatePrice === -1) continue;
    // Riga successiva deve essere il separatore "|---|---|" per essere
    // davvero un header di tabella, non solo una riga di testo che contiene
    // per coincidenza sia "carta" sia "prezzo" separati da pipe.
    const nextCells = i + 1 < lines.length ? splitTableRow(lines[i + 1]) : [];
    if (!isSeparatorRow(nextCells)) continue;
    headerIndex = i;
    nameCol = candidateName;
    setCol = findColumn(cells, HEADER_ALIASES.set);
    priceCol = candidatePrice;
    dateCol = findColumn(cells, HEADER_ALIASES.date);
    typeCol = findColumn(cells, HEADER_ALIASES.type);
    break;
  }

  if (headerIndex === -1) {
    return { rows: [], warnings: ["Nessuna tabella riconosciuta: serve una tabella Markdown con almeno una colonna \"Carta\" e una \"Prezzo\"."] };
  }

  const rows: ParsedImportRow[] = [];
  let rowNumber = 0;
  for (let i = headerIndex + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes("|")) break; // fine della tabella
    const cells = splitTableRow(line);
    if (isSeparatorRow(cells)) continue;
    if (cells.length <= Math.max(nameCol, priceCol)) continue;
    const name = cells[nameCol]?.trim();
    if (!name) continue;
    rowNumber++;
    const priceCents = parsePriceCents(cells[priceCol] ?? "");
    if (priceCents === null) {
      warnings.push(`Riga ${rowNumber} ("${name}"): prezzo non riconosciuto ("${cells[priceCol]}"), verrà importata senza costo.`);
    }
    rows.push({
      rowNumber,
      name,
      set: setCol !== -1 ? (cells[setCol]?.trim() || null) : null,
      priceCents,
      acquiredAt: dateCol !== -1 ? parseDateCell(cells[dateCol] ?? "") : null,
      type: typeCol !== -1 ? (cells[typeCol]?.trim() || null) : null,
    });
  }

  if (rows.length === 0) warnings.push("La tabella non contiene righe di dati.");
  return { rows, warnings };
}

// Sigle di rarita' STANDARD del TCG Pokemon (non nomi di set: queste non
// cambiano da un catalogo all'altro o da una lingua all'altra come "Buio
// Pesto" vs "Team Up" - "IR" e' Illustration Rare ovunque si giochi in
// italiano) - qui SOLO le abbreviazioni realmente viste nei file
// dell'utente, non un tentativo di coprire ogni rarita' mai esistita nel
// gioco: un'abbreviazione mancante semplicemente non restringe nulla, non
// e' un errore. Il valore e' il nome COMPLETO da confrontare (case
// insensitive, dopo trim) contro il campo `rarity` del blueprint.
const TYPE_ABBREVIATION_HINTS: Record<string, string> = {
  ir: "illustration rare",
  sir: "special illustration rare",
  promo: "promo",
};

/** Restringe (mai allarga) un elenco di candidati gia' ambiguo usando il
 * "Tipo" dichiarato nella riga, quando presente e riconosciuto - MAI usato
 * da solo (un Tipo senza Set che restringe mille candidati a "solo quelli
 * Illustration Rare" resterebbe comunque troppo permissivo), solo come
 * ultimo passo dopo che Nome+Set hanno gia' fatto la loro parte (vedi
 * web/lib/lotImport.server.ts, matchRow). Se il tipo non aiuta (nessuna
 * abbreviazione riconosciuta, o non narrows a un risultato diverso) torna
 * i candidati cosi' come sono - MAI un elenco vuoto che farebbe sembrare
 * la carta "non trovata" per un dato opzionale che non siamo riusciti a
 * interpretare.
 *
 * Generica su T (non sul tipo concreto BlueprintMatchCandidate, che vive
 * lato server in db.server.ts) cosi' resta testabile qui, in questo
 * modulo puro senza dipendenze da DB - vedi web/tests/lotImport.test.mjs. */
export function narrowByDeclaredType<T extends { rarity: string | null }>(candidates: T[], declaredType: string | null): T[] {
  if (!declaredType) return candidates;
  const hint = TYPE_ABBREVIATION_HINTS[declaredType.trim().toLowerCase()];
  if (!hint) return candidates;
  // Confronto ESATTO, non ".includes()": "special illustration rare".includes(
  // "illustration rare") e' true in JS, quindi un ".includes()" qui
  // avrebbe tenuto la SIR anche quando l'utente ha scritto "IR" - le due
  // rarita' sono diverse, non una sottostringa dell'altra, vanno
  // confrontate carattere per carattere (bug reale di una versione
  // precedente, trovato in review).
  const narrowed = candidates.filter((c) => (c.rarity ?? "").trim().toLowerCase() === hint);
  return narrowed.length > 0 ? narrowed : candidates;
}

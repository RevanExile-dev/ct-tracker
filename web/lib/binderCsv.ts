// Esportazione/importazione CSV del binder: solo i dati che l'utente ha
// gia' (carte possedute, quantita', lingua, condizione, finitura). Funzioni
// pure, senza rete: l'esportazione lavora su cio' che la pagina ha gia'
// caricato, l'importazione produce solo un elenco di entry da validare
// contro il catalogo prima di scriverle (vedi BinderCsvPanel).
//
// Separatore ";" e virgola decimale: e' il formato che Excel italiano apre
// al doppio clic senza procedure guidate. In lettura si accetta anche ",".

export const BINDER_CSV_HEADER = [
  "id", "carta", "versione", "set", "lingua", "condizione", "finitura", "quantita", "prezzo_unitario", "valuta", "valore_totale",
] as const;

export type BinderCsvRow = {
  id: number;
  name: string;
  version: string | null;
  setName: string;
  language: string | null;
  condition: string | null;
  finish: string;
  quantity: number;
  unitCents: number | null;
  currency: string;
};

export type ParsedBinderCsvRow = {
  rowNumber: number;
  id: number;
  language: string | null;
  condition: string | null;
  finish: "normal" | "foil" | "reverse" | "unknown";
  quantity: number;
};

export type ParseBinderCsvResult = { rows: ParsedBinderCsvRow[]; warnings: string[] };

const FINISHES = ["normal", "foil", "reverse", "unknown"] as const;
const MAX_QUANTITY = 999;
export const MAX_CSV_BYTES = 1_000_000;

function cell(value: string): string {
  // Una cella che inizia con = + - @ viene interpretata come formula da
  // Excel/Sheets: si antepone un apice, che il foglio non mostra.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function euros(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2).replace(".", ",");
}

export function buildBinderCsv(rows: BinderCsvRow[]): string {
  const lines = [BINDER_CSV_HEADER.join(";")];
  for (const row of rows) {
    lines.push([
      String(row.id), row.name, row.version ?? "", row.setName, row.language ?? "", row.condition ?? "", row.finish,
      String(row.quantity), euros(row.unitCents), row.unitCents === null ? "" : row.currency,
      euros(row.unitCents === null ? null : row.unitCents * row.quantity),
    ].map(cell).join(";"));
  }
  // BOM: senza, Excel legge le lettere accentate come UTF-8 spezzato.
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Divide il testo in righe di celle rispettando le virgolette. */
function splitCsv(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c.trim() !== "")) records.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) records.push(row);
  return records;
}

export function parseBinderCsv(input: string): ParseBinderCsvResult {
  const text = input.replace(/^﻿/, "");
  const warnings: string[] = [];
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = firstLine.split(";").length >= firstLine.split(",").length ? ";" : ",";
  const records = splitCsv(text, delimiter);
  if (records.length === 0) return { rows: [], warnings: ["Il file è vuoto."] };

  const header = records[0].map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const idCol = col("id", "blueprint_id", "blueprintid");
  if (idCol < 0) return { rows: [], warnings: ["Manca la colonna \"id\": usa un file esportato da CartaViva."] };
  const langCol = col("lingua", "language");
  const condCol = col("condizione", "condition");
  const finishCol = col("finitura", "finish");
  const qtyCol = col("quantita", "quantità", "quantity");

  const rows: ParsedBinderCsvRow[] = [];
  const seen = new Set<number>();
  records.slice(1).forEach((record, index) => {
    const rowNumber = index + 2;
    const id = Number(record[idCol]?.trim());
    if (!Number.isInteger(id) || id <= 0) { warnings.push(`Riga ${rowNumber}: id non valido, saltata.`); return; }
    if (seen.has(id)) { warnings.push(`Riga ${rowNumber}: carta ${id} già presente nel file, saltata.`); return; }
    seen.add(id);
    const quantity = qtyCol >= 0 ? Number(record[qtyCol]?.trim() || 1) : 1;
    const finishRaw = (finishCol >= 0 ? record[finishCol]?.trim().toLowerCase() : "") || "unknown";
    const finish = (FINISHES as readonly string[]).includes(finishRaw) ? (finishRaw as ParsedBinderCsvRow["finish"]) : "unknown";
    const language = (langCol >= 0 ? record[langCol]?.trim().toLowerCase().slice(0, 8) : "") || null;
    const condition = (condCol >= 0 ? record[condCol]?.trim().slice(0, 40) : "") || null;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      warnings.push(`Riga ${rowNumber}: quantità non valida, usata 1.`);
    }
    rows.push({
      rowNumber, id, language, condition, finish,
      quantity: Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_QUANTITY ? quantity : 1,
    });
  });
  return { rows, warnings };
}

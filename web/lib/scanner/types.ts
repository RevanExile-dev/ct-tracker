export type ScanRegion = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
  fallback?: boolean;
};

export type ScanQuality = {
  sharpness: number;
  glarePct: number;
  label: "good" | "soft" | "glare";
};

export type ScannerCatalogEntry = {
  id: number;
  name: string;
  version: string | null;
  expansion_code: string | null;
  expansion_name: string | null;
  image_url: string | null;
  rarity: string | null;
};

export type ScannerCandidate = ScannerCatalogEntry & {
  score: number;
  nameScore: number;
  numberScore: number;
  // Somiglianza visiva (-1..1) con la foto, se calcolata; null = non disponibile.
  visualScore?: number | null;
};

// Letture OCR separate per campo: il nome si cerca SOLO nella fascia del nome,
// il numero SOLO nelle fasce del numero. Mescolarle faceva "trovare" nomi di
// carte dentro il testo degli attacchi (es. "Energy", "Evolves from Pupitar").
export type ScanEvidence = {
  name: string;
  number: string;
};

// certain: nome e numero (o nome e immagine) concordano su una sola carta.
// probable: indizi utili ma non sufficienti, l'utente sceglie tra le proposte.
// none: nessun indizio affidabile. confirmed: scelta fatta dall'utente.
export type ScanVerdict = "certain" | "probable" | "none" | "confirmed";

export type DetectedLanguage = {
  code: string | null;
  label: string;
  confidence: number;
};

export type OcrResult = {
  text: string;
  confidence: number;
  fields?: ScanEvidence & { body: string };
};

export type ScanStatus = "queued" | "reading" | "matching" | "done" | "error";

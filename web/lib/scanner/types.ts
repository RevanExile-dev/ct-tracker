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
  visualScore: number;
};

export type DetectedLanguage = {
  code: string | null;
  label: string;
  confidence: number;
};

export type OcrResult = {
  text: string;
  confidence: number;
};

export type ScanStatus = "queued" | "reading" | "matching" | "done" | "error";

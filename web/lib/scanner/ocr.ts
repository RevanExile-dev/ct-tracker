import type { DetectedLanguage, OcrResult } from "./types";

type TesseractWorker = {
  recognize: (image: string) => Promise<{ data: { text: string; confidence: number } }>;
  setParameters?: (params: Record<string, string>) => Promise<void>;
  terminate: () => Promise<void>;
};

type TesseractApi = {
  createWorker: (langs?: string | string[]) => Promise<TesseractWorker>;
};

type CropSpec = {
  x: number;
  y: number;
  width: number;
  height: number;
  targetWidth: number;
  // Fattore massimo di contrasto adattivo; 1 = solo scala di grigi.
  contrast: number;
  // Bordo bianco (px a scala finale): Tesseract legge meglio una riga isolata
  // se attorno c'e' margine, soprattutto sulle full-art dove il testo poggia
  // sull'illustrazione.
  pad: number;
};

// worker "body": stessa passata col modello multilingua. Misurato: su alcune
// carte (es. Alolan Exeggutor 002/128) e' l'unica che legge il numero.
type FieldRead = { crop: CropSpec; psm: "6" | "7" | "11"; worker?: "body" };

// Misurato con tesseract.js 7 su carte reali (pulite e "fotografate"), il
// 2026-10-07: il crop largo in scala di grigi con margine bianco legge il nome
// in 6 casi su 7 e il numero in 6 su 7; il contrasto spinto e i modelli
// giapponese/coreano attivi sulle stesse fasce peggioravano le letture (testo
// inventato in caratteri CJK dentro il nome). Le passate successive servono
// solo come ripiego e si fermano appena il risultato e' utile.
const NAME_WIDE: CropSpec = { x: 0.035, y: 0.018, width: 0.76, height: 0.145, targetWidth: 1300, contrast: 1, pad: 24 };
// Riga piu' stretta, senza badge di stadio a sinistra e HP/tipo a destra.
const NAME_TIGHT: CropSpec = { x: 0.15, y: 0.015, width: 0.5, height: 0.09, targetWidth: 1300, contrast: 1, pad: 24 };
// Stesso crop largo col contrasto adattivo di prima: su alcune carte (testo
// chiaro su fondo chiaro) e' l'unica passata che legge.
const NAME_WIDE_CONTRAST: CropSpec = { ...NAME_WIDE, contrast: 1.55 };
// Numero collezione: in basso a SINISTRA sui layout moderni, a DESTRA su quelli
// vintage (Base Set - HGSS), quindi l'intera larghezza inferiore.
const NUMBER_WIDE: CropSpec = { x: 0.018, y: 0.8, width: 0.964, height: 0.185, targetWidth: 1400, contrast: 1, pad: 24 };
const NUMBER_WIDE_CONTRAST: CropSpec = { ...NUMBER_WIDE, contrast: 1.9 };
const NUMBER_WIDE_LEGACY: CropSpec = { ...NUMBER_WIDE, contrast: 1.9, pad: 0 };
// Meta' sinistra e destra separate: su alcune full-art la fascia intera contiene
// testo di attacchi/flavor che copre il numero. Alte apposta: il ritaglio OCR ha
// un margine extra sotto la carta (expandRegionForOcr), quindi l'ultima riga
// non e' sempre nello stesso punto.
const NUMBER_LEFT: CropSpec = { x: 0.0, y: 0.82, width: 0.52, height: 0.17, targetWidth: 1400, contrast: 1, pad: 24 };
const NUMBER_RIGHT: CropSpec = { x: 0.48, y: 0.82, width: 0.52, height: 0.17, targetWidth: 1400, contrast: 1, pad: 24 };
// Fascia testo/weakness/retreat: serve solo a riconoscere la lingua.
const BODY: CropSpec = { x: 0.025, y: 0.48, width: 0.95, height: 0.47, targetWidth: 1250, contrast: 1.35, pad: 0 };

const NAME_READS: FieldRead[] = [
  { crop: NAME_WIDE, psm: "6" },
  { crop: NAME_TIGHT, psm: "6" },
  { crop: NAME_WIDE, psm: "11" },
  { crop: NAME_WIDE_CONTRAST, psm: "6" },
];
const NUMBER_READS: FieldRead[] = [
  { crop: NUMBER_WIDE, psm: "6" },
  { crop: NUMBER_WIDE_CONTRAST, psm: "6" },
  { crop: NUMBER_WIDE_LEGACY, psm: "6", worker: "body" },
  { crop: NUMBER_WIDE, psm: "11" },
  { crop: NUMBER_RIGHT, psm: "6" },
  { crop: NUMBER_LEFT, psm: "6" },
  { crop: NUMBER_LEFT, psm: "11" },
];
// Tiene i prefissi gallery (TG/GG/SV/RC) e le confusioni O/I/L tipiche: una
// whitelist di sole cifre distruggerebbe identificativi come TG05/TG30.
const NUMBER_WHITELIST = "0123456789/TtGgSsVvRrCcOoIiLl|- ";

export type FieldCheck = {
  // true se la lettura contiene gia' un nome/numero che esiste nel catalogo:
  // le passate di ripiego su quel campo vengono saltate.
  name?: (text: string) => boolean;
  number?: (text: string) => boolean;
};

// Pin esplicito: niente "latest" non deterministico.
const TESSERACT_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js";
let loaderPromise: Promise<TesseractApi> | null = null;
// Due worker: solo inglese per nome e numero (caratteri latini e cifre), e
// multilingua per la fascia del testo, che serve a riconoscere la lingua.
let latinWorkerPromise: Promise<TesseractWorker> | null = null;
let bodyWorkerPromise: Promise<TesseractWorker> | null = null;
let recognitionTail: Promise<void> = Promise.resolve();

function loadTesseract(): Promise<TesseractApi> {
  if (loaderPromise) return loaderPromise;
  loaderPromise = new Promise<TesseractApi>((resolve, reject) => {
    const existing = (window as Window & { Tesseract?: TesseractApi }).Tesseract;
    if (existing) {
      resolve(existing);
      return;
    }
    const script = document.createElement("script");
    script.src = TESSERACT_CDN;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.dataset.cartaVivaScannerOcr = "true";
    script.onload = () => {
      const api = (window as Window & { Tesseract?: TesseractApi }).Tesseract;
      if (api) resolve(api);
      else reject(new Error("Motore OCR caricato ma non inizializzato."));
    };
    script.onerror = () => {
      script.remove();
      reject(new Error("Motore OCR non raggiungibile. Puoi comunque correggere il match manualmente."));
    };
    document.head.appendChild(script);
  }).catch((error) => {
    loaderPromise = null;
    throw error;
  });
  return loaderPromise;
}

function getLatinWorker(): Promise<TesseractWorker> {
  if (!latinWorkerPromise) {
    latinWorkerPromise = loadTesseract()
      .then((api) => api.createWorker("eng"))
      .catch((error) => {
        latinWorkerPromise = null;
        throw error;
      });
  }
  return latinWorkerPromise;
}

function getBodyWorker(): Promise<TesseractWorker> {
  if (!bodyWorkerPromise) {
    bodyWorkerPromise = (async () => {
      const api = await loadTesseract();
      try {
        return await api.createWorker(["eng", "ita", "jpn", "kor"]);
      } catch {
        return api.createWorker("eng");
      }
    })().catch((error) => {
      bodyWorkerPromise = null;
      throw error;
    });
  }
  return bodyWorkerPromise;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Impossibile preparare il crop OCR."));
    image.src = src;
  });
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function makeCrop(image: HTMLImageElement, spec: CropSpec) {
  const sx = Math.max(0, Math.round(spec.x * image.naturalWidth));
  const sy = Math.max(0, Math.round(spec.y * image.naturalHeight));
  const sw = Math.max(1, Math.min(image.naturalWidth - sx, Math.round(spec.width * image.naturalWidth)));
  const sh = Math.max(1, Math.min(image.naturalHeight - sy, Math.round(spec.height * image.naturalHeight)));
  const targetW = Math.max(sw, Math.min(spec.targetWidth, Math.round(sw * 2.4)));
  const targetH = Math.max(1, Math.round(targetW * (sh / sw)));
  const pad = spec.pad;
  const canvas = document.createElement("canvas");
  canvas.width = targetW + pad * 2;
  canvas.height = targetH + pad * 2;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas OCR non disponibile.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, sx, sy, sw, sh, pad, pad, targetW, targetH);

  // Statistiche e contrasto solo sull'area della carta, non sul margine bianco.
  const pixels = ctx.getImageData(pad, pad, targetW, targetH);
  const data = pixels.data;
  let adaptive = 1;
  let mean = 128;
  if (spec.contrast > 1) {
    let sum = 0;
    let sumSq = 0;
    let samples = 0;
    for (let i = 0; i < data.length; i += 16) {
      const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      sum += gray;
      sumSq += gray * gray;
      samples += 1;
    }
    mean = samples ? sum / samples : 128;
    const std = Math.sqrt(samples ? Math.max(0, sumSq / samples - mean * mean) : 0);
    // Fascia gia' contrastata: non esasperare il foil; testo piatto: aumentare.
    adaptive = Math.max(1, Math.min(spec.contrast, std > 62 ? 1.15 : 62 / Math.max(28, std)));
  }
  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    const value = adaptive === 1 ? clampByte(gray) : clampByte(128 + (gray - mean) * adaptive);
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }
  ctx.putImageData(pixels, pad, pad);
  return canvas.toDataURL("image/png");
}

async function runField(worker: TesseractWorker, image: string, psm: string, numeric: boolean) {
  try {
    if (worker.setParameters) {
      await worker.setParameters({
        tessedit_pageseg_mode: psm,
        // Stringa vuota = nessuna whitelist (azzera quella della passata prima).
        tessedit_char_whitelist: numeric ? NUMBER_WHITELIST : "",
        preserve_interword_spaces: "1",
      });
    }
    const result = await worker.recognize(image);
    return {
      text: result.data.text.trim(),
      confidence: Number.isFinite(result.data.confidence) ? result.data.confidence : 0,
    };
  } catch {
    return { text: "", confidence: 0 };
  }
}

async function readField(
  source: HTMLImageElement,
  reads: FieldRead[],
  numeric: boolean,
  isUseful?: (text: string) => boolean,
) {
  const texts: string[] = [];
  let confidence = 0;
  for (const read of reads) {
    let worker: TesseractWorker;
    try {
      worker = read.worker === "body" ? await getBodyWorker() : await getLatinWorker();
    } catch {
      continue;
    }
    const result = await runField(worker, makeCrop(source, read.crop), read.psm, numeric);
    if (result.text) {
      texts.push(result.text);
      confidence = Math.max(confidence, result.confidence);
    }
    if (result.text && isUseful?.(result.text)) break;
  }
  return { text: texts.join("\n"), confidence };
}

/**
 * Legge separatamente nome, numero di collezione e fascia testo. Nome e numero
 * restano in `fields` distinti: il match li usa ciascuno solo per il proprio
 * scopo, e "certo" significa che concordano tra loro.
 */
export function recognizeText(image: string, check: FieldCheck = {}): Promise<OcrResult> {
  const job = recognitionTail.then(async () => {
    const source = await loadImage(image);
    // Fallisce subito (e con il messaggio giusto) se il motore non si carica.
    await getLatinWorker();
    const name = await readField(source, NAME_READS, false, check.name);
    const number = await readField(source, NUMBER_READS, true, check.number);
    let body = { text: "", confidence: 0 };
    try {
      body = await runField(await getBodyWorker(), makeCrop(source, BODY), "6", false);
    } catch {
      // La lingua e' un di piu': senza, il match di nome e numero resta valido.
    }

    return {
      text: [name.text, number.text, body.text].filter(Boolean).join("\n"),
      confidence: name.confidence * 0.5 + number.confidence * 0.32 + body.confidence * 0.18,
      fields: { name: name.text, number: number.text, body: body.text },
    };
  });
  recognitionTail = job.then(() => undefined, () => undefined);
  return job;
}

export async function terminateOcr(): Promise<void> {
  await recognitionTail.catch(() => undefined);
  const pending = [latinWorkerPromise, bodyWorkerPromise];
  latinWorkerPromise = null;
  bodyWorkerPromise = null;
  await Promise.all(pending.map(async (promise) => {
    if (!promise) return;
    try {
      await (await promise).terminate();
    } catch {
      // Cleanup best-effort: non deve trasformare una navigazione in errore UI.
    }
  }));
}

const LANGUAGE_RULES: Array<{ code: string; label: string; words: string[] }> = [
  { code: "it", label: "Italiano", words: ["debolezza", "resistenza", "ritirata", "danno", "avversario", "pokemon", "carta"] },
  { code: "en", label: "English", words: ["weakness", "resistance", "retreat", "damage", "opponent", "during", "pokemon"] },
  { code: "fr", label: "Français", words: ["faiblesse", "resistance", "retraite", "degats", "adversaire", "pendant"] },
  { code: "de", label: "Deutsch", words: ["schwache", "resistenz", "ruckzug", "schaden", "gegner", "wahrend"] },
  { code: "es", label: "Español", words: ["debilidad", "resistencia", "retirada", "dano", "rival", "durante"] },
  { code: "pt", label: "Português", words: ["fraqueza", "resistencia", "recuo", "dano", "oponente", "durante"] },
];

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function detectLanguage(text: string): DetectedLanguage {
  // Il modello giapponese/coreano "vede" qualche carattere CJK anche nel
  // rumore di una carta inglese (es. "い", "上" tra le righe di una full-art):
  // un solo carattere bastava a segnare la carta come giapponese, con prezzo
  // della lingua sbagliata. Serve una quantita' reale di testo CJK, prevalente
  // sulle lettere latine.
  const latinLetters = (text.match(/[A-Za-z]/g) ?? []).length;
  const japanese = (text.match(/[\u3040-\u30fb\u3400-\u9fff]/gu) ?? []).length;
  const korean = (text.match(/[\uac00-\ud7af]/gu) ?? []).length;
  if (japanese >= 8 && japanese >= latinLetters * 0.5) {
    return { code: "jp", label: "日本語", confidence: 0.95 };
  }
  if (korean >= 8 && korean >= latinLetters * 0.5) {
    return { code: "ko", label: "한국어", confidence: 0.95 };
  }

  const normalized = normalize(text);
  let best: { code: string; label: string; hits: number } | null = null;
  for (const language of LANGUAGE_RULES) {
    const hits = language.words.reduce((total, word) => total + (normalized.includes(word) ? 1 : 0), 0);
    if (!best || hits > best.hits) best = { code: language.code, label: language.label, hits };
  }
  if (!best || best.hits === 0) return { code: null, label: "Lingua incerta", confidence: 0 };
  return {
    code: best.code,
    label: best.label,
    confidence: Math.min(0.96, 0.52 + best.hits * 0.12),
  };
}

export function ocrEngineNotice() {
  return "OCR locale a zone: nome, numero e lingua vengono letti separatamente nel browser. La foto non viene inviata a CartaViva.";
}

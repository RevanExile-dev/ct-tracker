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
  contrast: number;
};

const OCR_CROPS: Record<"name" | "number" | "body", CropSpec> = {
  // I nomi Pokémon sono quasi sempre nella fascia alta; isolandola evitiamo
  // che foil, illustrazione e testo degli attacchi competano con una singola
  // riga che e' il segnale piu' utile per l'identita'.
  name: { x: 0.035, y: 0.018, width: 0.76, height: 0.145, targetWidth: 1100, contrast: 1.55 },
  // Numero collezione: in basso a sinistra sui layout moderni. Il crop e'
  // volutamente largo per includere anche set code/simboli: Tesseract ha piu'
  // contesto per separare caratteri piccoli e riflessi olografici.
  number: { x: 0.018, y: 0.825, width: 0.58, height: 0.165, targetWidth: 1150, contrast: 1.9 },
  // Fascia testo/weakness/retreat: serve soprattutto alla lingua; non deve
  // dominare il match del nome.
  body: { x: 0.025, y: 0.48, width: 0.95, height: 0.47, targetWidth: 1250, contrast: 1.35 },
};

// Pin esplicito: niente "latest" non deterministico.
const TESSERACT_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js";
let loaderPromise: Promise<TesseractApi> | null = null;
let workerPromise: Promise<TesseractWorker> | null = null;
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

async function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const api = await loadTesseract();
      try {
        // Un solo worker riutilizzato: i tre crop sono piccoli e serializzati,
        // quindi la precisione aumenta senza moltiplicare la RAM su mobile.
        return await api.createWorker(["eng", "ita", "jpn", "kor"]);
      } catch {
        return api.createWorker("eng");
      }
    })().catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
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
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas OCR non disponibile.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, targetW, targetH);

  const pixels = ctx.getImageData(0, 0, targetW, targetH);
  const data = pixels.data;
  let sum = 0;
  let sumSq = 0;
  let samples = 0;
  for (let i = 0; i < data.length; i += 16) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    sum += gray;
    sumSq += gray * gray;
    samples += 1;
  }
  const mean = samples ? sum / samples : 128;
  const variance = samples ? Math.max(0, sumSq / samples - mean * mean) : 0;
  const std = Math.sqrt(variance);
  // Se la fascia e' gia' molto contrastata evitiamo di esasperare il foil;
  // su testo piatto/sbiadito aumentiamo invece il contrasto locale.
  const adaptive = Math.max(1, Math.min(spec.contrast, std > 62 ? 1.15 : 62 / Math.max(28, std)));

  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    const value = clampByte(128 + (gray - mean) * adaptive);
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas.toDataURL("image/png");
}

async function prepareOcrCrops(image: string) {
  const source = await loadImage(image);
  return {
    name: makeCrop(source, OCR_CROPS.name),
    number: makeCrop(source, OCR_CROPS.number),
    body: makeCrop(source, OCR_CROPS.body),
  };
}

async function runField(
  worker: TesseractWorker,
  image: string,
  pageSegMode: "6" | "7",
  numeric = false,
): Promise<OcrResult> {
  if (worker.setParameters) {
    await worker.setParameters({
      tessedit_pageseg_mode: pageSegMode,
      // Empty string resets a previous whitelist. For the tiny collector crop
      // allowing O/I/L as well as digits makes our normalizer able to repair
      // common 0/1 OCR confusions instead of deleting the character entirely.
      tessedit_char_whitelist: numeric ? "0123456789/OoIiLl|- " : "",
      preserve_interword_spaces: "1",
    });
  }
  const result = await worker.recognize(image);
  return {
    text: result.data.text.trim(),
    confidence: Number.isFinite(result.data.confidence) ? result.data.confidence : 0,
  };
}

/**
 * API invariata per ScannerStudio, ma internamente non facciamo piu' OCR
 * sull'intera carta in un colpo solo. Nome, collector number e fascia lingua
 * vengono letti separatamente con layout Tesseract appropriato e poi uniti.
 * Questo e' molto piu' robusto su full-art/foil e riflessi diagonali.
 */
export function recognizeText(image: string): Promise<OcrResult> {
  const job = recognitionTail.then(async () => {
    const worker = await getWorker();
    const crops = await prepareOcrCrops(image);

    const name = await runField(worker, crops.name, "7").catch(() => ({ text: "", confidence: 0 }));
    const number = await runField(worker, crops.number, "7", true).catch(() => ({ text: "", confidence: 0 }));
    const body = await runField(worker, crops.body, "6").catch(() => ({ text: "", confidence: 0 }));

    let text = [name.text, number.text, body.text].filter(Boolean).join("\n");
    let confidence = name.confidence * 0.5 + number.confidence * 0.32 + body.confidence * 0.18;

    // Layout molto vecchi/atipici o crop geometrico ancora imperfetto: un
    // ultimo OCR full-card e' piu' lento ma meglio di rinunciare al match.
    if (!name.text && !number.text) {
      const full = await runField(worker, image, "6").catch(() => ({ text: "", confidence: 0 }));
      if (full.text) {
        text = [text, full.text].filter(Boolean).join("\n");
        confidence = Math.max(confidence, full.confidence * 0.75);
      }
    }

    return { text, confidence };
  });
  recognitionTail = job.then(() => undefined, () => undefined);
  return job;
}

export async function terminateOcr(): Promise<void> {
  await recognitionTail.catch(() => undefined);
  const pending = workerPromise;
  workerPromise = null;
  if (!pending) return;
  try {
    const worker = await pending;
    await worker.terminate();
  } catch {
    // Cleanup best-effort: non deve trasformare una navigazione in errore UI.
  }
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
  if (/[\u3040-\u30ff\u3400-\u9fff]/u.test(text)) {
    return { code: "jp", label: "日本語", confidence: 0.98 };
  }
  if (/[\uac00-\ud7af]/u.test(text)) {
    return { code: "ko", label: "한국어", confidence: 0.98 };
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

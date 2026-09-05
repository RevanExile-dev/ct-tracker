import type { DetectedLanguage, OcrResult } from "./types";

type TesseractWorker = {
  recognize: (image: string) => Promise<{ data: { text: string; confidence: number } }>;
  terminate: () => Promise<void>;
};

type TesseractApi = {
  createWorker: (langs?: string | string[]) => Promise<TesseractWorker>;
};

const TESSERACT_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
let loaderPromise: Promise<TesseractApi> | null = null;
let workerPromise: Promise<TesseractWorker> | null = null;

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
    script.onload = () => {
      const api = (window as Window & { Tesseract?: TesseractApi }).Tesseract;
      if (api) resolve(api);
      else reject(new Error("Motore OCR caricato ma non inizializzato."));
    };
    script.onerror = () => reject(new Error("Motore OCR non raggiungibile. Puoi comunque correggere il match manualmente."));
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
        // Un solo worker riutilizzato per il batch: evita picchi di RAM su
        // mobile e segue il pattern raccomandato da Tesseract per piu' immagini.
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

export async function recognizeText(image: string): Promise<OcrResult> {
  const worker = await getWorker();
  const result = await worker.recognize(image);
  return {
    text: result.data.text.trim(),
    confidence: Number.isFinite(result.data.confidence) ? result.data.confidence : 0,
  };
}

export async function terminateOcr(): Promise<void> {
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
  return "OCR eseguito nel browser: la foto non viene inviata a CartaViva. Il motore Tesseract viene caricato solo quando usi lo scanner.";
}

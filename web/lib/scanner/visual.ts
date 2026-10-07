// Confronto visivo grezzo tra la carta fotografata e le immagini del catalogo:
// griglia di colori medi sull'area interna della carta, normalizzata per
// canale (cosi' luce e bilanciamento del bianco della foto pesano poco).
// Non riconosce una carta da sola su 30mila, ma tra poche proposte con lo
// stesso nome distingue bene illustrazioni diverse.
const GRID_W = 12;
const GRID_H = 16;
// Margine interno: il ritaglio della foto include un filo di sfondo attorno
// alla carta, l'immagine del catalogo no.
const INSET_X = 0.07;
const INSET_Y = 0.06;

export type VisualSignature = Float32Array;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Immagine non caricabile per il confronto visivo."));
    image.src = src;
  });
}

export async function visualSignature(src: string): Promise<VisualSignature> {
  const image = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = GRID_W;
  canvas.height = GRID_H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas non disponibile.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const sx = image.naturalWidth * INSET_X;
  const sy = image.naturalHeight * INSET_Y;
  ctx.drawImage(image, sx, sy, image.naturalWidth - sx * 2, image.naturalHeight - sy * 2, 0, 0, GRID_W, GRID_H);
  const data = ctx.getImageData(0, 0, GRID_W, GRID_H).data;

  const cells = GRID_W * GRID_H;
  const signature = new Float32Array(cells * 3);
  for (let channel = 0; channel < 3; channel += 1) {
    let sum = 0;
    for (let i = 0; i < cells; i += 1) sum += data[i * 4 + channel];
    const mean = sum / cells;
    let variance = 0;
    for (let i = 0; i < cells; i += 1) variance += (data[i * 4 + channel] - mean) ** 2;
    const std = Math.sqrt(variance / cells) || 1;
    for (let i = 0; i < cells; i += 1) signature[channel * cells + i] = (data[i * 4 + channel] - mean) / std;
  }
  return signature;
}

/** Correlazione media sui tre canali, da -1 (opposte) a 1 (identiche). */
export function visualSimilarity(a: VisualSignature, b: VisualSignature): number {
  if (a.length !== b.length || !a.length) return 0;
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += a[i] * b[i];
  return total / a.length;
}

const catalogSignatures = new Map<number, Promise<VisualSignature | null>>();

/** Firma dell'immagine di catalogo, via proxy dello stesso dominio (CORS). */
export function catalogSignature(id: number): Promise<VisualSignature | null> {
  let pending = catalogSignatures.get(id);
  if (!pending) {
    pending = visualSignature(`/api/scanner-image/${id}`).catch(() => {
      // Errore temporaneo: non memorizzarlo, al prossimo scan si riprova.
      catalogSignatures.delete(id);
      return null;
    });
    catalogSignatures.set(id, pending);
  }
  return pending;
}

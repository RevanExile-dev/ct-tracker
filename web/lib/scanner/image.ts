import type { ScanQuality, ScanRegion } from "./types";

const CARD_ASPECT = 63 / 88;
const MAX_REGIONS = 12;

type WorkCanvas = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Impossibile leggere l'immagine selezionata."));
    image.src = src;
  });
}

function workCanvas(image: HTMLImageElement, maxSide = 480): WorkCanvas {
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas non disponibile.");
  ctx.drawImage(image, 0, 0, width, height);
  return { canvas, ctx, width, height };
}

function iou(a: ScanRegion, b: ScanRegion) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function smoothProfile(source: Float32Array, radius = 2) {
  const out = new Float32Array(source.length);
  let rolling = 0;
  for (let i = 0; i < source.length + radius; i += 1) {
    const add = i + radius;
    const remove = i - radius - 1;
    if (add < source.length) rolling += source[add];
    if (remove >= 0) rolling -= source[remove];
    if (i < source.length) {
      const from = Math.max(0, i - radius);
      const to = Math.min(source.length - 1, i + radius);
      out[i] = rolling / Math.max(1, to - from + 1);
    }
  }
  return out;
}

function pickPeaks(profile: Float32Array, maxPeaks: number, minGap: number) {
  const ranked = Array.from(profile.keys()).sort((a, b) => profile[b] - profile[a]);
  const peaks: number[] = [];
  for (const index of ranked) {
    if (index < 4 || index >= profile.length - 4) continue;
    if (peaks.some((existing) => Math.abs(existing - index) < minGap)) continue;
    peaks.push(index);
    if (peaks.length >= maxPeaks) break;
  }
  return peaks.sort((a, b) => a - b);
}

function linePrefixVertical(
  gx: Uint8Array,
  width: number,
  height: number,
  x: number,
  band = 2,
) {
  const prefix = new Float32Array(height + 1);
  for (let y = 0; y < height; y += 1) {
    let best = 0;
    for (let dx = -band; dx <= band; dx += 1) {
      const px = x + dx;
      if (px < 0 || px >= width) continue;
      best = Math.max(best, gx[y * width + px]);
    }
    prefix[y + 1] = prefix[y] + best;
  }
  return prefix;
}

function linePrefixHorizontal(
  gy: Uint8Array,
  width: number,
  height: number,
  y: number,
  band = 2,
) {
  const prefix = new Float32Array(width + 1);
  for (let x = 0; x < width; x += 1) {
    let best = 0;
    for (let dy = -band; dy <= band; dy += 1) {
      const py = y + dy;
      if (py < 0 || py >= height) continue;
      best = Math.max(best, gy[py * width + x]);
    }
    prefix[x + 1] = prefix[x] + best;
  }
  return prefix;
}

function meanPrefix(prefix: Float32Array, start: number, end: number) {
  const from = Math.max(0, Math.min(prefix.length - 1, Math.round(start)));
  const to = Math.max(from + 1, Math.min(prefix.length - 1, Math.round(end)));
  return (prefix[to] - prefix[from]) / Math.max(1, to - from);
}

/**
 * Trova rettangoli "carta" usando le quattro cornici, non la texture interna.
 *
 * Il detector precedente univa con la dilatazione tutte le texture ad alto
 * contrasto (illustrazione + foil + sfondo) in un unico connected component:
 * su foto reali finiva spesso per ritagliare quasi tutta la fotografia.
 * Qui separiamo gradiente verticale/orizzontale, troviamo i picchi di bordo e
 * combiniamo solo coppie compatibili con il rapporto fisico 63:88 della carta.
 * L'algoritmo resta Canvas-only e O(n) sui pixel; la ricerca dei rettangoli e'
 * limitata a poche decine di picchi e usa prefix sums per non riscorrere i bordi.
 */
function detectBorderRectangles(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): ScanRegion[] {
  if (width < 12 || height < 12) return [];

  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < rgba.length; i += 4, p += 1) {
    gray[p] = Math.round(rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114);
  }

  const gx = new Uint8Array(width * height);
  const gy = new Uint8Array(width * height);
  const verticalProfile = new Float32Array(width);
  const horizontalProfile = new Float32Array(height);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const p = y * width + x;
      const dx = Math.min(255, Math.abs(gray[p + 1] - gray[p - 1]) * 2);
      const dy = Math.min(255, Math.abs(gray[p + width] - gray[p - width]) * 2);
      gx[p] = dx;
      gy[p] = dy;
      verticalProfile[x] += dx;
      horizontalProfile[y] += dy;
    }
  }

  for (let x = 0; x < width; x += 1) verticalProfile[x] /= Math.max(1, height - 2);
  for (let y = 0; y < height; y += 1) horizontalProfile[y] /= Math.max(1, width - 2);

  const xs = pickPeaks(smoothProfile(verticalProfile), 32, Math.max(3, Math.round(width / 70)));
  const ys = pickPeaks(smoothProfile(horizontalProfile), 48, Math.max(4, Math.round(height / 110)));
  if (xs.length < 2 || ys.length < 2) return [];

  const vPrefixes = new Map<number, Float32Array>();
  const hPrefixes = new Map<number, Float32Array>();
  const vPrefix = (x: number) => {
    let value = vPrefixes.get(x);
    if (!value) {
      value = linePrefixVertical(gx, width, height, x);
      vPrefixes.set(x, value);
    }
    return value;
  };
  const hPrefix = (y: number) => {
    let value = hPrefixes.get(y);
    if (!value) {
      value = linePrefixHorizontal(gy, width, height, y);
      hPrefixes.set(y, value);
    }
    return value;
  };

  const candidates: ScanRegion[] = [];
  const totalArea = width * height;

  for (let li = 0; li < xs.length; li += 1) {
    const left = xs[li];
    for (let ri = li + 1; ri < xs.length; ri += 1) {
      const right = xs[ri];
      const boxW = right - left;
      if (boxW < width * 0.18 || boxW > width * 0.96) continue;

      const expectedH = boxW / CARD_ASPECT;
      if (expectedH < height * 0.18 || expectedH > height * 0.94) continue;

      for (const top of ys) {
        const expectedBottom = top + expectedH;
        if (expectedBottom >= height - 2) continue;

        // Considera solo i bordi orizzontali vicini alla quota prevista dal
        // rapporto fisico della carta; evita il prodotto cartesiano di tutte
        // le righe e riduce le "scatole fantasma" tra carte diverse.
        let considered = 0;
        for (const bottom of ys) {
          if (bottom <= top) continue;
          const boxH = bottom - top;
          const heightError = Math.abs(boxH - expectedH) / expectedH;
          if (heightError > 0.19) continue;
          if (Math.abs(bottom - expectedBottom) > expectedH * 0.19) continue;

          const aspect = boxW / boxH;
          if (aspect < 0.57 || aspect > 0.82) continue;
          const areaRatio = (boxW * boxH) / totalArea;
          if (areaRatio < 0.025 || areaRatio > 0.88) continue;

          const edgeValues = [
            meanPrefix(vPrefix(left), top, bottom),
            meanPrefix(vPrefix(right), top, bottom),
            meanPrefix(hPrefix(top), left, right),
            meanPrefix(hPrefix(bottom), left, right),
          ].map((value) => Math.min(1, value / 170));

          const borderMean = edgeValues.reduce((sum, value) => sum + value, 0) / 4;
          const weakest = Math.min(...edgeValues);
          const strongest = Math.max(...edgeValues);
          const symmetry = strongest > 0 ? weakest / strongest : 0;
          const aspectScore = Math.max(0, 1 - Math.abs(aspect - CARD_ASPECT) / 0.13);
          const sizeScore = Math.min(1, areaRatio / 0.3);
          const centerX = (left + right) / 2 / width;
          const centerY = (top + bottom) / 2 / height;
          const centerScore = Math.max(0, 1 - (Math.abs(centerX - 0.5) + Math.abs(centerY - 0.5)) / 0.9);
          const score =
            borderMean * 0.38 +
            weakest * 0.18 +
            symmetry * 0.12 +
            aspectScore * 0.16 +
            sizeScore * 0.1 +
            centerScore * 0.06;

          if (score < 0.28) continue;

          const padX = boxW * 0.018;
          const padY = boxH * 0.018;
          const x1 = Math.max(0, left - padX);
          const y1 = Math.max(0, top - padY);
          const x2 = Math.min(width, right + padX);
          const y2 = Math.min(height, bottom + padY);
          candidates.push({
            id: `border-${candidates.length + 1}`,
            x: x1 / width,
            y: y1 / height,
            width: (x2 - x1) / width,
            height: (y2 - y1) / height,
            score,
          });

          considered += 1;
          if (considered >= 4) break;
        }
      }
    }
  }

  const kept: ScanRegion[] = [];
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    if (kept.some((existing) => iou(existing, candidate) > 0.58)) continue;
    kept.push(candidate);
    if (kept.length >= MAX_REGIONS) break;
  }
  return kept;
}

/** Fallback del detector originale per immagini in cui i quattro bordi non
 * producono abbastanza segnale (carta molto piccola, sfondo quasi identico,
 * taglio parziale). Viene usato solo quando il detector a cornice non trova
 * nulla: non puo' quindi piu' vincere con il classico component enorme che
 * ingloba carta + texture dello sfondo. */
function detectConnectedComponents(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): ScanRegion[] {
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < rgba.length; i += 4, p += 1) {
    gray[p] = Math.round(rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114);
  }

  const gradient = new Uint16Array(width * height);
  let sum = 0;
  let sumSq = 0;
  let samples = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const p = y * width + x;
      const sx =
        -gray[p - width - 1] - 2 * gray[p - 1] - gray[p + width - 1] +
        gray[p - width + 1] + 2 * gray[p + 1] + gray[p + width + 1];
      const sy =
        -gray[p - width - 1] - 2 * gray[p - width] - gray[p - width + 1] +
        gray[p + width - 1] + 2 * gray[p + width] + gray[p + width + 1];
      const magnitude = Math.min(1020, Math.abs(sx) + Math.abs(sy));
      gradient[p] = magnitude;
      if ((x + y) % 5 === 0) {
        sum += magnitude;
        sumSq += magnitude * magnitude;
        samples += 1;
      }
    }
  }

  const mean = samples ? sum / samples : 0;
  const variance = samples ? Math.max(0, sumSq / samples - mean * mean) : 0;
  const threshold = Math.max(85, mean + Math.sqrt(variance));
  let mask = new Uint8Array(width * height);
  for (let i = 0; i < gradient.length; i += 1) mask[i] = gradient[i] >= threshold ? 1 : 0;

  // Una sola dilatazione: due passaggi erano sufficienti a saldare il bordo
  // della carta con illustrazione e trama del tavolo nelle foto reali.
  const next = mask.slice();
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const p = y * width + x;
      if (!mask[p]) continue;
      next[p - 1] = next[p + 1] = next[p - width] = next[p + width] = 1;
    }
  }
  mask = next;

  const visited = new Uint8Array(width * height);
  const candidates: ScanRegion[] = [];
  const totalArea = width * height;

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    const stack = [start];
    visited[start] = 1;
    let count = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;

    while (stack.length) {
      const p = stack.pop()!;
      count += 1;
      const x = p % width;
      const y = Math.floor(p / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      const neighbors = [p - 1, p + 1, p - width, p + width];
      for (const n of neighbors) {
        if (n < 0 || n >= mask.length || visited[n] || !mask[n]) continue;
        const nx = n % width;
        const ny = Math.floor(n / width);
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
        visited[n] = 1;
        stack.push(n);
      }
    }

    if (count < 45) continue;
    const boxW = maxX - minX + 1;
    const boxH = maxY - minY + 1;
    const areaRatio = (boxW * boxH) / totalArea;
    const aspect = Math.min(boxW, boxH) / Math.max(boxW, boxH);
    if (areaRatio < 0.018 || areaRatio > 0.68 || aspect < 0.58 || aspect > 0.8) continue;

    const aspectScore = Math.max(0, 1 - Math.abs(aspect - CARD_ASPECT) / 0.16);
    const density = Math.min(1, count / Math.max(1, boxW * boxH * 0.14));
    candidates.push({
      id: `component-${candidates.length + 1}`,
      x: minX / width,
      y: minY / height,
      width: boxW / width,
      height: boxH / height,
      score: aspectScore * 0.72 + density * 0.28,
    });
  }

  const kept: ScanRegion[] = [];
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    if (kept.some((existing) => iou(existing, candidate) > 0.5)) continue;
    kept.push(candidate);
    if (kept.length >= MAX_REGIONS) break;
  }
  return kept;
}

export async function detectCardRegions(src: string): Promise<ScanRegion[]> {
  const image = await loadImage(src);
  const { ctx, width, height } = workCanvas(image);
  const rgba = ctx.getImageData(0, 0, width, height).data;

  const borderRegions = detectBorderRectangles(rgba, width, height);
  if (borderRegions.length) return borderRegions.sort((a, b) => a.y - b.y || a.x - b.x);

  const componentRegions = detectConnectedComponents(rgba, width, height);
  if (componentRegions.length) return componentRegions.sort((a, b) => a.y - b.y || a.x - b.x);

  return [{ id: "region-full", x: 0, y: 0, width: 1, height: 1, score: 0.2, fallback: true }];
}

export async function cropRegion(src: string, region: ScanRegion): Promise<string> {
  const image = await loadImage(src);
  const sx = Math.max(0, Math.round(region.x * image.naturalWidth));
  const sy = Math.max(0, Math.round(region.y * image.naturalHeight));
  const sw = Math.max(1, Math.min(image.naturalWidth - sx, Math.round(region.width * image.naturalWidth)));
  const sh = Math.max(1, Math.min(image.naturalHeight - sy, Math.round(region.height * image.naturalHeight)));
  const targetW = Math.min(1000, sw);
  const targetH = Math.max(1, Math.round(targetW * (sh / sw)));
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas non disponibile.");
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, targetW, targetH);
  return canvas.toDataURL("image/jpeg", 0.92);
}

export async function assessQuality(src: string): Promise<ScanQuality> {
  const image = await loadImage(src);
  const { ctx, width, height } = workCanvas(image, 320);
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const gray = new Float32Array(width * height);
  let glare = 0;
  for (let i = 0, p = 0; i < rgba.length; i += 4, p += 1) {
    const value = rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114;
    gray[p] = value;
    if (rgba[i] > 246 && rgba[i + 1] > 246 && rgba[i + 2] > 246) glare += 1;
  }

  let lapSum = 0;
  let lapSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const p = y * width + x;
      const lap = 4 * gray[p] - gray[p - 1] - gray[p + 1] - gray[p - width] - gray[p + width];
      lapSum += lap;
      lapSq += lap * lap;
      n += 1;
    }
  }
  const lapMean = n ? lapSum / n : 0;
  const sharpness = n ? Math.max(0, lapSq / n - lapMean * lapMean) : 0;
  const glarePct = (glare / Math.max(1, width * height)) * 100;
  return {
    sharpness,
    glarePct,
    label: glarePct > 8 ? "glare" : sharpness < 95 ? "soft" : "good",
  };
}

// Stesso crop artwork approssimato usato build-time in scripts/scanner_common.py
// (ARTWORK_BOX) - deve restare identico sui due lati o gli hash non sono piu'
// confrontabili. Percentuali (left, top, right, bottom) sull'immagine intera.
const ARTWORK_BOX = { left: 0.09, top: 0.10, right: 0.91, bottom: 0.58 } as const;

function dhashFromContext(ctx: CanvasRenderingContext2D): string {
  const data = ctx.getImageData(0, 0, 9, 8).data;
  let bits = BigInt(0);
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const a = (y * 9 + x) * 4;
      const b = (y * 9 + x + 1) * 4;
      const ga = data[a] * 0.299 + data[a + 1] * 0.587 + data[a + 2] * 0.114;
      const gb = data[b] * 0.299 + data[b + 1] * 0.587 + data[b + 2] * 0.114;
      bits = (bits << BigInt(1)) | (ga > gb ? BigInt(1) : BigInt(0));
    }
  }
  return bits.toString(16).padStart(16, "0");
}

function dhashCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = 9;
  canvas.height = 8;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas non disponibile.");
  return { canvas, ctx };
}

function artDhashFromImage(image: HTMLImageElement): string {
  const sx = Math.round(image.naturalWidth * ARTWORK_BOX.left);
  const sy = Math.round(image.naturalHeight * ARTWORK_BOX.top);
  const sw = Math.max(1, Math.round(image.naturalWidth * (ARTWORK_BOX.right - ARTWORK_BOX.left)));
  const sh = Math.max(1, Math.round(image.naturalHeight * (ARTWORK_BOX.bottom - ARTWORK_BOX.top)));
  const { ctx } = dhashCanvas();
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, 9, 8);
  return dhashFromContext(ctx);
}

/** Calcola dHash immagine-intera + dHash del solo crop artwork (stesso crop
 * build-time, combinato lato catalog.ts - la coppia full+art validata nello
 * spike M1a, top-1 100% su distorsioni sintetiche, vedi issue #20) con una
 * sola loadImage()/decodifica invece di due in parallelo com'era prima
 * (rilievo review Gemini: due chiamate separate decodificavano la stessa
 * immagine due volte per ogni scatto dello scanner). Se il solo crop
 * artwork fallisce (edge case geometrico, non un problema dell'immagine in
 * se'), degrada ad art assente invece di perdere anche full - un altro
 * rilievo della stessa review: un Promise.all "tutto o niente" buttava via
 * un hash valido per un fallimento del secondo. */
export async function cardHashes(src: string): Promise<{ full: string; art?: string }> {
  const image = await loadImage(src);
  const fullCtx = dhashCanvas().ctx;
  fullCtx.drawImage(image, 0, 0, 9, 8);
  const full = dhashFromContext(fullCtx);
  try {
    return { full, art: artDhashFromImage(image) };
  } catch {
    return { full };
  }
}

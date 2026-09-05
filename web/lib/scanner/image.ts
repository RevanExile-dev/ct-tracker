import type { ScanQuality, ScanRegion } from "./types";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Impossibile leggere l'immagine selezionata."));
    image.src = src;
  });
}

function workCanvas(image: HTMLImageElement, maxSide = 480) {
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

/**
 * Detector volutamente dependency-free: Sobel -> soglia adattiva -> dilatazione
 * -> connected components. Non sostituisce OpenCV per foto estreme, ma rende
 * gia' utilizzabile il batch da browser e mantiene il bundle principale pulito.
 */
export async function detectCardRegions(src: string): Promise<ScanRegion[]> {
  const image = await loadImage(src);
  const { ctx, width, height } = workCanvas(image);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const gray = new Uint8Array(width * height);

  for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) {
    gray[p] = Math.round(pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114);
  }

  const gradient = new Uint16Array(width * height);
  let sum = 0;
  let sumSq = 0;
  let samples = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const p = y * width + x;
      const gx =
        -gray[p - width - 1] - 2 * gray[p - 1] - gray[p + width - 1] +
        gray[p - width + 1] + 2 * gray[p + 1] + gray[p + width + 1];
      const gy =
        -gray[p - width - 1] - 2 * gray[p - width] - gray[p - width + 1] +
        gray[p + width - 1] + 2 * gray[p + width] + gray[p + width + 1];
      const magnitude = Math.min(1020, Math.abs(gx) + Math.abs(gy));
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
  const threshold = Math.max(75, mean + Math.sqrt(variance) * 0.9);
  let mask = new Uint8Array(width * height);
  for (let i = 0; i < gradient.length; i += 1) mask[i] = gradient[i] >= threshold ? 1 : 0;

  // Dilatazione leggera per unire i quattro bordi e le texture interne della carta.
  for (let pass = 0; pass < 2; pass += 1) {
    const next = mask.slice();
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const p = y * width + x;
        if (!mask[p]) continue;
        next[p - 1] = next[p + 1] = next[p - width] = next[p + width] = 1;
        next[p - width - 1] = next[p - width + 1] = next[p + width - 1] = next[p + width + 1] = 1;
      }
    }
    mask = next;
  }

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

    if (count < 40) continue;
    let boxW = maxX - minX + 1;
    let boxH = maxY - minY + 1;
    const boxArea = boxW * boxH;
    const areaRatio = boxArea / totalArea;
    const aspect = Math.min(boxW, boxH) / Math.max(boxW, boxH);
    if (areaRatio < 0.018 || areaRatio > 0.88 || aspect < 0.53 || aspect > 0.86) continue;

    const padX = boxW * 0.035;
    const padY = boxH * 0.035;
    minX = Math.max(0, minX - padX);
    minY = Math.max(0, minY - padY);
    maxX = Math.min(width, maxX + padX);
    maxY = Math.min(height, maxY + padY);
    boxW = maxX - minX;
    boxH = maxY - minY;

    const aspectScore = Math.max(0, 1 - Math.abs(aspect - 0.716) / 0.22);
    const density = Math.min(1, count / Math.max(1, boxArea * 0.16));
    candidates.push({
      id: `region-${candidates.length + 1}`,
      x: minX / width,
      y: minY / height,
      width: boxW / width,
      height: boxH / height,
      score: aspectScore * 0.72 + density * 0.28,
    });
  }

  const kept: ScanRegion[] = [];
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    if (kept.some((existing) => iou(existing, candidate) > 0.48)) continue;
    kept.push(candidate);
    if (kept.length >= 12) break;
  }

  if (kept.length) return kept.sort((a, b) => a.y - b.y || a.x - b.x);
  return [{ id: "region-full", x: 0, y: 0, width: 1, height: 1, score: 0.35, fallback: true }];
}

export async function cropRegion(src: string, region: ScanRegion): Promise<string> {
  const image = await loadImage(src);
  const sx = Math.round(region.x * image.naturalWidth);
  const sy = Math.round(region.y * image.naturalHeight);
  const sw = Math.max(1, Math.round(region.width * image.naturalWidth));
  const sh = Math.max(1, Math.round(region.height * image.naturalHeight));
  const targetW = Math.min(900, sw);
  const targetH = Math.max(1, Math.round(targetW * (sh / sw)));
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas non disponibile.");
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, targetW, targetH);
  return canvas.toDataURL("image/jpeg", 0.9);
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

export async function dhash(src: string): Promise<string> {
  const image = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = 9;
  canvas.height = 8;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas non disponibile.");
  ctx.drawImage(image, 0, 0, 9, 8);
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

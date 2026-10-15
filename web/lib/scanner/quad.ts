// Rilevamento della carta come quadrilatero (quattro bordi dritti) e
// raddrizzamento prospettico del ritaglio.
//
// Perche' esiste: sulle foto di prova del 2026-10-08 (carta su legno, tappetino,
// scrivania, con luce non uniforme e riflessi) i rilevatori a "sfondo uniforme"
// e a "bordi" agganciavano la carta giusta solo in 88 casi su 142: le venature
// del legno e la luce a gradiente li ingannavano, e spesso il ritaglio finiva
// per essere l'intera foto. Con il ritaglio sbagliato il nome non si legge e il
// confronto con l'immagine del catalogo non vale nulla.
//
// Come funziona: si cercano linee quasi verticali e quasi orizzontali con una
// trasformata di Hough sui bordi dell'immagine; ogni combinazione di due
// verticali e due orizzontali e' un quadrilatero candidato, tenuto solo se ha
// le proporzioni di una carta (63x88 mm, con tolleranza per la prospettiva) e
// se i bordi dell'immagine seguono davvero i suoi quattro lati. Tra quelli
// validi vince il piu' grande: le cornici interne (illustrazione, riquadro
// testo) hanno proporzioni diverse o stanno dentro la carta vera.

export type Point = [number, number];

export type CardQuad = {
  // Angoli in pixel dell'immagine analizzata: alto-sx, alto-dx, basso-dx, basso-sx.
  corners: [Point, Point, Point, Point];
  // Frazione media dei lati coperta da un bordo vero (0..1).
  support: number;
  // Lato meno coperto (0..1): un quadrilatero "inventato" ha almeno un lato debole.
  minSupport: number;
};

const CARD_ASPECT = 63 / 88;
// Inclinazione massima dei lati (gradi) e passo della ricerca. Sotto i 12 gradi
// la ricerca e' quella storica; oltre, vedi detectCardQuad.
const BASE_TILT_DEG = 12;
const WIDE_TILT_DEG = 32;
// Quanto possono differire (gradi) la rotazione letta dai lati verticali e da
// quelli orizzontali: la prospettiva li sposta poco, una cornice inventata no.
const WIDE_CONSISTENT_DEG = 8;
const TILT_STEP_DEG = 2;

type Line = { offset: number; slope: number; votes: number };

function gradients(rgba: Uint8ClampedArray, width: number, height: number) {
  // Sobel per canale, si tiene il canale con la variazione piu' forte: il bordo
  // giallo di una carta su un tavolo marrone e' netto nel colore piu' che nella
  // luminosita'.
  const gx = new Float32Array(width * height);
  const gy = new Float32Array(width * height);
  const mag = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      let bestX = 0;
      let bestY = 0;
      let best = -1;
      for (let c = 0; c < 3; c += 1) {
        const at = (dx: number, dy: number) => rgba[((y + dy) * width + x + dx) * 4 + c];
        const sx = at(1, -1) + 2 * at(1, 0) + at(1, 1) - at(-1, -1) - 2 * at(-1, 0) - at(-1, 1);
        const sy = at(-1, 1) + 2 * at(0, 1) + at(1, 1) - at(-1, -1) - 2 * at(0, -1) - at(1, -1);
        const m = sx * sx + sy * sy;
        if (m > best) {
          best = m;
          bestX = sx;
          bestY = sy;
        }
      }
      const p = y * width + x;
      gx[p] = bestX;
      gy[p] = bestY;
      mag[p] = Math.sqrt(best);
    }
  }
  return { gx, gy, mag };
}

function edgeThreshold(mag: Float32Array) {
  // I bordi da considerare sono il 12% piu' forte dell'immagine (minimo 60 su
  // scala Sobel): abbastanza per i lati della carta, non per la grana del fondo.
  const sample: number[] = [];
  for (let i = 0; i < mag.length; i += 7) sample.push(mag[i]);
  sample.sort((a, b) => a - b);
  return Math.max(60, sample[Math.floor(sample.length * 0.88)] ?? 60);
}

/**
 * Linee di una famiglia: verticali (x = offset + slope*y) se `vertical`,
 * altrimenti orizzontali (y = offset + slope*x). Solo pixel di bordo con il
 * gradiente perpendicolare alla linea.
 */
function houghLines(
  edges: Int32Array,
  edgeCount: number,
  gx: Float32Array,
  gy: Float32Array,
  width: number,
  height: number,
  vertical: boolean,
  maxTiltDeg: number,
): Line[] {
  const MAX_TILT = Math.tan((maxTiltDeg * Math.PI) / 180);
  const TILT_STEPS = Math.round((2 * maxTiltDeg) / TILT_STEP_DEG) + 1;
  const along = vertical ? height : width;
  const across = vertical ? width : height;
  const margin = Math.ceil(along * MAX_TILT) + 2;
  const bins = across + margin * 2;
  const acc = new Float32Array(TILT_STEPS * bins);
  const slopes = Array.from({ length: TILT_STEPS }, (_, i) => -MAX_TILT + (2 * MAX_TILT * i) / (TILT_STEPS - 1));
  for (let e = 0; e < edgeCount; e += 1) {
    const p = edges[e];
    const x = p % width;
    const y = (p - x) / width;
    const ax = Math.abs(gx[p]);
    const ay = Math.abs(gy[p]);
    // Lato verticale: il colore cambia in orizzontale (gx domina), e viceversa.
    if (vertical ? ax < ay * 1.4 : ay < ax * 1.4) continue;
    const u = vertical ? x : y;
    const v = vertical ? y : x;
    for (let s = 0; s < TILT_STEPS; s += 1) {
      const offset = Math.round(u - slopes[s] * v) + margin;
      if (offset >= 0 && offset < bins) acc[s * bins + offset] += 1;
    }
  }
  // Massimi locali, poi soppressione dei vicini (stessa linea con offset/tilt simili).
  const peaks: Line[] = [];
  const minVotes = along * 0.12;
  for (let s = 0; s < TILT_STEPS; s += 1) {
    for (let o = 1; o < bins - 1; o += 1) {
      const value = acc[s * bins + o] + 0.5 * (acc[s * bins + o - 1] + acc[s * bins + o + 1]);
      if (value < minVotes) continue;
      peaks.push({ offset: o - margin, slope: slopes[s], votes: value });
    }
  }
  peaks.sort((a, b) => b.votes - a.votes);
  const kept: Line[] = [];
  for (const peak of peaks) {
    const mid = along / 2;
    const near = kept.some((line) => Math.abs((line.offset + line.slope * mid) - (peak.offset + peak.slope * mid)) < across * 0.025);
    if (near) continue;
    kept.push(peak);
    if (kept.length >= 12) break;
  }
  return kept;
}

function intersect(v: Line, h: Line): Point {
  // x = v.offset + v.slope*y ; y = h.offset + h.slope*x
  const y = (h.offset + h.slope * v.offset) / (1 - h.slope * v.slope);
  return [v.offset + v.slope * y, y];
}

function sideSupport(
  a: Point,
  b: Point,
  mag: Float32Array,
  gx: Float32Array,
  gy: Float32Array,
  threshold: number,
  width: number,
  height: number,
) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (length < 8) return 0;
  const nx = -dy / length;
  const ny = dx / length;
  // Solo l'80% centrale del lato: gli angoli della carta sono arrotondati.
  const samples = Math.max(12, Math.round(length / 2));
  let hits = 0;
  let total = 0;
  for (let i = 0; i < samples; i += 1) {
    const t = 0.1 + (0.8 * i) / (samples - 1);
    const cx = a[0] + dx * t;
    const cy = a[1] + dy * t;
    total += 1;
    for (let d = -2; d <= 2; d += 1) {
      const x = Math.round(cx + nx * d);
      const y = Math.round(cy + ny * d);
      if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
      const p = y * width + x;
      if (mag[p] < threshold * 0.6) continue;
      // Gradiente perpendicolare al lato (entro ~40 gradi).
      if (Math.abs(gx[p] * nx + gy[p] * ny) >= 0.75 * mag[p]) {
        hits += 1;
        break;
      }
    }
  }
  return total ? hits / total : 0;
}

function polygonArea(corners: Point[]) {
  let area = 0;
  for (let i = 0; i < corners.length; i += 1) {
    const [x1, y1] = corners[i];
    const [x2, y2] = corners[(i + 1) % corners.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}


// Retta per due punti (forma implicita a*x + b*y = c, con (a,b) unitario).
type Side = { a: number; b: number; c: number };

function sideLine(p: Point, q: Point): Side {
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const length = Math.hypot(dx, dy) || 1;
  const a = -dy / length;
  const b = dx / length;
  return { a, b, c: a * p[0] + b * p[1] };
}

function intersectSides(l1: Side, l2: Side): Point | null {
  const det = l1.a * l2.b - l2.a * l1.b;
  if (Math.abs(det) < 1e-6) return null;
  return [(l1.c * l2.b - l2.c * l1.b) / det, (l1.a * l2.c - l2.a * l1.c) / det];
}

/**
 * Affina i quattro lati: la ricerca di Hough ha passo di 2 gradi, che su una
 * carta inclinata sposta gli angoli di diversi pixel. Per ogni lato si
 * riadatta una retta (minimi quadrati totali, pesata sul gradiente) ai pixel
 * di bordo vicini al lato attuale, con il gradiente perpendicolare. Se un lato
 * ha pochi punti resta com'e'.
 */
function refineQuad(
  corners: [Point, Point, Point, Point],
  mag: Float32Array,
  gx: Float32Array,
  gy: Float32Array,
  threshold: number,
  width: number,
  height: number,
): [Point, Point, Point, Point] {
  let current = corners;
  for (const window of [4, 2.5]) {
    const lines: Side[] = [];
    for (let i = 0; i < 4; i += 1) {
      const p = current[i];
      const q = current[(i + 1) % 4];
      const line = sideLine(p, q);
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      const length = Math.hypot(dx, dy) || 1;
      const ux = dx / length;
      const uy = dy / length;
      const x0 = Math.max(1, Math.floor(Math.min(p[0], q[0]) - window - 1));
      const x1 = Math.min(width - 2, Math.ceil(Math.max(p[0], q[0]) + window + 1));
      const y0 = Math.max(1, Math.floor(Math.min(p[1], q[1]) - window - 1));
      const y1 = Math.min(height - 2, Math.ceil(Math.max(p[1], q[1]) + window + 1));
      let sw = 0;
      let sx = 0;
      let sy = 0;
      let sxx = 0;
      let sxy = 0;
      let syy = 0;
      let points = 0;
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const m = mag[y * width + x];
          if (m < threshold * 0.6) continue;
          const dist = line.a * x + line.b * y - line.c;
          if (Math.abs(dist) > window) continue;
          const t = ((x - p[0]) * ux + (y - p[1]) * uy) / length;
          // Solo la parte centrale: gli angoli della carta sono arrotondati.
          if (t < 0.1 || t > 0.9) continue;
          const idx = y * width + x;
          if (Math.abs(gx[idx] * line.a + gy[idx] * line.b) < 0.8 * m) continue;
          sw += m;
          sx += m * x;
          sy += m * y;
          sxx += m * x * x;
          sxy += m * x * y;
          syy += m * y * y;
          points += 1;
        }
      }
      if (points < length * 0.3 || sw <= 0) {
        lines.push(line);
        continue;
      }
      const mx = sx / sw;
      const my = sy / sw;
      const cxx = sxx / sw - mx * mx;
      const cxy = sxy / sw - mx * my;
      const cyy = syy / sw - my * my;
      // Direzione principale della nuvola di punti = direzione del lato.
      const angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
      let dirX = Math.cos(angle);
      let dirY = Math.sin(angle);
      if (dirX * ux + dirY * uy < 0) {
        dirX = -dirX;
        dirY = -dirY;
      }
      const a = -dirY;
      const b = dirX;
      lines.push({ a, b, c: a * mx + b * my });
    }
    const next: Point[] = [];
    for (let i = 0; i < 4; i += 1) {
      const corner = intersectSides(lines[(i + 3) % 4], lines[i]);
      if (!corner) return current;
      next.push(corner);
    }
    current = next as [Point, Point, Point, Point];
  }
  return current;
}

type Best = CardQuad & { area: number; rank: number };

type Gradients = ReturnType<typeof gradients>;

/**
 * Miglior quadrilatero con lati inclinati al massimo `maxTiltDeg`. Con
 * `consistent` si scartano i quadrilateri i cui lati verticali e orizzontali
 * non ruotano nello stesso verso: una carta ruotata di T gradi ha i lati
 * orizzontali a +T e quelli verticali a -T (la prospettiva sposta poco).
 */
function searchQuad(
  g: Gradients,
  threshold: number,
  edges: Int32Array,
  edgeCount: number,
  width: number,
  height: number,
  maxTiltDeg: number,
  consistentDeg: number | null,
): Best | null {
  const { gx, gy, mag } = g;
  const verticals = houghLines(edges, edgeCount, gx, gy, width, height, true, maxTiltDeg);
  const horizontals = houghLines(edges, edgeCount, gx, gy, width, height, false, maxTiltDeg);
  const maxMismatch = consistentDeg === null ? Infinity : Math.tan((consistentDeg * Math.PI) / 180);
  let best: Best | null = null;
  for (let i = 0; i < verticals.length; i += 1) {
    for (let j = 0; j < verticals.length; j += 1) {
      const left = verticals[i];
      const right = verticals[j];
      if (left.offset + left.slope * height / 2 >= right.offset + right.slope * height / 2) continue;
      for (let k = 0; k < horizontals.length; k += 1) {
        for (let l = 0; l < horizontals.length; l += 1) {
          const top = horizontals[k];
          const bottom = horizontals[l];
          if (top.offset + top.slope * width / 2 >= bottom.offset + bottom.slope * width / 2) continue;
          if (consistentDeg !== null) {
            const rotV = -(left.slope + right.slope) / 2;
            const rotH = (top.slope + bottom.slope) / 2;
            if (Math.abs(rotV - rotH) > maxMismatch) continue;
          }
          const corners: [Point, Point, Point, Point] = [
            intersect(left, top),
            intersect(right, top),
            intersect(right, bottom),
            intersect(left, bottom),
          ];
          if (corners.some(([x, y]) => x < -width * 0.02 || y < -height * 0.02 || x > width * 1.02 || y > height * 1.02)) continue;
          const topW = Math.hypot(corners[1][0] - corners[0][0], corners[1][1] - corners[0][1]);
          const bottomW = Math.hypot(corners[2][0] - corners[3][0], corners[2][1] - corners[3][1]);
          const leftH = Math.hypot(corners[3][0] - corners[0][0], corners[3][1] - corners[0][1]);
          const rightH = Math.hypot(corners[2][0] - corners[1][0], corners[2][1] - corners[1][1]);
          const aspect = (topW + bottomW) / (leftH + rightH);
          // 63:88 = 0.716; la prospettiva di una foto un po' inclinata la sposta.
          if (aspect < 0.6 || aspect > 0.84) continue;
          if (Math.min(topW, bottomW) / Math.max(topW, bottomW) < 0.8) continue;
          if (Math.min(leftH, rightH) / Math.max(leftH, rightH) < 0.8) continue;
          const area = polygonArea(corners);
          if (area < width * height * 0.05) continue;
          const supports = [
            sideSupport(corners[0], corners[1], mag, gx, gy, threshold, width, height),
            sideSupport(corners[1], corners[2], mag, gx, gy, threshold, width, height),
            sideSupport(corners[2], corners[3], mag, gx, gy, threshold, width, height),
            sideSupport(corners[3], corners[0], mag, gx, gy, threshold, width, height),
          ];
          const minSupport = Math.min(...supports);
          if (minSupport < 0.5) continue;
          const support = supports.reduce((a, b) => a + b, 0) / 4;
          // Il piu' grande vince; a parita' di area conta quanto i lati sono netti.
          const rank = area * (0.6 + 0.4 * support) * (1 - Math.abs(aspect - CARD_ASPECT));
          if (!best || rank > best.rank) best = { corners, support, minSupport, area, rank };
        }
      }
    }
  }
  return best;
}

/** La carta piu' grande con quattro lati dritti visibili, o null. */
export function detectCardQuad(rgba: Uint8ClampedArray, width: number, height: number): CardQuad | null {
  if (width < 48 || height < 48) return null;
  const g = gradients(rgba, width, height);
  const threshold = edgeThreshold(g.mag);
  const edges = new Int32Array(width * height);
  let edgeCount = 0;
  for (let p = 0; p < g.mag.length; p += 1) if (g.mag[p] >= threshold) edges[edgeCount++] = p;
  // Prima la ricerca larga (fino a WIDE_TILT_DEG, lati coerenti tra loro): su
  // una carta inclinata oltre 12 gradi quella stretta aggancia una cornice
  // interna al posto della carta. La stretta resta per i casi in cui la larga
  // non trova nulla (es. prospettiva forte, lati verticali e orizzontali
  // ruotati in modo diverso).
  const best =
    searchQuad(g, threshold, edges, edgeCount, width, height, WIDE_TILT_DEG, WIDE_CONSISTENT_DEG) ??
    searchQuad(g, threshold, edges, edgeCount, width, height, BASE_TILT_DEG, null);
  if (!best) return null;
  const corners = refineQuad(best.corners, g.mag, g.gx, g.gy, threshold, width, height);
  return { corners, support: best.support, minSupport: best.minSupport };
}

/**
 * Quanto i quattro lati di un quadrilatero seguono bordi veri dell'immagine
 * (lato meno coperto, 0..1). Serve a confrontare quadrilateri trovati da
 * metodi diversi (linee di Hough, macchia su sfondo uniforme).
 */
export function quadMinSupport(rgba: Uint8ClampedArray, width: number, height: number, corners: [Point, Point, Point, Point]): number {
  const { gx, gy, mag } = gradients(rgba, width, height);
  const threshold = edgeThreshold(mag);
  let min = 1;
  for (let i = 0; i < 4; i += 1) {
    min = Math.min(min, sideSupport(corners[i], corners[(i + 1) % 4], mag, gx, gy, threshold, width, height));
  }
  return min;
}

// Omografia che porta il rettangolo (0,0)-(w,h) sui quattro angoli dati.
function homography(corners: [Point, Point, Point, Point], w: number, h: number) {
  const src: Point[] = [[0, 0], [w, 0], [w, h], [0, h]];
  const A: number[][] = [];
  const B: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const [x, y] = src[i];
    const [u, v] = corners[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    B.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    B.push(v);
  }
  // Eliminazione di Gauss con pivot parziale (8x8).
  for (let col = 0; col < 8; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < 8; row += 1) if (Math.abs(A[row][col]) > Math.abs(A[pivot][col])) pivot = row;
    [A[col], A[pivot]] = [A[pivot], A[col]];
    [B[col], B[pivot]] = [B[pivot], B[col]];
    for (let row = 0; row < 8; row += 1) {
      if (row === col) continue;
      const factor = A[row][col] / A[col][col];
      for (let k = col; k < 8; k += 1) A[row][k] -= factor * A[col][k];
      B[row] -= factor * B[col];
    }
  }
  return B.map((value, i) => value / A[i][i]);
}

/**
 * Raddrizza il quadrilatero in un rettangolo outW x outH, campionando
 * (bilineare) i pixel RGBA della sorgente.
 */
export function warpQuad(
  source: Uint8ClampedArray,
  srcWidth: number,
  srcHeight: number,
  corners: [Point, Point, Point, Point],
  outW: number,
  outH: number,
): Uint8ClampedArray {
  const [a, b, c, d, e, f, g, h] = homography(corners, outW, outH);
  const out = new Uint8ClampedArray(outW * outH * 4);
  for (let y = 0; y < outH; y += 1) {
    for (let x = 0; x < outW; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const den = g * px + h * py + 1;
      const u = Math.min(srcWidth - 1.001, Math.max(0, (a * px + b * py + c) / den - 0.5));
      const v = Math.min(srcHeight - 1.001, Math.max(0, (d * px + e * py + f) / den - 0.5));
      const x0 = Math.floor(u);
      const y0 = Math.floor(v);
      const fx = u - x0;
      const fy = v - y0;
      const i00 = (y0 * srcWidth + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + srcWidth * 4;
      const i11 = i01 + 4;
      const o = (y * outW + x) * 4;
      for (let ch = 0; ch < 4; ch += 1) {
        out[o + ch] =
          source[i00 + ch] * (1 - fx) * (1 - fy) +
          source[i10 + ch] * fx * (1 - fy) +
          source[i01 + ch] * (1 - fx) * fy +
          source[i11 + ch] * fx * fy;
      }
    }
  }
  return out;
}

/** Allarga il quadrilatero verso l'esterno (frazione dei lati), dal centro. */
export function expandQuad(corners: [Point, Point, Point, Point], fraction: number): [Point, Point, Point, Point] {
  const cx = corners.reduce((sum, [x]) => sum + x, 0) / 4;
  const cy = corners.reduce((sum, [, y]) => sum + y, 0) / 4;
  return corners.map(([x, y]) => [cx + (x - cx) * (1 + fraction), cy + (y - cy) * (1 + fraction)]) as [Point, Point, Point, Point];
}

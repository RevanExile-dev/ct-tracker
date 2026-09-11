// Matematica pura condivisa dai grafici a linee (PriceChart, CollectionValueChart):
// nessuna dipendenza da React, solo trasformazioni di coordinate su un
// viewBox SVG 0-100. Estratta qui perche' la curva monotona sotto non e'
// banale - duplicarla tra i due componenti sarebbe stato il rischio reale,
// non la spaziatura X o l'area, gia' abbastanza semplici da restare inline.

export type ChartCoord = { x: number; y: number };

/** X in 0-100 per posizione TEMPORALE reale (millisecondi), non per indice
 * nell'array: dopo la compressione settimanale dello storico (oltre
 * RETENTION_DAILY_DAYS in scripts/db.py) i punti piu' vecchi sono spaziati
 * 7 giorni invece di 1 - posizionarli per indice li stirerebbe alla stessa
 * larghezza dei punti giornalieri recenti, deformando l'andamento reale
 * (in particolare in una finestra "1 anno" che attraversa il confine tra le
 * due densita'). */
export function xForDate(dateMs: number, minMs: number, maxMs: number): number {
  const span = maxMs - minMs;
  return span <= 0 ? 50 : ((dateMs - minMs) / span) * 100;
}

/** Scala i valori (prezzo, o qualunque metrica) sull'asse Y del viewBox,
 * con un margine top/bottom cosi' la linea non tocca mai i bordi. */
export function yForValue(value: number, minV: number, maxV: number, padTop = 10, padBottom = 10): number {
  const span = maxV - minV || 1;
  return 100 - ((value - minV) / span) * (100 - padTop - padBottom) - padBottom;
}

/**
 * Curva monotona (algoritmo Fritsch-Carlson, la stessa idea di
 * d3.curveMonotoneX): ammorbidisce la linea SENZA mai superare (overshoot)
 * il valore di un punto vicino, a differenza di una spline Catmull-Rom
 * "ingenua". Su un grafico prezzi un overshoot implicherebbe visivamente un
 * picco/calo che i dati non contengono - qui ogni tratto resta dentro
 * l'inviluppo [min(y_i, y_i+1), max(y_i, y_i+1)] dei suoi due estremi.
 * Gestisce spaziatura X non uniforme (punti mancanti in una serie, storico
 * compresso), non solo passo costante.
 */
export function monotonePath(coords: ChartCoord[]): string {
  const n = coords.length;
  if (n === 0) return "";
  if (n === 1) return `M ${coords[0].x} ${coords[0].y}`;
  const xs = coords.map((c) => c.x);
  const ys = coords.map((c) => c.y);

  const dx: number[] = new Array(n - 1);
  const secant: number[] = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    dx[i] = xs[i + 1] - xs[i];
    secant[i] = dx[i] === 0 ? 0 : (ys[i + 1] - ys[i]) / dx[i];
  }

  const tangent: number[] = new Array(n).fill(0);
  tangent[0] = secant[0];
  tangent[n - 1] = secant[n - 2];
  for (let i = 1; i < n - 1; i++) {
    // Estremo locale (la linea cambia direzione, o e' piatta su un lato):
    // appiattisce la tangente a zero, altrimenti la curva "supererebbe" il
    // picco/valle invece di fermarcisi.
    if (secant[i - 1] === 0 || secant[i] === 0 || secant[i - 1] > 0 !== secant[i] > 0) {
      tangent[i] = 0;
    } else {
      tangent[i] = (secant[i - 1] + secant[i]) / 2;
    }
  }

  // Limitatore Fritsch-Carlson: se le tangenti sono troppo ripide rispetto
  // alla pendenza del segmento, le raccorcia - questa e' la parte che
  // garantisce davvero l'assenza di overshoot, non solo l'appiattimento
  // sugli estremi sopra.
  for (let i = 0; i < n - 1; i++) {
    if (secant[i] === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const a = tangent[i] / secant[i];
    const b = tangent[i + 1] / secant[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      tangent[i] = t * a * secant[i];
      tangent[i + 1] = t * b * secant[i];
    }
  }

  let d = `M ${xs[0]} ${ys[0]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i];
    const c1x = xs[i] + h / 3;
    const c1y = ys[i] + (tangent[i] * h) / 3;
    const c2x = xs[i + 1] - h / 3;
    const c2y = ys[i + 1] - (tangent[i + 1] * h) / 3;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${xs[i + 1]} ${ys[i + 1]}`;
  }
  return d;
}

/** Chiude una linea in un'area riempibile, scendendo fino alla base del
 * viewBox (y=100) agli estremi. */
export function areaPath(linePath: string, coords: ChartCoord[]): string {
  if (!linePath || coords.length === 0) return "";
  const first = coords[0];
  const last = coords[coords.length - 1];
  return `${linePath} L ${last.x} 100 L ${first.x} 100 Z`;
}

"use client";

import { useMemo, useRef, useState } from "react";
import { PricePoint } from "@/lib/db";
import { formatCents, formatDate, formatDateLong } from "@/lib/format";

/** Coordinata X (0-100) per l'indice idx su un totale di `total` punti - un
 * solo punto va al centro, altrimenti distribuito linearmente. Usata sia per
 * posizionare le serie sia per la riga tratteggiata al passaggio del mouse:
 * un calcolo duplicato tra le due cose (fatto in precedenza) puo' disallineare
 * la riga dal punto vero quando total===1 (bug reale, verificato: la riga
 * finiva al bordo sinistro invece che al centro dove sta davvero l'unico
 * punto). */
function xForIndex(idx: number, total: number): number {
  return total <= 1 ? 50 : (idx / (total - 1)) * 100;
}

/** Trasforma una serie di prezzi (alcuni possibili null) in coordinate SVG
 * 0-100, usando un min/max CONDIVISO tra le serie passate cosi' due linee
 * nello stesso grafico restano comparabili invece di essere normalizzate
 * ciascuna per conto proprio (che le farebbe sembrare vicine anche quando
 * i prezzi reali sono molto diversi). */
function buildSeries(
  points: PricePoint[],
  pick: (p: PricePoint) => number | null,
  min: number,
  max: number
): { path: string; coords: { x: number; y: number; idx: number }[] } {
  const span = max - min || 1;
  const h = 100;
  const withValue = points
    .map((p, idx) => ({ v: pick(p), idx }))
    .filter((p): p is { v: number; idx: number } => p.v !== null);
  if (withValue.length === 0) return { path: "", coords: [] };
  const coords = withValue.map(({ v, idx }) => {
    const x = xForIndex(idx, points.length);
    const y = h - ((v - min) / span) * (h - 20) - 10;
    return { x, y, idx };
  });
  const path = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`).join(" ");
  return { path, coords };
}

export default function PriceChart({
  points,
  currency,
}: {
  points: PricePoint[];
  currency: string;
}) {
  const withPrice = points.filter((p) => p.min_price_cents !== null);
  const hasBest = points.some((p) => p.best_price_cents !== null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const { minLine, bestLine, areaPath, min, max } = useMemo(() => {
    if (withPrice.length === 0) {
      return {
        minLine: { path: "", coords: [] as { x: number; y: number; idx: number }[] },
        bestLine: { path: "", coords: [] as { x: number; y: number; idx: number }[] },
        areaPath: "",
        min: 0,
        max: 0,
      };
    }
    const allValues = withPrice.flatMap((p) =>
      [p.min_price_cents, p.best_price_cents].filter((v): v is number => v !== null)
    );
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const minLine = buildSeries(withPrice, (p) => p.min_price_cents, min, max);
    const bestLine = buildSeries(withPrice, (p) => p.best_price_cents, min, max);
    const areaPath = minLine.path
      ? `${minLine.path} L ${minLine.coords[minLine.coords.length - 1].x} 100 L ${minLine.coords[0].x} 100 Z`
      : "";
    return { minLine, bestLine, areaPath, min, max };
  }, [withPrice]);

  if (withPrice.length === 0) {
    return (
      <div className="rounded-card border border-base-border bg-base-surface p-8 text-center text-ink-muted">
        Ancora nessuno storico prezzi per questa carta. Torna dopo il prossimo aggiornamento
        giornaliero.
      </div>
    );
  }

  const active = hoverIdx !== null ? withPrice[hoverIdx] : withPrice[withPrice.length - 1];

  // Prima l'unica interazione era onMouseEnter su rettangoli invisibili per
  // colonna - funzionava solo col mouse, su touch il grafico era di fatto
  // statico (mostrava sempre e solo l'ultimo punto). Qui invece la
  // posizione del puntatore su TUTTO l'svg determina l'indice piu' vicino,
  // con Pointer Events (copre mouse/touch/pen con lo stesso codice).
  function indexFromClientX(clientX: number): number {
    const svg = svgRef.current;
    if (!svg || withPrice.length <= 1) return 0;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return 0;
    const px = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(px * (withPrice.length - 1));
  }

  function scrubTo(clientX: number) {
    setHoverIdx(indexFromClientX(clientX));
  }

  function handlePointerDown(event: React.PointerEvent<SVGSVGElement>) {
    scrubTo(event.clientX);
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    // Il mouse segue il semplice passaggio (hover), come prima; su
    // touch/pen non esiste un equivalente "hover senza toccare" - serve un
    // tocco attivo (buttons===1, il dito ancora sullo schermo) per
    // scorrere lo storico trascinando.
    if (event.pointerType === "mouse" || event.buttons === 1) scrubTo(event.clientX);
  }

  function handlePointerLeave(event: React.PointerEvent<SVGSVGElement>) {
    if (event.pointerType === "mouse") setHoverIdx(null);
  }

  function handleKeyDown(event: React.KeyboardEvent<SVGSVGElement>) {
    if (withPrice.length === 0) return;
    const current = hoverIdx ?? withPrice.length - 1;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setHoverIdx(Math.max(0, current - 1));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setHoverIdx(Math.min(withPrice.length - 1, current + 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setHoverIdx(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setHoverIdx(withPrice.length - 1);
    } else if (event.key === "Escape") {
      setHoverIdx(null);
    }
  }

  return (
    <div className="rounded-card border border-base-border bg-base-surface p-5">
      <div className="flex items-baseline justify-between mb-4 flex-wrap gap-x-4 gap-y-2">
        <div>
          <div className="text-xs uppercase tracking-wider text-ink-muted font-mono">
            {hoverIdx !== null ? formatDateLong(active.captured_at) : "Prezzo più recente"}
          </div>
          <div className="flex items-baseline gap-3 flex-wrap mt-0.5">
            <div className="font-display text-3xl font-bold text-ink-primary">
              {formatCents(active.min_price_cents, currency)}
            </div>
            <div className="text-xs font-mono text-ink-faint">più basso in assoluto</div>
          </div>
          {active.best_price_cents !== null && (
            <div className="flex items-baseline gap-2 flex-wrap mt-1">
              <div className="font-display text-lg font-bold text-accent-bright">
                {formatCents(active.best_price_cents, currency)}
              </div>
              <div className="text-xs font-mono text-ink-faint">Near Mint · CardTrader Zero</div>
            </div>
          )}
        </div>
        <div className="text-right text-xs text-ink-muted font-mono">
          <div>min {formatCents(min, currency)}</div>
          <div>max {formatCents(max, currency)}</div>
        </div>
      </div>

      {hasBest && (
        <div className="flex items-center gap-4 mb-3 text-[11px] font-mono text-ink-faint">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5 bg-[#2DD8C9]" /> più basso in assoluto
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5 bg-accent-bright" /> Near Mint · Zero
          </span>
        </div>
      )}

      <svg
        ref={svgRef}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="w-full h-40 overflow-visible touch-pan-y cursor-crosshair rounded outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
        role="img"
        tabIndex={0}
        aria-label={`Andamento prezzo. Punto selezionato: ${formatDateLong(active.captured_at)}, ${formatCents(active.min_price_cents, currency)}. Trascina o usa le frecce sinistra/destra per scorrere lo storico.`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onKeyDown={handleKeyDown}
      >
        <defs>
          <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2DD8C9" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#2DD8C9" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#areaFill)" stroke="none" />
        <path
          className="price-line"
          d={minLine.path}
          pathLength={1}
          fill="none"
          stroke="#2DD8C9"
          strokeWidth="1.4"
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ "--line-length": 1 } as React.CSSProperties}
        />
        {bestLine.path && (
          <path
            d={bestLine.path}
            pathLength={1}
            fill="none"
            stroke="#F5A623"
            strokeWidth="1.2"
            strokeDasharray="2.5 2"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {hoverIdx !== null && (
          <line
            x1={xForIndex(hoverIdx, withPrice.length)}
            x2={xForIndex(hoverIdx, withPrice.length)}
            y1={0}
            y2={100}
            stroke="#565C63"
            strokeWidth="0.5"
            strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {hoverIdx !== null && minLine.coords.find((c) => c.idx === hoverIdx) && (
          <circle
            cx={minLine.coords.find((c) => c.idx === hoverIdx)!.x}
            cy={minLine.coords.find((c) => c.idx === hoverIdx)!.y}
            r="1.8"
            fill="#5FF0E3"
          />
        )}
        {hoverIdx !== null && bestLine.coords.find((c) => c.idx === hoverIdx) && (
          <circle
            cx={bestLine.coords.find((c) => c.idx === hoverIdx)!.x}
            cy={bestLine.coords.find((c) => c.idx === hoverIdx)!.y}
            r="1.6"
            fill="#F5A623"
          />
        )}
      </svg>

      <div className="flex justify-between mt-2 text-[11px] font-mono text-ink-faint">
        <span>{formatDate(withPrice[0].captured_at)}</span>
        <span>{formatDate(withPrice[withPrice.length - 1].captured_at)}</span>
      </div>
      {withPrice.length > 1 && (
        <p className="sm:hidden mt-2 text-center text-[10px] text-ink-faint">
          Trascina sul grafico per scorrere lo storico
        </p>
      )}
    </div>
  );
}

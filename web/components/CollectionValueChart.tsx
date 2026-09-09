"use client";

import { useMemo, useRef, useState } from "react";
import type { BinderValuePoint } from "@/lib/types";
import { formatCents, formatDate, formatDateLong } from "@/lib/format";

/** Stessa idea di xForIndex in PriceChart.tsx (un solo punto va al centro,
 * altrimenti distribuito linearmente) - qui su una singola serie, niente
 * bisogno del confronto multi-serie che giustifica quella versione. */
function xForIndex(idx: number, total: number): number {
  return total <= 1 ? 50 : (idx / (total - 1)) * 100;
}

export default function CollectionValueChart({ points }: { points: BinderValuePoint[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const { path, areaPath, coords, min, max } = useMemo(() => {
    if (points.length === 0) {
      return { path: "", areaPath: "", coords: [] as { x: number; y: number }[], min: 0, max: 0 };
    }
    const values = points.map((p) => p.total_cents);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const h = 100;
    const coords = points.map((p, idx) => ({
      x: xForIndex(idx, points.length),
      y: h - ((p.total_cents - min) / span) * (h - 20) - 10,
    }));
    const path = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`).join(" ");
    const areaPath = path ? `${path} L ${coords[coords.length - 1].x} 100 L ${coords[0].x} 100 Z` : "";
    return { path, areaPath, coords, min, max };
  }, [points]);

  // Meno di 2 punti: non c'e' ancora un andamento da disegnare (un punto
  // solo, o nessuno il primissimo giorno prima del sync notturno) - un
  // messaggio invece di un grafico vuoto/piatto che sembrerebbe un bug.
  if (points.length < 2) {
    return (
      <div className="rounded-card border border-base-border bg-base-surface p-5 text-center text-ink-muted text-sm">
        {points.length === 0
          ? "Il valore della tua collezione inizia a essere tracciato da oggi: torna nei prossimi giorni per vedere l'andamento."
          : "Ancora un solo punto raccolto: l'andamento comparirà dal prossimo aggiornamento giornaliero."}
      </div>
    );
  }

  const active = hoverIdx !== null ? points[hoverIdx] : points[points.length - 1];
  const first = points[0];
  const deltaCents = active.total_cents - first.total_cents;
  const deltaPct = first.total_cents !== 0 ? (deltaCents / first.total_cents) * 100 : null;

  function indexFromClientX(clientX: number): number {
    const svg = svgRef.current;
    if (!svg) return 0;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return 0;
    const px = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(px * (points.length - 1));
  }

  function scrubTo(clientX: number) {
    setHoverIdx(indexFromClientX(clientX));
  }

  function handleKeyDown(event: React.KeyboardEvent<SVGSVGElement>) {
    const current = hoverIdx ?? points.length - 1;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setHoverIdx(Math.max(0, current - 1));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setHoverIdx(Math.min(points.length - 1, current + 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setHoverIdx(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setHoverIdx(points.length - 1);
    } else if (event.key === "Escape") {
      setHoverIdx(null);
    }
  }

  return (
    <div className="rounded-card border border-base-border bg-base-surface p-5">
      <div className="flex items-baseline justify-between mb-4 flex-wrap gap-x-4 gap-y-2">
        <div>
          <div className="text-xs uppercase tracking-wider text-ink-muted font-mono">
            {hoverIdx !== null ? formatDateLong(active.captured_at) : "Valore più recente"}
          </div>
          <div className="flex items-baseline gap-3 flex-wrap mt-0.5">
            <div className="font-display text-3xl font-bold text-ink-primary">
              {formatCents(active.total_cents, active.currency ?? "EUR")}
            </div>
            {deltaPct !== null && (
              <div className={`text-xs font-mono ${deltaCents >= 0 ? "text-signal-up" : "text-signal-down"}`}>
                {deltaCents >= 0 ? "+" : ""}
                {deltaPct.toFixed(1)}% da {formatDate(first.captured_at)}
              </div>
            )}
          </div>
          <div className="text-xs font-mono text-ink-faint mt-1">
            {active.priced_count}/{active.cards_count} carte con prezzo
          </div>
        </div>
        <div className="text-right text-xs text-ink-muted font-mono">
          <div>min {formatCents(min, active.currency ?? "EUR")}</div>
          <div>max {formatCents(max, active.currency ?? "EUR")}</div>
        </div>
      </div>

      <svg
        ref={svgRef}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="w-full h-40 overflow-visible touch-pan-y cursor-crosshair rounded outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
        role="img"
        tabIndex={0}
        aria-label={`Andamento valore collezione. Punto selezionato: ${formatDateLong(active.captured_at)}, ${formatCents(active.total_cents, active.currency ?? "EUR")}. Trascina o usa le frecce sinistra/destra per scorrere lo storico.`}
        onPointerDown={(e) => scrubTo(e.clientX)}
        onPointerMove={(e) => {
          if (e.pointerType === "mouse" || e.buttons === 1) scrubTo(e.clientX);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setHoverIdx(null);
        }}
        onKeyDown={handleKeyDown}
      >
        <defs>
          <linearGradient id="binderValueFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2DD8C9" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#2DD8C9" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#binderValueFill)" stroke="none" />
        <path
          d={path}
          fill="none"
          stroke="#2DD8C9"
          strokeWidth="1.4"
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {hoverIdx !== null && (
          <line
            x1={xForIndex(hoverIdx, points.length)}
            x2={xForIndex(hoverIdx, points.length)}
            y1={0}
            y2={100}
            stroke="#565C63"
            strokeWidth="0.5"
            strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {hoverIdx !== null && coords[hoverIdx] && (
          <circle cx={coords[hoverIdx].x} cy={coords[hoverIdx].y} r="1.8" fill="#5FF0E3" />
        )}
      </svg>

      <div className="flex justify-between mt-2 text-[11px] font-mono text-ink-faint">
        <span>{formatDate(first.captured_at)}</span>
        <span>{formatDate(points[points.length - 1].captured_at)}</span>
      </div>
      <p className="sm:hidden mt-2 text-center text-[10px] text-ink-faint">
        Trascina sul grafico per scorrere lo storico
      </p>
    </div>
  );
}

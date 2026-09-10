"use client";

import { useMemo, useRef, useState } from "react";
import type { BinderValuePoint } from "@/lib/types";
import { formatCents, formatDate, formatDateLong } from "@/lib/format";
import { areaPath, monotonePath, xForDate, yForValue } from "@/lib/chartGeometry";

const DAY_MS = 86_400_000;

// Stesso set di preset di PriceChart.tsx (web/components/PriceChart.tsx) -
// qui la duplicazione e' voluta: e' un array di dati banale, non logica,
// e i due grafici filtrano periodi leggermente diversi (allWithPrice vs
// points grezzi) per motivi propri a ciascuno.
const RANGE_PRESETS = [
  { days: 30, label: "30g" },
  { days: 90, label: "90g" },
  { days: 180, label: "6 mesi" },
  { days: 365, label: "1 anno" },
] as const;

export default function CollectionValueChart({ points }: { points: BinderValuePoint[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [rangeDays, setRangeDays] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Solo i preset che accorciano davvero la vista rispetto allo storico
  // completo (margine di 2 giorni) - su un binder tracciato da pochi
  // giorni "1 anno" sarebbe identico a "Tutto".
  const availablePresets = useMemo(() => {
    if (points.length < 2) return [];
    const spanDays =
      (Date.parse(points[points.length - 1].captured_at) - Date.parse(points[0].captured_at)) / DAY_MS;
    return RANGE_PRESETS.filter((preset) => preset.days < spanDays - 2);
  }, [points]);

  const filteredPoints = useMemo(() => {
    if (rangeDays === null || points.length === 0) return points;
    const cutoff = Date.parse(points[points.length - 1].captured_at) - rangeDays * DAY_MS;
    return points.filter((p) => Date.parse(p.captured_at) >= cutoff);
  }, [points, rangeDays]);

  function selectRange(days: number | null) {
    setRangeDays(days);
    setHoverIdx(null);
  }

  const { path, areaFillPath, coords, min, max, minMs, maxMs } = useMemo(() => {
    if (filteredPoints.length === 0) {
      return { path: "", areaFillPath: "", coords: [] as { x: number; y: number }[], min: 0, max: 0, minMs: 0, maxMs: 0 };
    }
    const values = filteredPoints.map((p) => p.total_cents);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const minMs = Date.parse(filteredPoints[0].captured_at);
    const maxMs = Date.parse(filteredPoints[filteredPoints.length - 1].captured_at);
    const coords = filteredPoints.map((p) => ({
      x: xForDate(Date.parse(p.captured_at), minMs, maxMs),
      y: yForValue(p.total_cents, min, max),
    }));
    const path = monotonePath(coords);
    return { path, areaFillPath: areaPath(path, coords), coords, min, max, minMs, maxMs };
  }, [filteredPoints]);

  // Meno di 2 punti in ASSOLUTO (non solo nel periodo filtrato): non c'e'
  // ancora nessun andamento da disegnare in nessuna vista, quindi niente
  // da guadagnare a mostrare comunque il selettore di periodo (sarebbe
  // vuoto - availablePresets richiede anch'esso points.length >= 2).
  if (points.length < 2) {
    return (
      <div className="rounded-card border border-base-border bg-base-surface p-5 text-center text-ink-muted text-sm">
        {points.length === 0
          ? "Il valore della tua collezione inizia a essere tracciato da oggi: torna nei prossimi giorni per vedere l'andamento."
          : "Ancora un solo punto raccolto: l'andamento comparirà dal prossimo aggiornamento giornaliero."}
      </div>
    );
  }

  // Il periodo filtrato invece PUO' scendere sotto i 2 punti (es. "30g" su
  // un binder che ha aggiunto la prima carta 10 giorni fa) pur avendo
  // punti sufficienti nello storico completo: qui la barra dei periodi
  // resta visibile (rilievo review Gemini su PR #43 - prima restava
  // bloccata fuori, senza modo di tornare a "Tutto" se non ricaricando).
  const hasChartData = filteredPoints.length >= 2;

  const active = hoverIdx !== null ? filteredPoints[hoverIdx] : filteredPoints[filteredPoints.length - 1];
  const first = filteredPoints[0];
  const deltaCents = active.total_cents - first.total_cents;
  const deltaPct = first.total_cents !== 0 ? (deltaCents / first.total_cents) * 100 : null;
  const activeCoord = {
    x: xForDate(Date.parse(active.captured_at), minMs, maxMs),
    y: yForValue(active.total_cents, min, max),
  };
  const lastCoord = coords[coords.length - 1];

  function indexFromClientX(clientX: number): number {
    const svg = svgRef.current;
    if (!svg || coords.length === 0) return 0;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return 0;
    const targetX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * 100;
    let nearest = 0;
    let nearestDist = Infinity;
    coords.forEach((c, i) => {
      const dist = Math.abs(c.x - targetX);
      if (dist < nearestDist) { nearestDist = dist; nearest = i; }
    });
    return nearest;
  }

  function scrubTo(clientX: number) {
    setHoverIdx(indexFromClientX(clientX));
  }

  function handleKeyDown(event: React.KeyboardEvent<SVGSVGElement>) {
    const current = hoverIdx ?? filteredPoints.length - 1;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setHoverIdx(Math.max(0, current - 1));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setHoverIdx(Math.min(filteredPoints.length - 1, current + 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setHoverIdx(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setHoverIdx(filteredPoints.length - 1);
    } else if (event.key === "Escape") {
      setHoverIdx(null);
    }
  }

  const revealKey = `${rangeDays ?? "all"}-${filteredPoints.length}`;

  return (
    <div className="rounded-card border border-base-border bg-base-surface p-5">
      {availablePresets.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-4" role="group" aria-label="Periodo storico">
          {availablePresets.map((preset) => (
            <button
              key={preset.days}
              type="button"
              aria-pressed={rangeDays === preset.days}
              onClick={() => selectRange(preset.days)}
              className={`min-h-8 text-xs px-2.5 py-1 rounded-full border transition-colors active:scale-95 ${
                rangeDays === preset.days
                  ? "bg-accent/10 border-accent/60 text-accent-bright"
                  : "bg-base-surface2 border-base-border text-ink-muted hover:text-ink-primary"
              }`}
            >
              {preset.label}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={rangeDays === null}
            onClick={() => selectRange(null)}
            className={`min-h-8 text-xs px-2.5 py-1 rounded-full border transition-colors active:scale-95 ${
              rangeDays === null
                ? "bg-accent/10 border-accent/60 text-accent-bright"
                : "bg-base-surface2 border-base-border text-ink-muted hover:text-ink-primary"
            }`}
          >
            Tutto
          </button>
        </div>
      )}

      {!hasChartData && (
        <p className="text-center text-xs text-ink-faint py-8">
          Solo un punto in questo periodo — prova &quot;Tutto&quot; o un periodo più ampio.
        </p>
      )}

      <div className={hasChartData ? "flex items-baseline justify-between mb-4 flex-wrap gap-x-4 gap-y-2" : "hidden"}>
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
        style={{ display: hasChartData ? undefined : "none" }}
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
            <stop offset="0%" stopColor="#2DD8C9" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#2DD8C9" stopOpacity="0" />
          </linearGradient>
        </defs>

        <g key={revealKey}>
          <path d={areaFillPath} fill="url(#binderValueFill)" stroke="none" />
          <path
            className="price-line"
            d={path}
            pathLength={1}
            fill="none"
            stroke="#2DD8C9"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ "--line-length": 1 } as React.CSSProperties}
          />
          {hoverIdx === null && (
            <>
              <circle cx={lastCoord.x} cy={lastCoord.y} r="3" fill="none" stroke="#5FF0E3" strokeWidth="1.5" className="chart-pulse-ring" />
              <circle cx={lastCoord.x} cy={lastCoord.y} r="1.8" fill="#5FF0E3" />
            </>
          )}
        </g>

        {hoverIdx !== null && (
          <>
            <line
              x1={activeCoord.x} x2={activeCoord.x} y1={0} y2={100}
              stroke="#565C63" strokeWidth="1" vectorEffect="non-scaling-stroke"
            />
            <circle cx={activeCoord.x} cy={activeCoord.y} r="1.8" fill="none" stroke="#16191D" strokeWidth="4" vectorEffect="non-scaling-stroke" />
            <circle cx={activeCoord.x} cy={activeCoord.y} r="1.8" fill="#5FF0E3" />
          </>
        )}
      </svg>

      {hasChartData && (
        <>
          <div className="flex justify-between mt-2 text-[11px] font-mono text-ink-faint">
            <span>{formatDate(first.captured_at)}</span>
            <span>{formatDate(filteredPoints[filteredPoints.length - 1].captured_at)}</span>
          </div>
          <p className="sm:hidden mt-2 text-center text-[10px] text-ink-faint">
            Trascina sul grafico per scorrere lo storico
          </p>
        </>
      )}
    </div>
  );
}

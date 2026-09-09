"use client";

import { useMemo, useRef, useState } from "react";
import { PricePoint } from "@/lib/db";
import { formatCents, formatDate, formatDateLong } from "@/lib/format";
import { areaPath, monotonePath, xForDate, yForValue, type ChartCoord } from "@/lib/chartGeometry";

const DAY_MS = 86_400_000;

// Preset mostrati solo se accorciano davvero la vista (vedi availablePresets
// sotto) - su una carta con pochi giorni di storico non avrebbe senso
// offrire "1 anno" identico a "Tutto".
const RANGE_PRESETS = [
  { days: 30, label: "30g" },
  { days: 90, label: "90g" },
  { days: 180, label: "6 mesi" },
  { days: 365, label: "1 anno" },
] as const;

type Series = "min" | "exact";

/** Campione di linea per la legenda - una vera linea SVG (tratteggiata o
 * continua a seconda della serie), non una casella colorata: alla densita'
 * di una legenda una casella piena e' inchiostro-dato che non serve a
 * un'etichetta (vedi dataviz skill, "line keys not boxes"). */
function LineKey({ color, dashed }: { color: string; dashed?: boolean }) {
  return (
    <svg width="18" height="8" viewBox="0 0 18 8" aria-hidden="true" className="shrink-0">
      <line
        x1="1" y1="4" x2="17" y2="4"
        stroke={color} strokeWidth="2" strokeLinecap="round"
        strokeDasharray={dashed ? "3 2.4" : undefined}
      />
    </svg>
  );
}

export default function PriceChart({
  points,
  currency,
}: {
  points: PricePoint[];
  currency: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [rangeDays, setRangeDays] = useState<number | null>(null);
  const [hiddenSeries, setHiddenSeries] = useState<Set<Series>>(new Set());
  const svgRef = useRef<SVGSVGElement>(null);

  const allWithPrice = useMemo(() => points.filter((p) => p.min_price_cents !== null), [points]);

  // Solo i preset che tagliano davvero qualcosa rispetto allo storico
  // completo (con un margine di 2 giorni, altrimenti "1 anno" su una carta
  // che ne ha 367 di storico sarebbe indistinguibile da "Tutto").
  const availablePresets = useMemo(() => {
    if (allWithPrice.length < 2) return [];
    const spanDays =
      (Date.parse(allWithPrice[allWithPrice.length - 1].captured_at) - Date.parse(allWithPrice[0].captured_at)) /
      DAY_MS;
    return RANGE_PRESETS.filter((preset) => preset.days < spanDays - 2);
  }, [allWithPrice]);

  const filteredPoints = useMemo(() => {
    if (rangeDays === null || allWithPrice.length === 0) return points;
    const cutoff = Date.parse(allWithPrice[allWithPrice.length - 1].captured_at) - rangeDays * DAY_MS;
    return points.filter((p) => Date.parse(p.captured_at) >= cutoff);
  }, [points, rangeDays, allWithPrice]);

  const withPrice = useMemo(() => filteredPoints.filter((p) => p.min_price_cents !== null), [filteredPoints]);
  const hasExact = withPrice.some((p) => p.it_nm_zero_price_cents !== null);

  // Cambiare periodo azzera sempre hoverIdx (vedi selectRange sotto): un
  // indice rimasto dalla selezione precedente potrebbe puntare fuori dal
  // nuovo array, o su un giorno diverso da quello che l'utente pensa.
  function selectRange(days: number | null) {
    setRangeDays(days);
    setHoverIdx(null);
  }

  const { minPath, minCoords, exactPath, minV, maxV, minMs, maxMs } = useMemo(() => {
    if (withPrice.length === 0) {
      return {
        minPath: "", minCoords: [] as ChartCoord[], exactPath: "",
        minV: 0, maxV: 0, minMs: 0, maxMs: 0,
      };
    }
    const minMs = Date.parse(withPrice[0].captured_at);
    const maxMs = Date.parse(withPrice[withPrice.length - 1].captured_at);
    const allValues = withPrice.flatMap((p) =>
      [p.min_price_cents, p.it_nm_zero_price_cents].filter((v): v is number => v !== null)
    );
    const minV = Math.min(...allValues);
    const maxV = Math.max(...allValues);
    const minCoords = withPrice.map((p) => ({
      x: xForDate(Date.parse(p.captured_at), minMs, maxMs),
      y: yForValue(p.min_price_cents as number, minV, maxV),
    }));
    const exactCoords = withPrice
      .filter((p) => p.it_nm_zero_price_cents !== null)
      .map((p) => ({
        x: xForDate(Date.parse(p.captured_at), minMs, maxMs),
        y: yForValue(p.it_nm_zero_price_cents as number, minV, maxV),
      }));
    return {
      minPath: monotonePath(minCoords), minCoords,
      exactPath: monotonePath(exactCoords),
      minV, maxV, minMs, maxMs,
    };
  }, [withPrice]);

  const areaFillPath = useMemo(() => areaPath(minPath, minCoords), [minPath, minCoords]);

  if (withPrice.length === 0) {
    return (
      <div className="rounded-card border border-base-border bg-base-surface p-8 text-center text-ink-muted">
        Ancora nessuno storico prezzi per questa carta. Torna dopo il prossimo aggiornamento
        giornaliero.
      </div>
    );
  }

  const active = hoverIdx !== null ? withPrice[hoverIdx] : withPrice[withPrice.length - 1];
  const activeMinCoord = {
    x: xForDate(Date.parse(active.captured_at), minMs, maxMs),
    y: yForValue(active.min_price_cents as number, minV, maxV),
  };
  const activeExactCoord =
    active.it_nm_zero_price_cents !== null
      ? { x: activeMinCoord.x, y: yForValue(active.it_nm_zero_price_cents, minV, maxV) }
      : null;
  const lastMinCoord = minCoords[minCoords.length - 1];

  function indexFromClientX(clientX: number): number {
    const svg = svgRef.current;
    if (!svg || minCoords.length === 0) return 0;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return 0;
    const targetX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * 100;
    // Trova il punto piu' vicino in X: con la spaziatura per data reale
    // (non per indice) i punti non sono equidistanti, quindi non si puo'
    // piu' dedurre l'indice con un semplice arrotondamento della frazione.
    let nearest = 0;
    let nearestDist = Infinity;
    minCoords.forEach((c, i) => {
      const dist = Math.abs(c.x - targetX);
      if (dist < nearestDist) { nearestDist = dist; nearest = i; }
    });
    return nearest;
  }

  function scrubTo(clientX: number) {
    setHoverIdx(indexFromClientX(clientX));
  }

  function handlePointerDown(event: React.PointerEvent<SVGSVGElement>) {
    scrubTo(event.clientX);
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (event.pointerType === "mouse" || event.buttons === 1) scrubTo(event.clientX);
  }

  function handlePointerLeave(event: React.PointerEvent<SVGSVGElement>) {
    if (event.pointerType === "mouse") setHoverIdx(null);
  }

  function handleKeyDown(event: React.KeyboardEvent<SVGSVGElement>) {
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

  function toggleSeries(series: Series) {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(series)) next.delete(series); else next.add(series);
      return next;
    });
  }

  // Rimonta il contenuto del grafico quando cambia il periodo, cosi' il
  // disegno progressivo della linea (.price-line, gia' esistente) e la
  // dissolvenza della serie esatta ripartono da capo invece di restare
  // fermi sullo stato "gia' disegnato" della selezione precedente.
  const revealKey = `${rangeDays ?? "all"}-${withPrice.length}`;

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
          {activeExactCoord !== null ? (
            <div className="flex items-center gap-2 flex-wrap mt-1">
              <LineKey color="#F5A623" dashed />
              <div className="font-display text-lg font-bold text-ink-primary">
                {formatCents(active.it_nm_zero_price_cents, currency)}
              </div>
              <div className="text-xs font-mono text-ink-faint">Italiano · Near Mint · CardTrader Zero</div>
            </div>
          ) : hasExact && (
            <div className="text-xs font-mono text-ink-faint mt-1">
              Nessuna offerta IT NM Zero rilevata in questo giorno
            </div>
          )}
          <div className="text-xs font-mono text-ink-faint mt-1.5">
            {active.listings_count} inserzion{active.listings_count === 1 ? "e" : "i"} quel giorno
          </div>
        </div>
        <div className="text-right text-xs text-ink-muted font-mono">
          <div>min {formatCents(minV, currency)}</div>
          <div>max {formatCents(maxV, currency)}</div>
        </div>
      </div>

      {hasExact && (
        <div className="flex items-center gap-4 mb-3 text-[11px] font-mono">
          <button
            type="button"
            onClick={() => toggleSeries("min")}
            aria-pressed={!hiddenSeries.has("min")}
            className={`inline-flex items-center gap-1.5 transition-opacity hover:opacity-80 ${
              hiddenSeries.has("min") ? "opacity-40" : ""
            }`}
          >
            <LineKey color="#2DD8C9" />
            <span className="text-ink-faint">più basso in assoluto</span>
          </button>
          <button
            type="button"
            onClick={() => toggleSeries("exact")}
            aria-pressed={!hiddenSeries.has("exact")}
            className={`inline-flex items-center gap-1.5 transition-opacity hover:opacity-80 ${
              hiddenSeries.has("exact") ? "opacity-40" : ""
            }`}
          >
            <LineKey color="#F5A623" dashed />
            <span className="text-ink-faint">Italiano · Near Mint · Zero</span>
          </button>
        </div>
      )}

      <svg
        ref={svgRef}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="w-full h-40 sm:h-48 overflow-visible touch-pan-y cursor-crosshair rounded outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
        role="img"
        tabIndex={0}
        aria-label={`Andamento prezzo. Punto selezionato: ${formatDateLong(active.captured_at)}, ${formatCents(active.min_price_cents, currency)}, ${active.listings_count} inserzioni. Trascina o usa le frecce sinistra/destra per scorrere lo storico.`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onKeyDown={handleKeyDown}
      >
        <defs>
          <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2DD8C9" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#2DD8C9" stopOpacity="0" />
          </linearGradient>
        </defs>

        <g key={revealKey}>
          {!hiddenSeries.has("min") && <path d={areaFillPath} fill="url(#areaFill)" stroke="none" />}

          {!hiddenSeries.has("min") && (
            <path
              className="price-line"
              d={minPath}
              pathLength={1}
              fill="none"
              stroke="#2DD8C9"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ "--line-length": 1 } as React.CSSProperties}
            />
          )}

          {!hiddenSeries.has("exact") && exactPath && (
            <path
              className="chart-fade-in"
              d={exactPath}
              fill="none"
              stroke="#F5A623"
              strokeWidth="1.5"
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Punto "live" sull'ultimo prezzo noto, solo quando non si sta
              scorrendo lo storico - richiama un ticker azionario, segnala
              che quello e' il dato piu' recente senza bisogno di leggerlo
              da un'etichetta. Disattivato sotto prefers-reduced-motion
              (vedi globals.css), il pallino pieno resta comunque visibile. */}
          {hoverIdx === null && !hiddenSeries.has("min") && (
            <>
              <circle cx={lastMinCoord.x} cy={lastMinCoord.y} r="3" fill="none" stroke="#5FF0E3" strokeWidth="1.5" className="chart-pulse-ring" />
              <circle cx={lastMinCoord.x} cy={lastMinCoord.y} r="1.8" fill="#5FF0E3" />
            </>
          )}
        </g>

        {hoverIdx !== null && (
          <line
            x1={activeMinCoord.x} x2={activeMinCoord.x} y1={0} y2={100}
            stroke="#565C63" strokeWidth="1" vectorEffect="non-scaling-stroke"
          />
        )}
        {hoverIdx !== null && !hiddenSeries.has("min") && (
          <>
            {/* Anello nel colore della superficie: lo stesso principio dei
                marker "surface ring" - stroke non-scaling anziche' fill,
                cosi' resta uno spessore costante in pixel reali qualunque
                sia la scala del viewBox, e il punto resta leggibile anche
                sopra l'area riempita. */}
            <circle cx={activeMinCoord.x} cy={activeMinCoord.y} r="1.8" fill="none" stroke="#16191D" strokeWidth="4" vectorEffect="non-scaling-stroke" />
            <circle cx={activeMinCoord.x} cy={activeMinCoord.y} r="1.8" fill="#5FF0E3" />
          </>
        )}
        {hoverIdx !== null && activeExactCoord !== null && !hiddenSeries.has("exact") && (
          <>
            <circle cx={activeExactCoord.x} cy={activeExactCoord.y} r="1.6" fill="none" stroke="#16191D" strokeWidth="4" vectorEffect="non-scaling-stroke" />
            <circle cx={activeExactCoord.x} cy={activeExactCoord.y} r="1.6" fill="#F5A623" />
          </>
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
      <p className="mt-3 text-[10px] text-ink-faint/70">
        Un punto al giorno, non in tempo reale — il marketplace CardTrader può inoltre avere una breve cache lato loro tra un aggiornamento e l&apos;altro.
      </p>
    </div>
  );
}

"use client";

import { useId, useMemo, useRef, useState } from "react";
import type { BinderValuePoint } from "@/lib/types";
import { formatCents, formatDate, formatDateLong } from "@/lib/format";
import { areaPath, monotonePath, xForDate, yForValue } from "@/lib/chartGeometry";
import { collectionHistoryCsv, historyInRange, normalizeCollectionHistory } from "@/lib/collectionHistory";

const DAY_MS = 86_400_000;
const PRESETS = [
  { days: 1, label: "1g" }, { days: 7, label: "7g" },
  { days: 30, label: "1 mese" }, { days: 90, label: "3 mesi" },
  { days: 180, label: "6 mesi" }, { days: 365, label: "1 anno" },
];
const buttonClass = "min-h-11 rounded-lg border px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70";

export default function CollectionValueChart({ points }: { points: BinderValuePoint[] }) {
  const id = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [rangeDays, setRangeDays] = useState<number | null>(null);
  const [baselineDate, setBaselineDate] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const history = useMemo(() => normalizeCollectionHistory(points), [points]);
  const oldest = history[0]?.captured_at ?? "";
  const newest = history.at(-1)?.captured_at ?? "";
  const from = range?.from ?? oldest;
  const to = range?.to ?? newest;
  const visible = useMemo(() => historyInRange(history, from, to), [history, from, to]);
  const comparable = new Set(visible.map((point) => point.currency ?? "EUR")).size <= 1;
  const min = visible.length ? Math.min(...visible.map((point) => point.total_cents)) : 0;
  const max = visible.length ? Math.max(...visible.map((point) => point.total_cents)) : 0;
  const firstMs = Date.parse(visible[0]?.captured_at ?? "");
  const lastMs = Date.parse(visible.at(-1)?.captured_at ?? "");
  const coords = visible.map((point) => ({
    x: xForDate(Date.parse(point.captured_at), firstMs, lastMs),
    y: yForValue(point.total_cents, min, max),
  }));
  const path = comparable ? monotonePath(coords) : "";
  const activeIndex = Math.max(0, Math.min(hoverIdx ?? visible.length - 1, visible.length - 1));
  const active = visible[activeIndex];
  const baseline = visible.find((point) => point.captured_at === baselineDate) ?? visible[0];
  const delta = active && baseline ? active.total_cents - baseline.total_cents : 0;
  const deltaPct = baseline?.total_cents ? delta / baseline.total_cents * 100 : null;
  const historyMin = history.length ? Math.min(...history.map((point) => point.total_cents)) : 0;
  const historyMax = history.length ? Math.max(...history.map((point) => point.total_cents)) : 0;
  const overviewPath = monotonePath(history.map((point) => ({
    x: xForDate(Date.parse(point.captured_at), Date.parse(oldest), Date.parse(newest)),
    y: yForValue(point.total_cents, historyMin, historyMax),
  })));
  const fromIndex = history.findIndex((point) => point.captured_at >= from);
  const firstIndex = fromIndex < 0 ? Math.max(0, history.length - 1) : fromIndex;
  const lastIndex = Math.max(firstIndex, history.findLastIndex((point) => point.captured_at <= to));

  function changeRange(next: { from: string; to: string } | null, days: number | null = null) {
    setRange(next);
    setRangeDays(days);
    setHoverIdx(null);
    setBaselineDate(null);
  }

  function selectRange(days: number | null) {
    changeRange(days === null ? null : {
      from: new Date(Math.max(Date.parse(oldest), Date.parse(newest) - days * DAY_MS)).toISOString().slice(0, 10), to: newest,
    }, days);
  }

  function scrubTo(clientX: number) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect?.width || !coords.length) return;
    const target = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * 100;
    let nearest = 0;
    coords.forEach((point, index) => {
      if (Math.abs(point.x - target) < Math.abs(coords[nearest].x - target)) nearest = index;
    });
    setHoverIdx(nearest);
  }

  function handleKey(event: React.KeyboardEvent<SVGSVGElement>) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      setHoverIdx(Math.max(0, Math.min(visible.length - 1, activeIndex + (event.key === "ArrowLeft" ? -1 : 1))));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setHoverIdx(event.key === "Home" ? 0 : visible.length - 1);
    } else if (event.key === "Escape") {
      setHoverIdx(null);
      setBaselineDate(null);
    }
  }

  function exportCsv() {
    const url = URL.createObjectURL(new Blob(["\uFEFF", collectionHistoryCsv(visible)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `binder-${from}-${to}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section aria-label="Storico del valore del binder" className="rounded-card border border-base-border bg-base-surface p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="font-display text-lg font-bold">Valore nel tempo</h2>
          <p id={`${id}-help`} className="text-xs text-ink-muted mt-1 max-w-2xl">
            La variazione include carte aggiunte o rimosse e cambi di quotazione. Non misura il guadagno sugli acquisti.
          </p>
        </div>
        {history.length > 0 && <div className="flex gap-2">
          <button type="button" onClick={() => setExpanded(!expanded)} aria-pressed={expanded}
            className={`${buttonClass} border-base-border text-ink-muted`}>{expanded ? "Compatto" : "Espandi"}</button>
          <button type="button" onClick={exportCsv} disabled={!visible.length}
            className={`${buttonClass} border-base-border text-ink-muted disabled:opacity-40`}>Esporta CSV</button>
        </div>}
      </div>
      {history.length === 0 ? <p className="py-7 text-center text-sm text-ink-muted" role="status">
        Nessuna rilevazione disponibile. Lo storico comparirà dopo un sync completato con carte nel binder dell’account.
      </p> : <>
        <div className="flex flex-wrap gap-1.5 mb-4" role="group" aria-label="Periodo storico">
          {PRESETS.map((preset) => <button key={preset.days} type="button" onClick={() => selectRange(preset.days)}
            aria-pressed={rangeDays === preset.days}
            className={`${buttonClass} ${rangeDays === preset.days ? "border-accent/60 bg-accent/10 text-accent-bright" : "border-base-border text-ink-muted"}`}>{preset.label}</button>)}
          <button type="button" onClick={() => selectRange(null)} aria-pressed={!range}
            className={`${buttonClass} ${!range ? "border-accent/60 bg-accent/10 text-accent-bright" : "border-base-border text-ink-muted"}`}>Tutto</button>
        </div>
        <div className="flex flex-wrap items-end gap-3 mb-5">
          <label className="text-xs text-ink-muted">Dal
            <input type="date" aria-label="Inizio periodo" min={oldest} max={newest} value={from}
              onChange={(event) => { if (event.target.value) changeRange({ from: event.target.value, to: event.target.value > to ? event.target.value : to }); }}
              className="block w-36 min-h-11 mt-1 rounded-lg border border-base-border bg-base-surface2 px-2 text-ink-primary [color-scheme:dark]" />
          </label>
          <label className="text-xs text-ink-muted">Al
            <input type="date" aria-label="Fine periodo" min={oldest} max={newest} value={to}
              onChange={(event) => { if (event.target.value) changeRange({ from: event.target.value < from ? event.target.value : from, to: event.target.value }); }}
              className="block w-36 min-h-11 mt-1 rounded-lg border border-base-border bg-base-surface2 px-2 text-ink-primary [color-scheme:dark]" />
          </label>
          <p className="text-xs text-ink-faint pb-2">{visible.length} rilevazioni · storico dal {formatDate(oldest)}</p>
        </div>
        {active && <div className="flex flex-wrap justify-between gap-3 mb-4">
          <div>
            <div className="text-xs font-mono text-ink-muted">{formatDateLong(active.captured_at)}</div>
            <div className="font-display text-3xl font-bold mt-1">{formatCents(active.total_cents, active.currency ?? "EUR")}</div>
            <p className="text-xs text-ink-faint mt-1">{active.priced_count}/{active.cards_count} tipi di carta con prezzo</p>
          </div>
          {comparable && baseline && <div className="sm:text-right">
            <p className={`font-mono text-lg ${delta >= 0 ? "text-signal-up" : "text-signal-down"}`}>
              {delta >= 0 ? "+" : ""}{formatCents(delta, active.currency ?? "EUR")}
              {deltaPct !== null && <span className="text-xs ml-2">({deltaPct >= 0 ? "+" : ""}{deltaPct.toFixed(2)}%)</span>}
            </p>
            <p className="text-xs text-ink-muted">Variazione dal {formatDate(baseline.captured_at)}</p>
            <button type="button" onClick={() => setBaselineDate(baselineDate ? null : active.captured_at)}
              aria-pressed={baselineDate !== null} className="min-h-11 text-xs text-accent-bright underline underline-offset-4">
              {baselineDate ? "Ripristina confronto" : "Confronta da questo punto"}
            </button>
          </div>}
        </div>}
        {!comparable ? <p role="status" className="py-8 text-sm text-ink-muted">Il periodo contiene valute diverse: seleziona un intervallo con una sola valuta per confrontare i valori.</p>
          : visible.length < 2 ? <p role="status" className="py-8 text-center text-sm text-ink-muted">
            {visible.length === 0 ? "Nessuna rilevazione in questo periodo." : "Un solo punto: serve una seconda rilevazione per l’andamento."}
          </p> : <>
            <div className="flex gap-3">
              <div className="hidden sm:flex w-20 shrink-0 flex-col justify-between py-6 text-[11px] font-mono text-ink-faint" aria-hidden>
                <span>{formatCents(max, active.currency ?? "EUR")}</span><span>{formatCents(min, active.currency ?? "EUR")}</span>
              </div>
              <svg ref={svgRef} viewBox="0 0 100 100" preserveAspectRatio="none"
                className={`min-w-0 w-full overflow-visible touch-pan-y outline-none focus-visible:ring-2 focus-visible:ring-accent rounded ${expanded ? "h-[360px] sm:h-[460px]" : "h-52 sm:h-64"}`}
                role="slider" tabIndex={0} aria-label="Esplora lo storico" aria-describedby={`${id}-help`}
                aria-valuemin={0} aria-valuemax={visible.length - 1} aria-valuenow={activeIndex}
                aria-valuetext={`${formatDateLong(active.captured_at)}, ${formatCents(active.total_cents, active.currency ?? "EUR")}`}
                onPointerDown={(event) => scrubTo(event.clientX)}
                onPointerMove={(event) => { if (event.pointerType === "mouse" || event.buttons === 1) scrubTo(event.clientX); }}
                onKeyDown={handleKey}>
                <defs><linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2DD8C9" stopOpacity="0.3" /><stop offset="100%" stopColor="#2DD8C9" stopOpacity="0" />
                </linearGradient></defs>
                {[10, 30, 50, 70, 90].map((y) => <line key={y} x1={0} x2={100} y1={y} y2={y} stroke="#565C63" strokeOpacity="0.2" vectorEffect="non-scaling-stroke" />)}
                <path d={areaPath(path, coords)} fill={`url(#${id}-fill)`} />
                <path d={path} fill="none" stroke="#2DD8C9" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
                {baselineDate && <line x1={0} x2={100} y1={yForValue(baseline.total_cents, min, max)} y2={yForValue(baseline.total_cents, min, max)} stroke="#F4BD6A" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
                <line x1={coords[activeIndex].x} x2={coords[activeIndex].x} y1={0} y2={100} stroke="#5FF0E3" strokeOpacity="0.6" vectorEffect="non-scaling-stroke" />
                <circle cx={coords[activeIndex].x} cy={coords[activeIndex].y} r="1" fill="#5FF0E3" />
              </svg>
            </div>
            <div className="flex justify-between mt-2 sm:ml-[92px] text-[11px] font-mono text-ink-faint">
              <span>{formatDate(visible[0].captured_at)}</span><span>{formatDate(visible.at(-1)!.captured_at)}</span>
            </div>
            <p className="text-xs text-ink-faint mt-3">Trascina sul grafico o usa le frecce. Fissa un punto per confrontarlo con un’altra data.</p>
          </>}
        {history.length > 2 && new Set(history.map((point) => point.currency ?? "EUR")).size <= 1 && <div className="mt-5 border-t border-base-border pt-4">
          <p className="text-xs text-ink-muted mb-2">Zoom sul periodo · sposta gli estremi</p>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-12" aria-hidden>
            <path d={overviewPath} fill="none" stroke="#565C63" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            <rect x={xForDate(Date.parse(history[firstIndex].captured_at), Date.parse(oldest), Date.parse(newest))} y={0}
              width={Math.max(0.3, xForDate(Date.parse(history[lastIndex].captured_at), Date.parse(oldest), Date.parse(newest)) - xForDate(Date.parse(history[firstIndex].captured_at), Date.parse(oldest), Date.parse(newest)))}
              height={100} fill="#2DD8C9" fillOpacity="0.15" stroke="#2DD8C9" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="grid grid-cols-2 gap-4 mt-2">
            <label className="min-w-0 text-xs text-ink-muted">Inizio zoom
              <input type="range" aria-label="Inizio zoom" min={0} max={history.length - 1} value={firstIndex}
                aria-valuetext={formatDateLong(history[firstIndex].captured_at)}
                onChange={(event) => { const index = Number(event.target.value); changeRange({ from: history[index].captured_at, to: history[Math.max(index, lastIndex)].captured_at }); }}
                className="block w-full min-h-11 accent-[#2DD8C9]" />
            </label>
            <label className="min-w-0 text-xs text-ink-muted">Fine zoom
              <input type="range" aria-label="Fine zoom" min={0} max={history.length - 1} value={lastIndex}
                aria-valuetext={formatDateLong(history[lastIndex].captured_at)}
                onChange={(event) => { const index = Number(event.target.value); changeRange({ from: history[Math.min(firstIndex, index)].captured_at, to: history[index].captured_at }); }}
                className="block w-full min-h-11 accent-[#2DD8C9]" />
            </label>
          </div>
        </div>}
        <p className="mt-4 text-[11px] text-ink-faint">Rilevazioni giornaliere; i punti più vecchi possono essere settimanali. Nessun dato intragiornaliero è disponibile.</p>
      </>}
    </section>
  );
}

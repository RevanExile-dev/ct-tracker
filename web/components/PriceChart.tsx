"use client";

import { useMemo, useState } from "react";
import { PricePoint } from "@/lib/db";
import { formatCents, formatDate, formatDateLong } from "@/lib/format";

export default function PriceChart({
  points,
  currency,
}: {
  points: PricePoint[];
  currency: string;
}) {
  const withPrice = points.filter((p) => p.min_price_cents !== null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const { path, areaPath, coords, min, max } = useMemo(() => {
    if (withPrice.length === 0) {
      return { path: "", areaPath: "", coords: [] as { x: number; y: number }[], min: 0, max: 0 };
    }
    const values = withPrice.map((p) => p.min_price_cents as number);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const w = 100;
    const h = 100;
    const coords = withPrice.map((p, i) => {
      const x = withPrice.length === 1 ? w / 2 : (i / (withPrice.length - 1)) * w;
      const y = h - (((p.min_price_cents as number) - min) / span) * (h - 20) - 10;
      return { x, y };
    });
    const path = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`).join(" ");
    const areaPath = `${path} L ${coords[coords.length - 1].x} ${h} L ${coords[0].x} ${h} Z`;
    return { path, areaPath, coords, min, max };
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

  return (
    <div className="rounded-card border border-base-border bg-base-surface p-5">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-ink-muted font-mono">
            {hoverIdx !== null ? formatDateLong(active.captured_at) : "Prezzo più recente"}
          </div>
          <div className="font-display text-3xl font-bold text-ink-primary mt-0.5">
            {formatCents(active.min_price_cents, currency)}
          </div>
        </div>
        <div className="text-right text-xs text-ink-muted font-mono">
          <div>min {formatCents(min, currency)}</div>
          <div>max {formatCents(max, currency)}</div>
        </div>
      </div>

      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="w-full h-40 overflow-visible"
        onMouseLeave={() => setHoverIdx(null)}
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
          d={path}
          pathLength={1}
          fill="none"
          stroke="#2DD8C9"
          strokeWidth="1.4"
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ "--line-length": 1 } as React.CSSProperties}
        />
        {coords.map((c, i) => (
          <rect
            key={i}
            x={c.x - 100 / coords.length / 2}
            y={0}
            width={100 / coords.length}
            height={100}
            fill="transparent"
            onMouseEnter={() => setHoverIdx(i)}
          />
        ))}
        {hoverIdx !== null && (
          <line
            x1={coords[hoverIdx].x}
            x2={coords[hoverIdx].x}
            y1={0}
            y2={100}
            stroke="#565C63"
            strokeWidth="0.5"
            strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {hoverIdx !== null && (
          <circle cx={coords[hoverIdx].x} cy={coords[hoverIdx].y} r="1.8" fill="#5FF0E3" />
        )}
      </svg>

      <div className="flex justify-between mt-2 text-[11px] font-mono text-ink-faint">
        <span>{formatDate(withPrice[0].captured_at)}</span>
        <span>{formatDate(withPrice[withPrice.length - 1].captured_at)}</span>
      </div>
    </div>
  );
}

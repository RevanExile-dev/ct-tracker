"use client";

import { useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import Image from "next/image";
import { TIER_GLYPH, TIER_NAME, TYPE_COLORS, pct, type DCard, type TypeKey } from "./model";

/* ---------- icone ---------- */
const base = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
export const Icon = {
  search: <svg {...base} strokeWidth={1.8}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>,
  chev: <svg {...base} strokeWidth={2}><path d="M6 9l6 6 6-6" /></svg>,
  left: <svg {...base} strokeWidth={2}><path d="M15 6l-6 6 6 6" /></svg>,
  right: <svg {...base} strokeWidth={2}><path d="M9 6l6 6-6 6" /></svg>,
  cards: <svg {...base} strokeWidth={1.7}><rect x="6" y="3.5" width="12" height="17" rx="2.2" /><path d="M9.5 8h5M9.5 12h5" /></svg>,
  trend: <svg {...base} strokeWidth={1.8}><path d="M4 17l5-6 4 3 7-8M15 6h5v5" /></svg>,
  binder: <svg {...base} strokeWidth={1.7}><rect x="5" y="4" width="14" height="16" rx="2" /><path d="M9 4v16M13 9h3M13 13h3" /></svg>,
  heart: <svg {...base} strokeWidth={1.8}><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /></svg>,
  scan: <svg {...base} strokeWidth={1.8}><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M4 12h16" /></svg>,
  sun: <svg {...base} strokeWidth={1.8}><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" /></svg>,
  moon: <svg {...base} strokeWidth={1.8}><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" /></svg>,
  ext: <svg {...base} strokeWidth={1.8}><path d="M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" /></svg>,
};

export function Logo() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" width={28} height={28}>
      <rect x="5" y="2" width="22" height="28" rx="4.5" fill="#e9b949" />
      <rect x="7.4" y="4.4" width="17.2" height="23.2" rx="3" fill="#0f141b" />
      <circle cx="16" cy="16" r="6.4" fill="none" stroke="#e8ebef" strokeWidth="1.8" />
      <path d="M9.6 16h4M18.4 16h4" stroke="#e8ebef" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="16" cy="16" r="2" fill="#e9b949" />
    </svg>
  );
}

/* ---------- illustrazione delle carte d'esempio ---------- */
type Scene = { sky: [string, string]; sun: string; sx: number; sy: number; sr: number; hills: [string, string, string]; stars?: boolean };
const SCENE: Record<TypeKey, Scene> = {
  fuoco: { sky: ["#2b1330", "#e8663d"], sun: "#ffd27a", sx: 70, sy: 46, sr: 13, hills: ["#5a1f2a", "#3a1424", "#240d1a"] },
  acqua: { sky: ["#bfe3ff", "#4a93d8"], sun: "#ffffff", sx: 28, sy: 34, sr: 10, hills: ["#2a74b8", "#1c5a97", "#123f75"] },
  erba: { sky: ["#f6e8b0", "#9ed39a"], sun: "#fff3c2", sx: 68, sy: 38, sr: 12, hills: ["#5fae62", "#3f8a4d", "#276a3c"] },
  elettro: { sky: ["#3a3f8f", "#f4d35e"], sun: "#fff6cf", sx: 50, sy: 40, sr: 11, hills: ["#6b5bb5", "#4a3f94", "#2d2870"] },
  psico: { sky: ["#2a1b4d", "#b07bd9"], sun: "#f3d9ff", sx: 32, sy: 36, sr: 11, hills: ["#6a3f97", "#4b2a78", "#311a58"], stars: true },
  buio: { sky: ["#0f1622", "#47556d"], sun: "#e8ecf4", sx: 72, sy: 32, sr: 9, hills: ["#2a3446", "#1c2434", "#111826"], stars: true },
  drago: { sky: ["#f2d9a0", "#c9894a"], sun: "#fff0c9", sx: 60, sy: 42, sr: 12, hills: ["#9a6a3a", "#734a28", "#4a2f1a"] },
};

function Art({ type }: { type: TypeKey }) {
  const s = SCENE[type];
  const id = useId();
  return (
    <svg viewBox="0 0 100 130" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={s.sky[0]} /><stop offset="1" stopColor={s.sky[1]} /></linearGradient>
      </defs>
      <rect width="100" height="130" fill={`url(#${id})`} />
      {s.stars && <g fill="#fff" opacity=".8"><circle cx="14" cy="18" r="1" /><circle cx="42" cy="12" r=".8" /><circle cx="84" cy="22" r="1" /><circle cx="24" cy="44" r=".7" /><circle cx="90" cy="54" r=".8" /></g>}
      <circle cx={s.sx} cy={s.sy} r={s.sr} fill={s.sun} />
      <path d="M0 78 C20 66 38 88 60 76 S92 70 100 76 V130 H0Z" fill={s.hills[0]} />
      <path d="M0 94 C24 84 42 104 66 92 S92 90 100 94 V130 H0Z" fill={s.hills[1]} />
      <path d="M0 110 C30 102 50 118 74 108 S94 108 100 110 V130 H0Z" fill={s.hills[2]} />
    </svg>
  );
}

/* ---------- la carta: inclinazione, profondita' e lamina ---------- */
const reduced = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Inclinazione massima circa 6 gradi. Scrive direttamente variabili CSS: nessun re-render a ogni movimento. */
export function CardFace({ card, onOpen }: { card: DCard; onOpen?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const pt = useRef<{ x: number; y: number } | null>(null);
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const apply = () => {
    raf.current = 0;
    const el = ref.current;
    if (!el || !pt.current) return;
    const r = el.getBoundingClientRect();
    const px = Math.max(0, Math.min(1, (pt.current.x - r.left) / r.width));
    const py = Math.max(0, Math.min(1, (pt.current.y - r.top) / r.height));
    el.style.setProperty("--px", `${(px * 100).toFixed(0)}%`);
    if (!reduced()) {
      el.style.setProperty("--rx", `${((0.5 - py) * 12).toFixed(1)}deg`);
      el.style.setProperty("--ry", `${((px - 0.5) * 12).toFixed(1)}deg`);
      el.style.setProperty("--tx", ((0.5 - px) * 7).toFixed(1));
      el.style.setProperty("--ty", ((0.5 - py) * 7).toFixed(1));
    }
    el.dataset.live = "1";
  };
  const move = (e: PointerEvent) => {
    pt.current = { x: e.clientX, y: e.clientY };
    if (!raf.current) raf.current = requestAnimationFrame(apply);
  };
  const end = () => {
    pt.current = null;
    const el = ref.current;
    if (!el) return;
    el.dataset.live = "";
    for (const k of ["--rx", "--ry"]) el.style.setProperty(k, "0deg");
    for (const k of ["--tx", "--ty"]) el.style.setProperty(k, "0");
  };
  const key = (e: KeyboardEvent) => {
    if (onOpen && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen(); }
  };

  const handlers = { onPointerMove: move, onPointerDown: move, onPointerLeave: end, onPointerUp: end, onPointerCancel: end, onClick: onOpen, onKeyDown: key };
  const label = `${card.name}${card.sample ? " (carta d'esempio)" : ""}`;
  const interactive = onOpen ? { role: "button" as const, tabIndex: 0 } : { role: "img" as const, tabIndex: -1 };

  if (card.img && !broken) {
    return (
      <div className="cv-tilt">
        <div ref={ref} className="cv-imgcard" data-r={card.foil} aria-label={label} {...interactive} {...handlers}>
          <Image
            src={card.img} alt="" fill sizes="(min-width: 1024px) 20vw, 45vw" unoptimized
            style={{ opacity: loaded ? 1 : 0 }} onLoad={() => setLoaded(true)} onError={() => setBroken(true)}
          />
          <div className="cv-sheen" />
        </div>
      </div>
    );
  }

  // Segnaposto disegnato: carte d'esempio, oppure immagine assente o rotta.
  const type: TypeKey = card.type ?? "acqua";
  const edge = card.type ? TYPE_COLORS[card.type] : "#8b95a5";
  return (
    <div className="cv-tilt">
      <div ref={ref} className="cv-cardface" data-r={card.foil} aria-label={label} style={{ "--edge": edge } as CSSProperties} {...interactive} {...handlers}>
        <div className="cv-cf">
          <div className="cv-cf-head"><i /><b /></div>
          <div className="cv-cf-art"><Art type={type} /></div>
          <div className="cv-cf-txt"><u /><u /><u /></div>
        </div>
        <div className="cv-sheen" />
      </div>
    </div>
  );
}

/* ---------- piccoli pezzi di interfaccia ---------- */
export function Delta({ d }: { d: number | null }) {
  if (d == null) return null;
  return (
    <span className={`cv-delta ${d >= 0 ? "cv-up" : "cv-down"}`}>
      <span className="cv-sr">{d >= 0 ? "In rialzo" : "In calo"}</span>
      {pct(d)}
    </span>
  );
}

export function TypeDot({ type }: { type: TypeKey | null }) {
  if (!type) return null;
  return <span className="cv-tdot" style={{ "--c": TYPE_COLORS[type] } as CSSProperties} title={`Tipo ${type}`} />;
}

export function Rarity({ card }: { card: DCard }) {
  if (card.tier == null) return null;
  return <span className="cv-rar" role="img" aria-label={card.rarityLabel ?? TIER_NAME[card.tier]}>{TIER_GLYPH[card.tier]}</span>;
}

export function Spark({ data, up }: { data: number[]; up: boolean }) {
  const w = 72, h = 26, pad = 3;
  const mn = Math.min(...data), mx = Math.max(...data);
  const pts = data.map((v, i) => [i * (w - 2 * pad) / (data.length - 1) + pad, h - pad - (v - mn) / (mx - mn || 1) * (h - 2 * pad)] as const);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg className="cv-spark" viewBox={`0 0 ${w} ${h}`} style={{ color: `var(--${up ? "up" : "down"})` }} aria-hidden="true">
      <path d={`${line} L${last[0].toFixed(1)} ${h} L${pts[0][0].toFixed(1)} ${h}Z`} fill="currentColor" opacity=".12" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0].toFixed(1)} cy={last[1].toFixed(1)} r="2.2" fill="currentColor" />
    </svg>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; l: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="cv-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.v} type="button" aria-pressed={o.v === value} onClick={() => onChange(o.v)}>{o.l}</button>
      ))}
    </div>
  );
}

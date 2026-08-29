"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { CardRow } from "@/lib/db";
import { formatCents } from "@/lib/format";

const CARDS_PER_SHEET = 9;

type Screen =
  | { kind: "cover"; count: number; totalCents: number; currency: string }
  | { kind: "sheet"; cards: CardRow[]; sheetNumber: number; totalSheets: number };

function buildScreens(cards: CardRow[]): Screen[] {
  const priced = cards.filter((c) => c.latest_price_cents !== null);
  const totalCents = priced.reduce((sum, c) => sum + (c.latest_price_cents as number), 0);
  const currency = priced[0]?.latest_price_currency ?? "EUR";

  const sheets: CardRow[][] = [];
  for (let i = 0; i < cards.length; i += CARDS_PER_SHEET) {
    sheets.push(cards.slice(i, i + CARDS_PER_SHEET));
  }
  if (sheets.length === 0) sheets.push([]);

  return [
    { kind: "cover", count: cards.length, totalCents, currency },
    ...sheets.map((s, i) => ({
      kind: "sheet" as const,
      cards: s,
      sheetNumber: i + 1,
      totalSheets: sheets.length,
    })),
  ];
}

function Pocket({ card }: { card: CardRow | undefined }) {
  if (!card) {
    return <div className="binder-pocket binder-pocket-empty" />;
  }
  return (
    <Link href={`/card/${card.id}`} className="binder-pocket group">
      <div className="relative w-full h-full">
        {card.image_url ? (
          <Image
            src={card.image_url}
            alt={card.name}
            fill
            sizes="180px"
            className="object-cover transition-transform duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-ink-faint text-[9px] font-mono text-center px-1">
            {card.name}
          </div>
        )}
        <div className="binder-pocket-gloss" />
        <div className="absolute bottom-0 inset-x-0 bg-black/70 backdrop-blur-sm px-1.5 py-1">
          <div className="text-[9px] text-ink-primary truncate leading-tight">{card.name}</div>
          <div className="text-[9px] font-mono text-accent-bright leading-tight">
            {formatCents(card.latest_price_cents, card.latest_price_currency ?? "EUR")}
          </div>
        </div>
      </div>
    </Link>
  );
}

function ScreenView({ screen }: { screen: Screen | undefined }) {
  if (!screen) {
    return (
      <div className="binder-page binder-page-blank">
        <span className="text-ink-faint/40 text-xs font-mono">— fine binder —</span>
      </div>
    );
  }

  if (screen.kind === "cover") {
    return (
      <div className="binder-page binder-page-cover">
        <div className="binder-cover-shine" />
        <div className="relative z-10 flex flex-col h-full justify-between p-6">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/70">
              CardTrader Tracker
            </div>
            <h1 className="font-display text-3xl font-bold text-white mt-2 leading-tight">
              Il mio
              <br />
              Binder
            </h1>
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-white/60">
              {screen.count} carte · valore stimato
            </div>
            <div className="font-display text-xl font-bold text-white">
              {formatCents(screen.totalCents, screen.currency)}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const cells: (CardRow | undefined)[] = Array.from(
    { length: CARDS_PER_SHEET },
    (_, i) => screen.cards[i]
  );

  return (
    <div className="binder-page binder-page-sheet">
      <div className="grid grid-cols-3 gap-2 p-3 h-full">
        {cells.map((c, i) => (
          <Pocket key={c?.id ?? `empty-${i}`} card={c} />
        ))}
      </div>
      <div className="absolute bottom-1.5 right-3 text-[9px] font-mono text-ink-faint">
        {screen.sheetNumber}/{screen.totalSheets}
      </div>
    </div>
  );
}

export default function BinderBook({ cards }: { cards: CardRow[] }) {
  const screens = buildScreens(cards);
  const [spreadIndex, setSpreadIndex] = useState(0);
  const [anim, setAnim] = useState<null | { dir: "next" | "prev"; rotating: boolean }>(null);

  const leftScreen = screens[spreadIndex];
  const rightScreen = screens[spreadIndex + 1];
  const nextRightScreen = screens[spreadIndex + 2];
  const prevLeftScreen = screens[spreadIndex - 1];

  const canNext = !anim && spreadIndex + 1 < screens.length;
  const canPrev = !anim && spreadIndex > 0;

  function goNext() {
    if (!canNext) return;
    setAnim({ dir: "next", rotating: false });
    requestAnimationFrame(() => requestAnimationFrame(() => setAnim({ dir: "next", rotating: true })));
  }

  function goPrev() {
    if (!canPrev) return;
    setAnim({ dir: "prev", rotating: false });
    requestAnimationFrame(() => requestAnimationFrame(() => setAnim({ dir: "prev", rotating: true })));
  }

  function handleTransitionEnd() {
    if (!anim) return;
    setSpreadIndex((i) => (anim.dir === "next" ? i + 1 : i - 1));
    setAnim(null);
  }

  return (
    <div className="w-full">
      <div className="binder-stage">
        <div className="binder-spread">
          <div className="binder-slot binder-slot-left">
            <ScreenView screen={anim?.dir === "prev" ? prevLeftScreen : leftScreen} />
          </div>

          <div className="binder-spine">
            <span className="binder-ring" />
            <span className="binder-ring" />
            <span className="binder-ring" />
          </div>

          <div className="binder-slot binder-slot-right">
            <ScreenView screen={anim?.dir === "next" ? nextRightScreen : rightScreen} />
          </div>

          {anim?.dir === "next" && (
            <div
              className="binder-flip binder-flip-right"
              style={{ transform: anim.rotating ? "rotateY(-180deg)" : "rotateY(0deg)" }}
              onTransitionEnd={handleTransitionEnd}
            >
              <ScreenView screen={rightScreen} />
            </div>
          )}
          {anim?.dir === "prev" && (
            <div
              className="binder-flip binder-flip-left"
              style={{ transform: anim.rotating ? "rotateY(180deg)" : "rotateY(0deg)" }}
              onTransitionEnd={handleTransitionEnd}
            >
              <ScreenView screen={leftScreen} />
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-center gap-4 mt-6">
        <button
          onClick={goPrev}
          disabled={!canPrev}
          className="text-sm px-5 py-2.5 rounded-card border border-base-border bg-base-surface text-ink-muted hover:text-ink-primary hover:border-accent/60 transition-colors active:scale-95 disabled:opacity-30 disabled:pointer-events-none"
        >
          ← Pagina prec.
        </button>
        <span className="font-mono text-xs text-ink-faint">
          {spreadIndex + 1}/{screens.length}
        </span>
        <button
          onClick={goNext}
          disabled={!canNext}
          className="text-sm px-5 py-2.5 rounded-card border border-base-border bg-base-surface text-ink-muted hover:text-ink-primary hover:border-accent/60 transition-colors active:scale-95 disabled:opacity-30 disabled:pointer-events-none"
        >
          Pagina succ. →
        </button>
      </div>
    </div>
  );
}

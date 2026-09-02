"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { CardRow } from "@/lib/db";
import { formatCents } from "@/lib/format";
import InteractiveCard from "./InteractiveCard";

type Screen =
  | { kind: "cover"; count: number; totalCents: number; currency: string }
  | { kind: "sheet"; cards: CardRow[]; sheetNumber: number; totalSheets: number; cells: number };

function buildScreens(cards: CardRow[], cells: number): Screen[] {
  const priced = cards.filter((card) => (card.best_price_cents ?? card.latest_price_cents) !== null);
  const totalCents = priced.reduce((sum, card) => sum + (card.best_price_cents ?? card.latest_price_cents ?? 0), 0);
  const currency = priced[0]?.best_price_currency ?? priced[0]?.latest_price_currency ?? "EUR";
  const sheets: CardRow[][] = [];
  for (let index = 0; index < cards.length; index += cells) sheets.push(cards.slice(index, index + cells));
  if (sheets.length === 0) sheets.push([]);
  return [
    { kind: "cover", count: cards.length, totalCents, currency },
    ...sheets.map((sheet, index) => ({
      kind: "sheet" as const,
      cards: sheet,
      sheetNumber: index + 1,
      totalSheets: sheets.length,
      cells,
    })),
  ];
}

function Pocket({ card, returnTo }: { card: CardRow | undefined; returnTo: string }) {
  const [imgError, setImgError] = useState(false);
  if (!card) return <div className="binder-pocket binder-pocket-empty" aria-hidden />;
  const href = `/card/${card.id}?from=${encodeURIComponent(returnTo)}`;
  return (
    <Link href={href} className="binder-pocket group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/80" aria-label={`Apri ${card.name}`}>
      <InteractiveCard level="binder" className="h-full w-full overflow-hidden rounded-[4px]">
        <div className="relative w-full h-full">
          {card.image_url && !imgError ? (
            <Image
              src={card.image_url}
              alt={card.name}
              fill
              sizes="(max-width: 767px) 45vw, 15vw"
              className="object-cover"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-ink-faint text-[9px] font-mono text-center px-1">{card.name}</div>
          )}
          <div className="binder-pocket-gloss" />
          <div className="binder-pocket-caption absolute bottom-0 inset-x-0 bg-black/75 backdrop-blur-sm px-1.5 py-1">
            <div className="text-[9px] text-ink-primary truncate leading-tight">{card.name}</div>
            <div className="text-[9px] font-mono text-accent-bright leading-tight">
              {formatCents(card.best_price_cents ?? card.latest_price_cents, card.best_price_currency ?? card.latest_price_currency ?? "EUR")}
            </div>
          </div>
        </div>
      </InteractiveCard>
    </Link>
  );
}

function ScreenView({ screen, returnTo }: { screen: Screen | undefined; returnTo: string }) {
  if (!screen) {
    return <div className="binder-page binder-page-blank"><span className="text-ink-faint/50 text-xs font-mono">— fine binder —</span></div>;
  }
  if (screen.kind === "cover") {
    return (
      <div className="binder-page binder-page-cover">
        <div className="binder-cover-shine" />
        <div className="relative z-10 flex flex-col h-full justify-between p-[clamp(1.25rem,4vw,3rem)]">
          <div>
            <div className="font-mono text-[clamp(9px,1vw,12px)] uppercase tracking-[0.3em] text-white/75">Carta Viva</div>
            <h2 className="font-display text-[clamp(2rem,4vw,4.5rem)] font-bold text-white mt-2 leading-[0.92]">La mia<br />collezione</h2>
          </div>
          <div>
            <div className="text-[clamp(9px,1vw,12px)] font-mono uppercase tracking-wider text-white/65">{screen.count} carte · valore stimato</div>
            <div className="font-display text-[clamp(1.25rem,2.3vw,2.5rem)] font-bold text-white">{formatCents(screen.totalCents, screen.currency)}</div>
          </div>
        </div>
      </div>
    );
  }
  const cells = Array.from({ length: screen.cells }, (_, index) => screen.cards[index]);
  return (
    <div className="binder-page binder-page-sheet">
      <div className={`binder-sheet-grid ${screen.cells === 4 ? "binder-sheet-grid-4" : "binder-sheet-grid-9"}`}>
        {cells.map((card, index) => <Pocket key={card?.id ?? `empty-${index}`} card={card} returnTo={returnTo} />)}
      </div>
      <div className="absolute bottom-1.5 right-3 text-[9px] font-mono text-ink-faint">{screen.sheetNumber}/{screen.totalSheets}</div>
    </div>
  );
}

type Flip = { direction: "next" | "prev"; started: boolean };

export default function BinderBook({ cards, initialPage = 0, onPageChange, returnTo }: {
  cards: CardRow[];
  initialPage?: number;
  onPageChange?: (page: number) => void;
  returnTo: string;
}) {
  const [singlePage, setSinglePage] = useState(false);
  const [page, setPage] = useState(Math.max(0, initialPage));
  const [flip, setFlip] = useState<Flip | null>(null);
  const gestureStart = useRef<{ x: number; y: number } | null>(null);
  const didSwipe = useRef(false);
  const flipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screens = useMemo(() => buildScreens(cards, singlePage ? 4 : 9), [cards, singlePage]);
  const step = singlePage ? 1 : 2;
  const viewPage = singlePage ? Math.min(page, screens.length - 1) : Math.min(Math.floor(page / 2) * 2, Math.max(0, screens.length - 1));
  const canPrev = !flip && viewPage > 0;
  const canNext = !flip && viewPage + step < screens.length;

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px), (max-width: 1023px) and (orientation: portrait)");
    const update = () => setSinglePage(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => onPageChange?.(viewPage), [viewPage, onPageChange]);

  function clearFlipTimeout() {
    if (flipTimeoutRef.current !== null) {
      clearTimeout(flipTimeoutRef.current);
      flipTimeoutRef.current = null;
    }
  }

  function turn(direction: "next" | "prev") {
    if ((direction === "next" && !canNext) || (direction === "prev" && !canPrev)) return;
    setFlip({ direction, started: false });
    requestAnimationFrame(() => requestAnimationFrame(() => setFlip({ direction, started: true })));
    // Rete di sicurezza: onTransitionEnd non e' garantito al 100% (tab in
    // background, frame drop, dispositivi lenti) - senza un fallback un solo
    // evento perso blocca la pagina per sempre, perche' canNext/canPrev
    // richiedono flip===null. Il timeout completa comunque il turn dopo la
    // durata della transizione CSS (680ms, vedi globals.css) + margine.
    clearFlipTimeout();
    flipTimeoutRef.current = setTimeout(finishFlip, 900);
  }

  function finishFlip() {
    clearFlipTimeout();
    // Aggiornamento funzionale: finishFlip puo' arrivare sia da
    // onTransitionEnd sia dal timeout di sicurezza sopra, con closure creata
    // in render diversi - leggere flip da state (non dalla closure esterna)
    // evita di agire su un valore stantio o di eseguire il turn due volte.
    setFlip((current) => {
      if (!current) return null;
      const direction = current.direction;
      setPage((page) => Math.max(0, Math.min(screens.length - 1, page + (direction === "next" ? step : -step))));
      return null;
    });
  }

  useEffect(() => clearFlipTimeout, []);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "ArrowRight" || event.key === "PageDown") turn("next");
      if (event.key === "ArrowLeft" || event.key === "PageUp") turn("prev");
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  const nextStart = viewPage + step;
  const prevStart = Math.max(0, viewPage - step);
  const left = screens[viewPage];
  const right = singlePage ? undefined : screens[viewPage + 1];
  const underlyingLeft = flip?.direction === "prev" ? screens[prevStart] : left;
  const underlyingRight = singlePage
    ? undefined
    : flip?.direction === "next" ? screens[nextStart + 1] : right;

  return (
    <div className="w-full">
      <div
        className={`binder-stage ${singlePage ? "binder-stage-single" : "binder-stage-spread"}`}
        aria-label="Binder sfogliabile"
        onPointerDown={(event) => {
          if (event.pointerType !== "mouse") gestureStart.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerUp={(event) => {
          const start = gestureStart.current;
          gestureStart.current = null;
          if (!start) return;
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          if (Math.abs(dx) >= 52 && Math.abs(dx) > Math.abs(dy) * 1.25) {
            didSwipe.current = true;
            turn(dx < 0 ? "next" : "prev");
            window.setTimeout(() => { didSwipe.current = false; }, 0);
          }
        }}
        onClickCapture={(event) => {
          if (didSwipe.current) { event.preventDefault(); event.stopPropagation(); }
        }}
      >
        <div className={`binder-spread ${singlePage ? "is-single" : "is-double"}`}>
          <div className="binder-slot binder-slot-left"><ScreenView screen={underlyingLeft} returnTo={returnTo} /></div>
          {!singlePage && (
            <>
              <div className="binder-spine" aria-hidden><span className="binder-ring" /><span className="binder-ring" /><span className="binder-ring" /></div>
              <div className="binder-slot binder-slot-right"><ScreenView screen={underlyingRight} returnTo={returnTo} /></div>
            </>
          )}

          {flip && (
            <div
              className={`binder-flip ${singlePage ? "binder-flip-single" : flip.direction === "next" ? "binder-flip-right" : "binder-flip-left"} ${flip.started ? "is-turning" : ""}`}
              data-direction={flip.direction}
              onTransitionEnd={(event) => { if (event.target === event.currentTarget) finishFlip(); }}
            >
              <div className="binder-flip-face binder-flip-front">
                <ScreenView screen={singlePage ? left : flip.direction === "next" ? right : left} returnTo={returnTo} />
              </div>
              <div className="binder-flip-face binder-flip-back">
                <ScreenView screen={flip.direction === "next" ? screens[nextStart] : screens[prevStart + (singlePage ? 0 : 1)]} returnTo={returnTo} />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="binder-controls flex items-center justify-center gap-3 sm:gap-4 mt-5">
        <button onClick={() => turn("prev")} disabled={!canPrev} className="btn-lift min-h-11 text-sm px-4 sm:px-5 py-2.5 rounded-card border border-base-border bg-base-surface text-ink-muted hover:text-ink-primary hover:border-accent/60 active:scale-95 disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70">← <span className="hidden sm:inline">Pagina prec.</span><span className="sm:hidden">Indietro</span></button>
        <span className="min-w-16 text-center font-mono text-xs text-ink-faint" aria-live="polite">
          {singlePage ? `${viewPage + 1}/${screens.length}` : `${viewPage + 1}–${Math.min(viewPage + 2, screens.length)}/${screens.length}`}
        </span>
        <button onClick={() => turn("next")} disabled={!canNext} className="btn-lift min-h-11 text-sm px-4 sm:px-5 py-2.5 rounded-card border border-base-border bg-base-surface text-ink-muted hover:text-ink-primary hover:border-accent/60 active:scale-95 disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"><span className="hidden sm:inline">Pagina succ.</span><span className="sm:hidden">Avanti</span> →</button>
      </div>
      <p className="mt-3 text-center text-[11px] font-mono text-ink-faint">Swipe su touch · frecce ← → su tastiera</p>
    </div>
  );
}

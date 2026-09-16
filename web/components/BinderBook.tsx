"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import HTMLFlipBook, { type BookSnapshot, type FlipBookHandle } from "@gullabs/react-flipbook";
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

// Chiave stabile per identita' di contenuto, usata come React key per leaf.
function screenKey(screen: Screen): string {
  return screen.kind === "cover" ? "cover" : `sheet-${screen.sheetNumber}`;
}

function ScreenView({ screen, returnTo }: { screen: Screen; returnTo: string }) {
  if (screen.kind === "cover") {
    return (
      <div className="binder-page binder-page-cover">
        <div className="binder-cover-shine" />
        <div className="relative z-10 flex flex-col h-full justify-between p-[clamp(0.85rem,4vw,3rem)]">
          <div>
            <div className="font-mono text-[clamp(8px,1vw,12px)] uppercase tracking-[0.2em] text-white/75">Carta Viva</div>
            {/* min piu' basso di prima: la copertina e' sempre meta' di uno
                spread a due pagine (anche su telefono, vedi usePortrait
                su HTMLFlipBook), quindi molto piu' stretta di quanto
                questo testo assumesse quando la copertina poteva occupare
                l'intera larghezza in modalita' a pagina singola. */}
            <h2 className="font-display text-[clamp(1.1rem,4vw,4.5rem)] font-bold text-white mt-2 leading-[0.98]">La mia<br />collezione</h2>
          </div>
          <div>
            <div className="text-[clamp(8px,1vw,12px)] font-mono uppercase tracking-wider text-white/65">{screen.count} carte · valore stimato</div>
            <div className="font-display text-[clamp(0.9rem,2.3vw,2.5rem)] font-bold text-white">{formatCents(screen.totalCents, screen.currency)}</div>
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

// Dimensioni di progetto di UNA singola pagina (rapporto 5:7, quello di una
// carta), passate al motore di sfoglio - sizing:"responsive" lo adatta poi
// entro min/max alla larghezza disponibile in binder-book-frame (vedi CSS).
// Sempre due pagine affiancate (vedi usePortrait={false} piu' sotto): un
// vero binder aperto si legge sempre come due facciate, anche su telefono -
// "singlePage" (mobile/tablet stretto) sceglie solo la coppia di dimensioni
// (meta' spread piu' piccola) e la densita' di tasche per facciata (4 invece
// di 9, altrimenti le tasche diventerebbero troppo piccole per il tocco).
const LEAF_SIZE = {
  single: { width: 170, height: 238, minWidth: 128, maxWidth: 220, minHeight: 180, maxHeight: 308 },
  spread: { width: 460, height: 644, minWidth: 240, maxWidth: 560, minHeight: 336, maxHeight: 784 },
} as const;

export default function BinderBook({ cards, initialPage = 0, onPageChange, returnTo }: {
  cards: CardRow[];
  initialPage?: number;
  onPageChange?: (page: number) => void;
  returnTo: string;
}) {
  const [singlePage, setSinglePage] = useState(false);
  const screens = useMemo(() => buildScreens(cards, singlePage ? 4 : 9), [cards, singlePage]);
  const [page, setPage] = useState(() => Math.max(0, Math.min(initialPage, screens.length - 1)));
  const [pageCount, setPageCount] = useState(screens.length);
  const [visiblePages, setVisiblePages] = useState<number[]>([0]);
  const bookRef = useRef<FlipBookHandle | null>(null);
  // Il primissimo render deve aprire il libro sulla pagina di partenza senza
  // animare uno sfoglio dall'inizio - dopo il mount ogni cambio di `page`
  // (bottoni, tastiera, drag) e' invece un vero sfoglio animato.
  const [hasOpened, setHasOpened] = useState(false);
  useEffect(() => {
    // setState va dentro un callback (rAF), mai sincrono nel corpo
    // dell'effetto (regola di lint del progetto, react-hooks/set-state-in-effect).
    const frame = requestAnimationFrame(() => setHasOpened(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px), (max-width: 1023px) and (orientation: portrait)");
    const update = () => setSinglePage(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  // Se la collezione si riduce (o cambia densita' per singlePage), `page`
  // puo' restare temporaneamente fuori dai nuovi limiti: si legge sempre
  // attraverso questo clamp calcolato al render, non c'e' bisogno di
  // "correggere" lo state con un effetto - il prossimo sfoglio reale lo
  // riallinea comunque via onPageChange.
  const clampedPage = Math.max(0, Math.min(page, screens.length - 1));

  useEffect(() => onPageChange?.(clampedPage), [clampedPage, onPageChange]);

  const handleSnapshot = useCallback((snapshot: BookSnapshot) => {
    setPage(snapshot.page);
    setPageCount(snapshot.pageCount);
    setVisiblePages(snapshot.visiblePages);
  }, []);
  // I bordi (copertina, ultimo foglio) sono "hardCovers": mostrati da soli
  // anche a libro aperto in landscape - un conteggio a passo fisso (sempre
  // +2 in landscape) sbaglierebbe proprio li'. visiblePages e' la fonte di
  // verita' del motore su cosa e' davvero a schermo in questo momento.
  const firstVisible = visiblePages[0] ?? clampedPage;
  const lastVisible = visiblePages[visiblePages.length - 1] ?? clampedPage;
  const canPrev = firstVisible > 0;
  const canNext = lastVisible < pageCount - 1;

  function turn(direction: "next" | "prev") {
    if (direction === "next") bookRef.current?.flipNext();
    else bookRef.current?.flipPrev();
  }

  const size = singlePage ? LEAF_SIZE.single : LEAF_SIZE.spread;

  return (
    <div className="w-full">
      <div className={`binder-case ${singlePage ? "is-single" : "is-spread"}`}>
        <div className="binder-zip binder-zip-top" aria-hidden />
        <div className="binder-zip binder-zip-right" aria-hidden />
        <div className="binder-zip binder-zip-bottom" aria-hidden />
        <div className="binder-zip-pull" aria-hidden />
        <div className="binder-book-frame">
          {visiblePages.length > 1 && (
            <div className="binder-center-spine" aria-hidden>
              <span className="binder-ring" /><span className="binder-ring" /><span className="binder-ring" />
            </div>
          )}
          <HTMLFlipBook
            ref={bookRef}
            className="binder-flipbook"
            width={size.width}
            height={size.height}
            minWidth={size.minWidth}
            maxWidth={size.maxWidth}
            minHeight={size.minHeight}
            maxHeight={size.maxHeight}
            sizing="responsive"
            // Sempre landscape (mai una pagina sola): oltre a corrispondere
            // a un binder vero (si vedono sempre due facciate una volta
            // aperto), la modalita' "portrait" del motore ha un bug reale
            // riprodotto con drag touch reali - durante lo sfoglio il
            // "clip-path" della pagina di destinazione resta a area zero per
            // tutto il gesto (verificato ispezionando il DOM live), quindi
            // si rivede la pagina di PARTENZA nell'area scoperta invece
            // della prossima - "le stesse carte" segnalato dall'utente. In
            // landscape la stessa ispezione mostra il clip-path della pagina
            // di destinazione crescere correttamente da subito.
            usePortrait={false}
            hardCovers
            respectInteractiveContent
            // Di default il motore lascia che un trascinamento verticale
            // scrolli la pagina invece di sfogliare (CSS spedito con la
            // libreria: touch-action: pan-y sul contenitore) - un vero dito
            // non e' mai perfettamente orizzontale, quindi lo scroll nativo
            // vince quasi subito la corsa e congela il gesto di sfoglio a
            // meta' (riprodotto con eventi touch reali via CDP: dopo il primo
            // pointermove il clip-path/transform della pagina in piega non
            // si aggiornava piu'). false forza il libro a catturare per
            // intero il drag - si perde la possibilita' di scorrere la
            // pagina iniziando esattamente sopra il libro, accettabile per
            // un binder pensato per essere sfogliato.
            allowTouchScroll={false}
            flippingTime={620}
            lazyRadius={2}
            pageBackground="#171b21"
            page={clampedPage}
            pageTransition={hasOpened ? "animate" : "instant"}
            onLoaded={handleSnapshot}
            onPageChange={handleSnapshot}
            controls="auto"
            aria-label="Binder sfogliabile"
          >
            {screens.map((screen) => (
              <div key={screenKey(screen)}>
                <ScreenView screen={screen} returnTo={returnTo} />
              </div>
            ))}
          </HTMLFlipBook>
        </div>
      </div>

      <div className="binder-controls flex items-center justify-center gap-3 sm:gap-4 mt-5">
        <button onClick={() => turn("prev")} disabled={!canPrev} className="btn-lift min-h-11 text-sm px-4 sm:px-5 py-2.5 rounded-card border border-base-border bg-base-surface text-ink-muted hover:text-ink-primary hover:border-accent/60 active:scale-95 disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70">← <span className="hidden sm:inline">Pagina prec.</span><span className="sm:hidden">Indietro</span></button>
        <span className="min-w-16 text-center font-mono text-xs text-ink-faint" aria-live="polite">
          {firstVisible === lastVisible ? `${firstVisible + 1}/${pageCount}` : `${firstVisible + 1}–${lastVisible + 1}/${pageCount}`}
        </span>
        <button onClick={() => turn("next")} disabled={!canNext} className="btn-lift min-h-11 text-sm px-4 sm:px-5 py-2.5 rounded-card border border-base-border bg-base-surface text-ink-muted hover:text-ink-primary hover:border-accent/60 active:scale-95 disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"><span className="hidden sm:inline">Pagina succ.</span><span className="sm:hidden">Avanti</span> →</button>
      </div>
      <p className="mt-3 text-center text-[11px] font-mono text-ink-faint">Trascina l’angolo o swipe · frecce ← → su tastiera</p>
    </div>
  );
}

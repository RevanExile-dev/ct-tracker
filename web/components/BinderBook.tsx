"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
            <h2 className="font-display text-[clamp(0.95rem,4vw,4.5rem)] font-bold text-white mt-2 leading-[0.98]">La mia<br />collezione</h2>
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


// Il motore di sfoglio rifiuta per scelta di far partire un giro quando il
// dito tocca un link (respectInteractiveContent) - ma qui ogni tasca e' un
// link e copre quasi tutta la pagina (su telefono non resta nemmeno un bordo
// libero), quindi uno swipe che parte su una carta non girava mai la pagina
// (riprodotto con eventi touch reali: pointerdown/move/up consegnati alla
// carta, nessun cambio di pagina). Questo ponte riconosce lo swipe
// orizzontale che parte su una tasca e lo gira al motore tramite la sua API
// pubblica (startUserTouch/userMove/userStop), cosi' la piega segue il dito
// come per i gesti partiti altrove. Un gesto verticale resta del browser
// (scroll della pagina, vedi allowTouchScroll), un tap resta un tap (il link
// si apre), e il click che il browser genererebbe alla fine di uno swipe
// corto sulla stessa carta viene scartato.
// Una pagina per facciata (4 tasche invece di 9) su telefono e tablet stretto
// e anche su un telefono girato in orizzontale: li' l'altezza e' di poche
// centinaia di pixel, e con due facciate da 9 tasche il libro (dimensionato
// sull'altezza) restava largo meno di 200px e illeggibile.
const SINGLE_PAGE_QUERY = "(max-width: 767px), (max-width: 1023px) and (orientation: portrait), (max-height: 500px) and (orientation: landscape)";
const SWIPE_SLOP_PX = 12;
const SWIPE_FLICK_MS = 250;
const SWIPE_FLICK_MIN_PX = 30;

function useCardSwipeBridge(frameRef: React.RefObject<HTMLDivElement | null>, bookRef: React.RefObject<FlipBookHandle | null>) {
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let gesture: { id: number; sx: number; sy: number; at: number; started: boolean } | null = null;
    let suppressClickUntil = 0;
    // Dita appoggiate sul libro, nell'ordine di arrivo: con due dita (pinch o
    // zoom) il primo dito aveva gia' avviato un gesto di sfoglio e muovendosi
    // girava una pagina (riprodotto con un pinch touch vero: la pagina
    // cambiava). Alla comparsa del secondo dito il gesto viene annullato.
    const touches: number[] = [];
    // True da quando compare il secondo dito fino a quando le dita si sono
    // alzate tutte: in questo intervallo il motore non deve vedere nulla, o il
    // secondo dito (che ricade spesso su una zona senza link) conta come un
    // tocco sulla pagina e la gira.
    let multiTouch = false;
    let forwardingCancel = false;

    // Stesso sistema di coordinate che il motore usa per i propri gesti:
    // relativo a .stf__block, corretto per l'eventuale scala CSS.
    const toBookPos = (clientX: number, clientY: number) => {
      const block = frame.querySelector<HTMLElement>(".stf__block");
      if (!block) return null;
      const rect = block.getBoundingClientRect();
      const scaleX = block.offsetWidth > 0 && rect.width > 0 ? rect.width / block.offsetWidth : 1;
      const scaleY = block.offsetHeight > 0 && rect.height > 0 ? rect.height / block.offsetHeight : 1;
      return { x: (clientX - rect.left) / scaleX, y: (clientY - rect.top) / scaleY, height: block.offsetHeight };
    };

    const onDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse") return;
      if (!touches.includes(event.pointerId)) touches.push(event.pointerId);
      if (touches.length > 1) {
        if (!multiTouch) {
          multiTouch = true;
          if (gesture?.started) bookRef.current?.cancelTurn();
          // Il gesto del motore (partito altrove, non su una tasca) si annulla
          // con lo stesso evento che il browser gli manderebbe: pulisce lui
          // piega, animazione e stato interno.
          const block = frame.querySelector<HTMLElement>(".stf__block");
          if (block) {
            forwardingCancel = true;
            block.dispatchEvent(new PointerEvent("pointercancel", { pointerId: touches[0], pointerType: event.pointerType, bubbles: true }));
            forwardingCancel = false;
          }
        }
        gesture = null;
      }
      if (multiTouch) {
        event.stopPropagation();
        return;
      }
      if (gesture) return;
      if (!(event.target instanceof Element) || !event.target.closest("a[href]")) return;
      gesture = { id: event.pointerId, sx: event.clientX, sy: event.clientY, at: Date.now(), started: false };
    };
    const release = (event: PointerEvent) => {
      const index = touches.indexOf(event.pointerId);
      if (index >= 0) touches.splice(index, 1);
      if (touches.length === 0) multiTouch = false;
    };
    const onMove = (event: PointerEvent) => {
      if (multiTouch) {
        event.stopPropagation();
        return;
      }
      if (!gesture || event.pointerId !== gesture.id) return;
      const engine = bookRef.current?.pageFlip();
      if (!engine) return;
      if (!gesture.started) {
        const dx = event.clientX - gesture.sx;
        const dy = event.clientY - gesture.sy;
        if (Math.abs(dx) < SWIPE_SLOP_PX || Math.abs(dx) < Math.abs(dy) * 1.4) return;
        const start = toBookPos(gesture.sx, gesture.sy);
        if (!start) return;
        gesture.started = true;
        engine.startUserTouch({ x: start.x, y: start.y });
      }
      const pos = toBookPos(event.clientX, event.clientY);
      if (pos) engine.userMove({ x: pos.x, y: pos.y }, true);
      if (event.cancelable) event.preventDefault();
    };
    const onUp = (event: PointerEvent) => {
      const wasMulti = multiTouch;
      release(event);
      if (wasMulti) {
        event.stopPropagation();
        return;
      }
      if (!gesture || event.pointerId !== gesture.id) return;
      const current = gesture;
      gesture = null;
      if (!current.started) return;
      suppressClickUntil = Date.now() + 400;
      const engine = bookRef.current?.pageFlip();
      const pos = toBookPos(event.clientX, event.clientY);
      const start = toBookPos(current.sx, current.sy);
      if (!engine || !pos || !start) return;
      const dx = event.clientX - current.sx;
      const dy = Math.abs(event.clientY - current.sy);
      const flick = Math.abs(dx) > SWIPE_FLICK_MIN_PX && dy < SWIPE_FLICK_MIN_PX * 2 && Date.now() - current.at < SWIPE_FLICK_MS;
      if (flick) {
        const corner = start.y >= start.height / 2 ? "bottom" : "top";
        if (dx > 0) bookRef.current?.flipPrev(corner);
        else bookRef.current?.flipNext(corner);
      }
      engine.userStop({ x: pos.x, y: pos.y }, flick);
    };
    const onCancel = (event: PointerEvent) => {
      if (forwardingCancel) return;
      const wasMulti = multiTouch;
      release(event);
      if (wasMulti) {
        event.stopPropagation();
        return;
      }
      if (!gesture || event.pointerId !== gesture.id) return;
      const wasStarted = gesture.started;
      gesture = null;
      if (wasStarted) {
        suppressClickUntil = Date.now() + 400;
        bookRef.current?.cancelTurn();
      }
    };
    const onClick = (event: MouseEvent) => {
      if (Date.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    frame.addEventListener("pointerdown", onDown, true);
    frame.addEventListener("pointermove", onMove, true);
    frame.addEventListener("pointerup", onUp, true);
    frame.addEventListener("pointercancel", onCancel, true);
    frame.addEventListener("click", onClick, true);
    return () => {
      frame.removeEventListener("pointerdown", onDown, true);
      frame.removeEventListener("pointermove", onMove, true);
      frame.removeEventListener("pointerup", onUp, true);
      frame.removeEventListener("pointercancel", onCancel, true);
      frame.removeEventListener("click", onClick, true);
    };
  }, [frameRef, bookRef]);
}

export default function BinderBook({ cards, initialPage = 0, onPageChange, returnTo }: {
  cards: CardRow[];
  initialPage?: number;
  onPageChange?: (page: number) => void;
  returnTo: string;
}) {
  // Letto subito al primo render (il componente monta solo dopo che la
  // collezione e' stata caricata lato client, quindi window esiste): partire
  // da false e correggere dopo il mount faceva interpretare `initialPage`
  // con la densita' sbagliata e rimontava il libro a ogni apertura su telefono.
  const [singlePage, setSinglePage] = useState(() => typeof window !== "undefined" && window.matchMedia(SINGLE_PAGE_QUERY).matches);
  const singlePageRef = useRef(singlePage);
  const screens = useMemo(() => buildScreens(cards, singlePage ? 4 : 9), [cards, singlePage]);
  const [page, setPage] = useState(() => Math.max(0, Math.min(initialPage, screens.length - 1)));
  const [pageCount, setPageCount] = useState(screens.length);
  const [visiblePages, setVisiblePages] = useState<number[]>([0]);
  const bookRef = useRef<FlipBookHandle | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  useCardSwipeBridge(frameRef, bookRef);
  // Il blocco interno del motore (.stf__block) esiste solo dopo che il motore
  // ha montato il libro, e viene ricreato quando il libro viene rimontato
  // (key su singlePage): lo si cerca con un osservatore finche' compare.
  const [blockEl, setBlockEl] = useState<HTMLElement | null>(null);
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
    const media = window.matchMedia(SINGLE_PAGE_QUERY);
    const update = () => {
      const next = media.matches;
      const previous = singlePageRef.current;
      if (next === previous) return;
      singlePageRef.current = next;
      // Girando il telefono (o ridimensionando la finestra oltre la soglia)
      // cambia quante tasche ha ogni foglio, quindi lo stesso indice di
      // pagina indicherebbe altre carte: si resta sul foglio che contiene la
      // stessa prima carta. Il motore va ricreato (key sul libro) perche'
      // cambia l'intero elenco di pagine; il primo render dopo la ricreazione
      // e' istantaneo, senza animare uno sfoglio dalla copertina.
      setPage((current) => {
        if (current <= 0) return 0;
        const firstCard = (current - 1) * (previous ? 4 : 9);
        return 1 + Math.floor(firstCard / (next ? 4 : 9));
      });
      setHasOpened(false);
      setSinglePage(next);
      requestAnimationFrame(() => setHasOpened(true));
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  // Se la collezione si riduce (o cambia densita' per singlePage), `page`
  // puo' restare temporaneamente fuori dai nuovi limiti: si legge sempre
  // attraverso questo clamp calcolato al render, non c'e' bisogno di
  // "correggere" lo state con un effetto - il prossimo sfoglio reale lo
  // riallinea comunque via onPageChange.
  const clampedPage = Math.max(0, Math.min(page, screens.length - 1));

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const find = () => {
      const next = frame.querySelector<HTMLElement>(".stf__block");
      setBlockEl((current) => (current === next ? current : next));
    };
    const observer = new MutationObserver(find);
    observer.observe(frame, { childList: true, subtree: true });
    const frameId = requestAnimationFrame(find);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frameId);
    };
  }, [singlePage]);

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
        <div ref={frameRef} className="binder-book-frame">
          {/* Il dorso vive DENTRO il blocco del motore (portale), tra i fogli fermi
              (z-index 1) e il foglio che si gira (3-5): come un vero binder, la
              pagina che si solleva gli passa sopra. Prima era fratello del
              libro con z-index 5 e restava disegnato sopra al foglio in volo. */}
          {visiblePages.length > 1 && blockEl && createPortal(
            <div className="binder-center-spine" aria-hidden>
              <span className="binder-ring" /><span className="binder-ring" /><span className="binder-ring" />
            </div>,
            blockEl,
          )}
          <HTMLFlipBook
            key={singlePage ? "single" : "spread"}
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
            allowTouchScroll={true}
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

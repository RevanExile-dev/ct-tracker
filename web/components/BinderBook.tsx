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

// Chiave stabile per identita' di contenuto: usata per far rimontare
// ScreenView (e quindi far ripartire la dissolvenza .binder-page-fade)
// solo quando lo "schermo" mostrato cambia davvero, non ad ogni render.
function screenKey(screen: Screen | undefined): string {
  if (!screen) return "blank";
  return screen.kind === "cover" ? "cover" : `sheet-${screen.sheetNumber}`;
}

function ScreenView({ screen, returnTo, fade = false }: { screen: Screen | undefined; returnTo: string; fade?: boolean }) {
  const fadeClass = fade ? " binder-page-fade" : "";
  if (!screen) {
    return <div className={`binder-page binder-page-blank${fadeClass}`}><span className="text-ink-faint/50 text-xs font-mono">— fine binder —</span></div>;
  }
  if (screen.kind === "cover") {
    return (
      <div className={`binder-page binder-page-cover${fadeClass}`}>
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
    <div className={`binder-page binder-page-sheet${fadeClass}`}>
      <div className={`binder-sheet-grid ${screen.cells === 4 ? "binder-sheet-grid-4" : "binder-sheet-grid-9"}`}>
        {cells.map((card, index) => <Pocket key={card?.id ?? `empty-${index}`} card={card} returnTo={returnTo} />)}
      </div>
      <div className="absolute bottom-1.5 right-3 text-[9px] font-mono text-ink-faint">{screen.sheetNumber}/{screen.totalSheets}</div>
    </div>
  );
}

// Una faccia (fronte o retro) di uno dei due pannelli near/far dello sfoglio.
// Renderizza la pagina INTERA a doppia larghezza dentro una finestra
// overflow:hidden (binder-flip-window/slice, vedi CSS): a seconda di quale
// meta' (.binder-flip-near o .binder-flip-far, dedotto dal CSS via
// data-direction, non serve saperlo qui) la contiene, si vede ritagliata
// solo la meta' sinistra o destra - le due meta' ricostruiscono la pagina
// intera quando sono piatte (progress 0/1), esattamente come un pannello
// unico prima di questa modifica.
function FlipFace({ screen, returnTo, back = false }: { screen: Screen | undefined; returnTo: string; back?: boolean }) {
  return (
    <div className={`binder-flip-face ${back ? "binder-flip-back" : "binder-flip-front"}`}>
      <div className="binder-flip-window">
        <div className="binder-flip-slice">
          <ScreenView screen={screen} returnTo={returnTo} />
        </div>
      </div>
      <div className="binder-flip-shade" />
    </div>
  );
}

// Fase dello sfoglio in corso:
// - "live": trascinamento attivo, il transform e' scritto ad ogni frame via
//   ref (segue dito/cursore 1:1), nessuna transizione CSS.
// - "completing"/"cancelling": il progress viene animato via rAF
//   verso il traguardo (rispettivamente pagina girata del tutto o tornata
//   a piatta) - usata sia al rilascio di un drag sia da un turn() discreto
//   (bottone/tastiera, che salta direttamente qui con progress=0).
type FlipPhase = "live" | "completing" | "cancelling";
type Flip = { direction: "next" | "prev"; phase: FlipPhase };

// Soglia oltre la quale un movimento orizzontale diventa "drag" (blocca il
// click sulla carta sottostante) invece di restare un tap o uno scroll
// verticale che deve continuare a scorrere normalmente.
const LOCK_THRESHOLD_PX = 9;
// Oltre questa frazione di pagina trascinata, il rilascio completa lo
// sfoglio invece di tornare indietro.
const COMPLETE_PROGRESS = 0.35;
// Un rilascio abbastanza veloce (px/ms) completa lo sfoglio anche se il
// trascinamento non ha superato COMPLETE_PROGRESS - un "flick" deciso.
const FLICK_VELOCITY_PX_MS = 0.55;
// Piega massima (gradi) tra i due pannelli near/far a meta' gesto - vedi
// paintProgress per la geometria. 0 renderebbe il vecchio flip piatto a
// lastra unica (sparisce del tutto a 90 gradi, non voluto); troppo alto
// sembra un ventaglio invece di una pagina che si piega.
const BEND_MAX_DEG = 46;
// Durata dell'animazione di uno sfoglio completo (bottone/tastiera, o un
// drag che parte da progress=0) - durata dell'assestamento per un drag
// e' invece proporzionale alla distanza restante, con questo come tetto.
const SETTLE_BASE_MS = 680;
const SETTLE_MIN_MS = 140;
// Margine oltre la durata attesa prima che la rete di sicurezza (nel caso
// transitionend non arrivi mai - tab in background, frame drop) concluda
// comunque lo sfoglio.
const SETTLE_SAFETY_MARGIN_MS = 220;

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  locked: boolean;
  direction: "next" | "prev" | null;
  pageWidth: number;
  progress: number;
  // Ultimi due campioni (posizione, istante) del gesto, usati a rilascio
  // per stimare la velocita' istantanea - due soli campioni bastano per un
  // rilascio ("cosa stava succedendo nell'ultimo tratto") senza dover
  // accumulare una storia intera del gesto.
  sampleX: number;
  sampleT: number;
  prevSampleX: number;
  prevSampleT: number;
};

// Velocita' istantanea (px/ms) nella direzione che fa AVANZARE il progress
// (non il segno grezzo di dx) - stimata dagli ultimi due campioni di
// pointermove registrati durante il trascinamento.
function dragVelocity(drag: DragState): number {
  const dt = drag.sampleT - drag.prevSampleT;
  if (dt <= 0 || !drag.direction) return 0;
  const dxDelta = drag.sampleX - drag.prevSampleX;
  return drag.direction === "next" ? -dxDelta / dt : dxDelta / dt;
}

export default function BinderBook({ cards, initialPage = 0, onPageChange, returnTo }: {
  cards: CardRow[];
  initialPage?: number;
  onPageChange?: (page: number) => void;
  returnTo: string;
}) {
  const [singlePage, setSinglePage] = useState(false);
  const [page, setPage] = useState(Math.max(0, initialPage));
  const [flip, setFlip] = useState<Flip | null>(null);
  const bookRef = useRef<HTMLDivElement>(null);
  const settlingRef = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const flipNearRef = useRef<HTMLDivElement>(null);
  const flipFarRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const rafRef = useRef<number | null>(null);
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

  function cancelRaf() {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }

  // Applica ai due pannelli (near = attaccato al dorso, far = lembo libero,
  // nidificato dentro near) il transform/ombra corrispondenti al progress
  // corrente (0-1) - unico punto che scrive sul DOM durante il trascinamento,
  // cosi' i pointermove restano leggeri (aggiornano solo dragRef) e il ritmo
  // reale delle scritture e' quello dei frame, non degli eventi di input.
  //
  // Geometria (perche' due pannelli e non uno): un singolo pannello rigido
  // ruotato con rotateY sparisce del tutto a progress=0.5 (di taglio verso
  // la camera) - una pagina vera non lo fa mai, resta sempre visibile come
  // sagoma curva. "total" e' l'angolo che avrebbe un pannello unico rigido;
  // "bend" (0 agli estremi, massimo a meta' gesto) e' quanto i due pannelli
  // si separano tra loro. near resta "indietro" di meta' bend, far (la cui
  // rotazione e' LOCALE, nidificata dentro near, quindi si somma alla sua)
  // "avanti" di meta' bend - insieme formano una V che non collassa mai a
  // una linea, pur restando esattamente piatti e indistinguibili da un
  // pannello unico quando bend=0 (progress 0 o 1, verificato visivamente
  // prima di integrare: nessuna differenza a riposo).
  function paintProgress(direction: "next" | "prev", progress: number) {
    const near = flipNearRef.current;
    const far = flipFarRef.current;
    if (!near || !far) return;
    const sign = direction === "next" ? -1 : 1;
    const total = progress * 180;
    const bend = BEND_MAX_DEG * Math.sin(progress * Math.PI);
    const aNear = sign * (total - bend / 2);
    const bFarLocal = sign * bend;
    near.style.transform = `rotateY(${aNear}deg)`;
    far.style.transform = `rotateY(${bFarLocal}deg)`;
    near.style.setProperty("--flip-shadow", String(Math.sin(progress * Math.PI)));
  }

  // Coda un aggiornamento continuo: legge il progress corrente da dragRef
  // ad ogni frame finche' il drag resta "locked", invece di dipingere
  // direttamente dentro l'handler di pointermove (che puo' ricevere eventi
  // piu' spesso di quanto il browser dipinga davvero).
  function scheduleDragPaint() {
    cancelRaf();
    function tick() {
      const drag = dragRef.current;
      if (!drag || !drag.locked || !drag.direction) { rafRef.current = null; return; }
      paintProgress(drag.direction, drag.progress);
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  // Risolve definitivamente lo sfoglio in corso (chiamata sia da
  // completamento rAF sia dalla rete di sicurezza a timeout): se completing
  // avanza la pagina, altrimenti la lascia invariata. Ripulisce sempre gli
  // stili imperativi cosi' il prossimo sfoglio riparte da uno stato pulito.
  //
  // "direction" arriva come parametro esplicito (non letto da "current" in
  // un updater funzionale di setFlip): chiamare setPage() DENTRO l'updater
  // di setFlip e' un side-effect innestato in un updater, che React
  // StrictMode (dev) invoca due volte per rilevare impurita' - risultato
  // reale osservato, isolato con log mirati: un solo click avanzava la
  // pagina di 2*step invece di step. Con direction passata dall'esterno
  // (dal chiamante, che ce l'ha gia' in scope) le due setState restano
  // pure e indipendenti, nessun doppio incremento possibile.
  function resolveFlip(direction: "next" | "prev", completing: boolean) {
    // Frame completion and timeout must never advance the page twice.
    if (!settlingRef.current) return;
    settlingRef.current = false;
    clearFlipTimeout();
    cancelRaf();
    if (completing) {
      setPage((page) => Math.max(0, Math.min(screens.length - 1, page + (direction === "next" ? step : -step))));
    }
    setFlip(null);
    const near = flipNearRef.current;
    const far = flipFarRef.current;
    if (near) {
      near.style.transform = "";
      near.style.transitionDuration = "";
      near.style.removeProperty("--flip-shadow");
    }
    if (far) {
      far.style.transform = "";
      far.style.transitionDuration = "";
    }
  }

  function armSettleTimeout(direction: "next" | "prev", durationMs: number, completing: boolean) {
    clearFlipTimeout();
    flipTimeoutRef.current = setTimeout(() => resolveFlip(direction, completing), durationMs + SETTLE_SAFETY_MARGIN_MS);
  }

  // Interpolate progress through the existing bend curve. CSS interpolation
  // between two flat endpoints skipped the bend entirely on button turns.
  function settleTo(direction: "next" | "prev", fromProgress: number, completing: boolean) {
    cancelRaf();
    settlingRef.current = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      resolveFlip(direction, completing);
      return;
    }
    const remaining = completing ? 1 - fromProgress : fromProgress;
    const duration = Math.max(SETTLE_MIN_MS, remaining * SETTLE_BASE_MS);
    const targetProgress = completing ? 1 : 0;
    setFlip({ direction, phase: completing ? "completing" : "cancelling" });
    let startedAt: number | null = null;
    function animate(now: number) {
      if (!settlingRef.current) return;
      if (!flipNearRef.current || !flipFarRef.current) {
        rafRef.current = requestAnimationFrame(animate);
        return;
      }
      if (startedAt === null) startedAt = now;
      const t = Math.min(1, (now - startedAt) / duration);
      const eased = t * t * (3 - 2 * t);
      paintProgress(direction, fromProgress + (targetProgress - fromProgress) * eased);
      if (t === 1) resolveFlip(direction, completing);
      else rafRef.current = requestAnimationFrame(animate);
    }
    rafRef.current = requestAnimationFrame(animate);
    armSettleTimeout(direction, duration, completing);
  }

  function turn(direction: "next" | "prev") {
    if (flip || settlingRef.current || (direction === "next" ? !canNext : !canPrev)) return;
    settleTo(direction, 0, true);
  }

  // Smontaggio a meta' di uno sfoglio (navigazione via, cambio di
  // viewPage/schermi che rimonta il componente): senza questo cleanup il
  // loop rAF di scheduleDragPaint non si ferma mai da solo (esce solo
  // quando drag.locked torna false) e continuerebbe a girare a vuoto ad
  // ogni frame, e il timeout di sicurezza chiamerebbe comunque
  // resolveFlip su un componente ormai smontato.
  useEffect(() => () => { clearFlipTimeout(); cancelRaf(); }, []);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      const target = event.target;
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey
        || !(target instanceof HTMLElement) || !bookRef.current?.contains(target)
        || target.closest("input, select, textarea, [contenteditable='true'], [role='slider']")) return;
      if (event.key === "ArrowRight" || event.key === "PageDown") { event.preventDefault(); turn("next"); }
      if (event.key === "ArrowLeft" || event.key === "PageUp") { event.preventDefault(); turn("prev"); }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // Controlla anche dragRef (non solo lo state React "flip"): un secondo
    // dito che tocca lo stage puo' generare il suo pointerdown prima che il
    // re-render innescato dal lock del primo gesto sia gia' stato applicato
    // (flip resterebbe momentaneamente il valore "vecchio" nella closure di
    // questo handler) - dragRef e' un ref, sempre aggiornato in modo
    // sincrono, quindi non soggetto a questo scarto (trovato in review,
    // scenario multi-touch non coperto dal solo controllo su flip).
    if (flip || settlingRef.current || dragRef.current || !event.isPrimary || event.button !== 0) return;
    const now = performance.now();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      locked: false,
      direction: null,
      pageWidth: 1,
      progress: 0,
      sampleX: event.clientX,
      sampleT: now,
      prevSampleX: event.clientX,
      prevSampleT: now,
    };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;

    if (!drag.locked) {
      if (Math.abs(dx) < LOCK_THRESHOLD_PX && Math.abs(dy) < LOCK_THRESHOLD_PX) return; // ancora indeciso
      if (Math.abs(dy) >= Math.abs(dx)) { dragRef.current = null; return; } // verticale: lascia scorrere la pagina
      const direction = dx < 0 ? "next" : "prev";
      if (direction === "next" ? !canNext : !canPrev) { dragRef.current = null; return; } // non c'e' una pagina in quella direzione
      const stageRect = stageRef.current?.getBoundingClientRect();
      const pageWidth = stageRect ? (singlePage ? stageRect.width : stageRect.width / 2) : 1;
      drag.locked = true;
      drag.direction = direction;
      drag.pageWidth = Math.max(1, pageWidth);
      didSwipe.current = true; // sopprime il click sintetico che seguira' il rilascio
      // Non sul touch: serve a continuare a ricevere pointermove/up anche
      // se il cursore esce dai bordi dello stage durante il trascinamento,
      // ma il touch ha gia' una "cattura implicita" nativa (verificato: senza
      // chiamare setPointerCapture i pointermove/up continuano ad arrivare
      // regolarmente) - chiamarla comunque su un pointer touch ha innescato
      // in pratica un lostpointercapture spurio quasi subito dopo l'inizio
      // del gesto (isolato con log mirati: il drag veniva annullato dopo un
      // solo pointermove, con gli eventi successivi che continuavano ad
      // arrivare regolarmente ma ormai ignorati perche' il nostro stato
      // interno era gia' stato azzerato). Non "=== mouse": una penna/stilo
      // (pointerType "pen") non ha la cattura implicita del touch, quindi va
      // trattata come il mouse qui, non esclusa insieme al touch.
      if (event.pointerType !== "touch") event.currentTarget.setPointerCapture(event.pointerId);
      setFlip({ direction, phase: "live" });
      scheduleDragPaint();
    }

    if (!drag.locked || !drag.direction) return;
    const raw = drag.direction === "next" ? -dx / drag.pageWidth : dx / drag.pageWidth;
    drag.progress = Math.min(1, Math.max(0, raw));
    drag.prevSampleX = drag.sampleX;
    drag.prevSampleT = drag.sampleT;
    drag.sampleX = event.clientX;
    drag.sampleT = performance.now();
  }

  function endDrag(cancel: boolean) {
    const drag = dragRef.current;
    dragRef.current = null;
    cancelRaf();
    if (!drag || !drag.locked || !drag.direction) return;
    window.setTimeout(() => { didSwipe.current = false; }, 0);
    if (cancel) {
      // pointercancel: mai completare su un gesto interrotto dal sistema
      // (es. una notifica, un cambio di scroll) - torna sempre indietro.
      settleTo(drag.direction, drag.progress, false);
      return;
    }
    const completing = drag.progress >= COMPLETE_PROGRESS || Math.abs(dragVelocity(drag)) >= FLICK_VELOCITY_PX_MS;
    settleTo(drag.direction, drag.progress, completing);
  }

  function handlePointerUp() {
    endDrag(false);
  }

  function handlePointerCancel() {
    endDrag(true);
  }

  const nextStart = viewPage + step;
  const prevStart = Math.max(0, viewPage - step);
  const left = screens[viewPage];
  const right = singlePage ? undefined : screens[viewPage + 1];
  const underlyingLeft = flip?.direction === "prev" ? screens[prevStart] : left;
  const underlyingRight = singlePage
    ? undefined
    : flip?.direction === "next" ? screens[nextStart + 1] : right;
  const flipFrontScreen = flip ? (singlePage ? left : flip.direction === "next" ? right : left) : undefined;
  const flipBackScreen = flip ? (flip.direction === "next" ? screens[nextStart] : screens[prevStart + (singlePage ? 0 : 1)]) : undefined;

  return (
    <div ref={bookRef} className="w-full">
      <div
        ref={stageRef}
        className={`binder-stage ${singlePage ? "binder-stage-single" : "binder-stage-spread"} ${flip?.phase === "live" ? "binder-stage-dragging" : ""}`}
        aria-label="Binder sfogliabile"
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handlePointerCancel}
        // Le immagini delle carte e i link <a> sono trascinabili nativamente
        // di default: senza questo, un mousedown+move su una carta avvia il
        // drag-and-drop HTML5 del browser invece del nostro sfoglio,
        // interrompendolo con un pointercancel quasi immediato (bug reale,
        // isolato loggando gli eventi - il pointercancel arrivava a
        // progress ~0.08, appena iniziato il gesto).
        onDragStart={(event) => event.preventDefault()}
        onClickCapture={(event) => {
          if (didSwipe.current) { event.preventDefault(); event.stopPropagation(); }
        }}
      >
        <div className={`binder-spread ${singlePage ? "is-single" : "is-double"}`}>
          <div className="binder-slot binder-slot-left"><ScreenView key={screenKey(underlyingLeft)} screen={underlyingLeft} returnTo={returnTo} fade /></div>
          {!singlePage && (
            <>
              <div className="binder-spine" aria-hidden><span className="binder-ring" /><span className="binder-ring" /><span className="binder-ring" /></div>
              <div className="binder-slot binder-slot-right"><ScreenView key={screenKey(underlyingRight)} screen={underlyingRight} returnTo={returnTo} fade /></div>
            </>
          )}

          {flip && (
            // Decorativo puro durante l'animazione: la pagina reale e
            // cliccabile e' quella statica sottostante, rivelata a fine
            // sfoglio - da qui pointer-events:none in CSS, niente carte
            // "fantasma" cliccabili a meta' gesto sulle 4 copie sotto.
            <div
              className={`binder-flip ${singlePage ? "binder-flip-single" : ""} ${flip.phase === "live" ? "binder-flip-live" : ""}`}
              data-direction={flip.direction}
              aria-hidden
              inert
            >
              <div
                ref={flipNearRef}
                className="binder-flip-near"
              >
                <FlipFace screen={flipFrontScreen} returnTo={returnTo} />
                <FlipFace screen={flipBackScreen} returnTo={returnTo} back />
                <div className="binder-flip-crease" />
                <div ref={flipFarRef} className="binder-flip-far">
                  <FlipFace screen={flipFrontScreen} returnTo={returnTo} />
                  <FlipFace screen={flipBackScreen} returnTo={returnTo} back />
                </div>
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
      <p className="mt-3 text-center text-[11px] font-mono text-ink-faint">Trascina o swipe · frecce ← → su tastiera</p>
    </div>
  );
}

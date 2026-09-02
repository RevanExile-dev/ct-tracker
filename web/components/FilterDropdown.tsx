"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const TRANSITION_MS = 220;

type Props = {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (option: string) => void;
  renderOption?: (option: string) => React.ReactNode;
  searchable?: boolean;
  getSearchText?: (option: string) => string;
  layout?: "pills" | "list";
  footerNote?: React.ReactNode;
  closeOnSelect?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/**
 * Pannello filtro come overlay "fuori flusso" (position: fixed/absolute),
 * mai in-flow: da chiuso il nodo non e' proprio nel DOM (mounted=false),
 * quindi non puo' MAI influenzare la larghezza/altezza degli antenati, in
 * nessuno stato intermedio della transizione - a differenza del precedente
 * approccio "in-flow con grid-template-rows animato + content-visibility"
 * che, restando nel flusso, poteva ancora contare per il layout mentre
 * era visivamente collassato (bug reale osservato piu' volte).
 * Su telefono e' un bottom sheet con un vero backdrop dedicato (chiusura
 * su tap del backdrop, un solo evento click reale) invece di listener
 * document-level duplicati (mousedown + touchstart) per ogni istanza:
 * quella duplicazione, su touch, e' la sospetta causa della chiusura
 * "a scatto" appena dopo l'apertura (iOS/alcuni Android sintetizzano
 * un'intera sequenza di eventi mouse dopo il touch). Su desktop resta un
 * popover ancorato al trigger, chiuso da un singolo listener "pointerdown"
 * fuori dal pannello, agganciato un tick dopo l'apertura cosi' il tap che
 * apre non puo' anche richiuderlo nello stesso giro.
 */
export default function FilterDropdown({
  label, options, selected, onToggle, renderOption, searchable = false,
  getSearchText, layout = "pills", footerNote, closeOnSelect = false,
  open: controlledOpen, onOpenChange,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const [query, setQuery] = useState("");
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  // Due ref/id distinti (desktop e mobile), MAI condivisi: il pannello
  // desktop (nascosto sotto sm, "hidden sm:block") e il modale mobile in
  // portale renderizzano entrambi il corpo del filtro (ricerca inclusa)
  // SEMPRE, uno dei due semplicemente nascosto via CSS in base al
  // breakpoint - mai smontato. Usare lo stesso id/ref per entrambi (come
  // in una versione precedente) produceva ID duplicati nel DOM (HTML non
  // valido: un <label htmlFor> si lega sempre al primo, che e' quello
  // desktop anche su schermi stretti) e un ref che finiva per puntare a
  // un solo input a seconda dell'ordine di commit - su desktop, quello
  // nascosto: l'autofocus della ricerca chiamava .focus() su un elemento
  // display:none, un no-op silenzioso (bug reale, trovato investigando
  // una segnalazione di filtri "buggati" su piu' browser/device).
  const desktopSearchInputRef = useRef<HTMLInputElement>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement>(null);
  const desktopPanelRef = useRef<HTMLDivElement>(null);
  // Il popover desktop e' ancorato con left-0 al trigger, ma alcuni
  // pannelli (es. "Tutte le espansioni", layout list con date) sono larghi
  // fino a 34rem - se il trigger non e' abbastanza vicino al bordo
  // sinistro, il pannello esce dal viewport a destra e la parte tagliata
  // (compreso il bordo destro della casella di ricerca) resta invisibile
  // (body ha overflow-x:hidden). Corretto misurando la posizione reale del
  // trigger dopo il mount e traslando il pannello a sinistra solo quanto
  // serve per restare dentro al viewport, mai oltre quanto serve per non
  // uscire anche a sinistra. Scrive direttamente la custom property CSS sul
  // nodo (non uno state React): serve un useLayoutEffect per correggere
  // PRIMA del paint, ed è deliberatamente imperativo per evitare un giro di
  // render in più solo per applicare uno shift visivo.
  // Il bottom sheet mobile e' in portale su document.body, quindi NON e' un
  // discendente DOM di rootRef: senza questo ref, il listener "fuori dal
  // pannello chiudi" (pensato per il popover desktop) scambierebbe ogni tap
  // dentro al foglio (casella di ricerca, pillole) per un tap fuori,
  // richiudendolo all'istante - bug reale, trovato in review, non solo
  // teorico (i test lo mascheravano perche' toccavano solo opzioni con
  // closeOnSelect, che chiudono comunque).
  const mobileSheetRef = useRef<HTMLDivElement>(null);

  // mounted: il pannello e' nel DOM (true durante apertura, resta true
  // durante l'animazione di chiusura, poi torna false a transizione finita
  // - quindi anche il createPortal(...) non viene mai valutato prima
  // dell'idratazione lato client, "mounted" parte sempre da false).
  // visible: guida la transizione CSS (entra/esce), un frame dopo il
  // mount cosi' il browser fa in tempo a dipingere lo stato di partenza
  // prima di animare verso quello finale. Due effetti separati, ciascuno
  // con un solo compito: piu' semplice e piu' robusto del precedente
  // tentativo con lo stato derivato durante il render (che empiricamente,
  // verificato con log mirati, produceva uno "mounted" incoerente dopo il
  // giro innescato dal rAF di "visible" - niente teoria, comportamento
  // osservato). Ogni setState qui e' dentro una callback rAF/timeout, mai
  // sincrono nel corpo dell'effetto (regola di lint del progetto).
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(open);

  useEffect(() => {
    if (open) {
      const raf = requestAnimationFrame(() => setMounted(true));
      return () => cancelAnimationFrame(raf);
    }
    const timer = window.setTimeout(() => setMounted(false), TRANSITION_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (open && mounted) {
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    if (!open) {
      const raf = requestAnimationFrame(() => setVisible(false));
      return () => cancelAnimationFrame(raf);
    }
  }, [open, mounted]);

  useLayoutEffect(() => {
    if (!open || !mounted) return;
    const panel = desktopPanelRef.current;
    if (!panel) return;
    function reposition() {
      const root = rootRef.current;
      if (!panel || !root || window.innerWidth < 640) return; // sotto sm il popover desktop non e' nemmeno renderizzato
      const rootRect = root.getBoundingClientRect();
      const margin = 20;
      const naturalRight = rootRect.left + panel.offsetWidth; // posizione senza correzioni (left-0)
      let shift = naturalRight > window.innerWidth - margin ? window.innerWidth - margin - naturalRight : 0;
      shift = Math.max(shift, margin - rootRect.left); // mai cosi' a sinistra da uscire anche li'
      panel.style.setProperty("--tw-translate-x", shift ? `${shift}px` : "0px");
    }
    reposition();
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("resize", reposition);
      panel.style.removeProperty("--tw-translate-x");
    };
  }, [open, mounted]);

  const setOpen = useCallback((next: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  }, [controlledOpen, onOpenChange]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, [setOpen]);

  const focusTrigger = useCallback(() => {
    rootRef.current?.querySelector<HTMLButtonElement>("[aria-expanded]")?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    // Anche "mounted" in dipendenza: al primo giro con open=true l'input di
    // ricerca non esiste ancora nel DOM (mounted e' ancora false, arriva un
    // rAF dopo), quindi il ref sarebbe null e il focus fallirebbe in
    // silenzio senza mai piu' ritentare (bug reale trovato in review).
    // Sceglie l'istanza REALMENTE visibile in base al breakpoint (stesso
    // "sm" di Tailwind, 640px, non personalizzato in questo progetto):
    // chiamare .focus() sull'istanza nascosta via CSS e' un no-op silenzioso.
    // preventScroll:true e' essenziale su desktop: il pannello (w-max, fino
    // a 34rem) puo' estendersi oltre il contenitore overflow-hidden che
    // anima l'apertura/chiusura della barra filtri, allargandone l'area di
    // scroll interna - senza preventScroll il browser porta l'input appena
    // messo a fuoco in vista scrollando QUEL contenitore (invisibile,
    // niente scrollbar perche' overflow-hidden), spostando l'intera barra
    // filtri a sinistra senza alcun modo per l'utente di tornare indietro
    // (bug reale segnalato dall'utente con screenshot, riprodotto e
    // confermato: scrollLeft del contenitore passava a 126px al focus).
    if (open && mounted && searchable) {
      const raf = requestAnimationFrame(() => {
        const isDesktop = window.matchMedia("(min-width: 640px)").matches;
        (isDesktop ? desktopSearchInputRef : mobileSearchInputRef).current?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [open, mounted, searchable]);

  useEffect(() => {
    if (!open) return;

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        close();
        focusTrigger();
      }
    }
    function handleOutside(event: PointerEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (mobileSheetRef.current?.contains(target)) return;
      close();
    }

    document.addEventListener("keydown", handleKey);
    // Agganciato un tick dopo, non subito: il pointerdown/click che ha
    // APERTO il pannello sta ancora "viaggiando" nello stesso giro di
    // eventi - registrarsi troppo presto rischia di intercettarlo e
    // richiudere all'istante lo stesso pannello appena aperto.
    const attachTimer = window.setTimeout(() => {
      document.addEventListener("pointerdown", handleOutside);
    }, 0);
    return () => {
      document.removeEventListener("keydown", handleKey);
      window.clearTimeout(attachTimer);
      document.removeEventListener("pointerdown", handleOutside);
    };
  }, [open, close, focusTrigger]);

  const filtered = searchable && query
    ? options.filter((option) =>
        (getSearchText ? getSearchText(option) : option)
          .toLocaleLowerCase("it")
          .includes(query.toLocaleLowerCase("it"))
      )
    : options;

  if (options.length === 0) return null;

  function selectOption(option: string) {
    onToggle(option);
    if (closeOnSelect) {
      close();
      focusTrigger();
    }
  }

  const optionButtonClass = (active: boolean) =>
    layout === "list"
      ? `min-h-11 text-left text-sm px-3 py-2.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 ${active ? "bg-accent/10 text-accent-bright" : "text-ink-muted hover:bg-base-surface2 hover:text-ink-primary"}`
      : `min-h-11 text-sm px-3 py-2.5 rounded-full border transition-[color,background-color,border-color,transform] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 ${active ? "bg-accent/10 border-accent/60 text-accent-bright" : "bg-base-surface2 border-base-border text-ink-muted hover:text-ink-primary"}`;

  // Genera il corpo del pannello per UNA istanza (id e ref parametrizzati
  // in base a idSuffix) - mai un unico blocco JSX riusato in due punti
  // dell'albero, altrimenti desktop e mobile finiscono con lo stesso id
  // (HTML non valido) e lo stesso ref dell'input di ricerca (uno dei due
  // .focus() diventa un no-op silenzioso su un elemento display:none).
  function renderOptionsBody(idSuffix: string, inputRef: React.RefObject<HTMLInputElement | null>) {
    const searchId = `${panelId}-search-${idSuffix}`;
    return (
    <>
      {searchable && (
        <div className="p-2 border-b border-base-border shrink-0">
          <label className="sr-only" htmlFor={searchId}>Cerca in {label.toLocaleLowerCase("it")}</label>
          <input
            ref={inputRef}
            id={searchId}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cerca…"
            className="w-full bg-base-surface2 border border-base-border rounded-lg px-3 py-2.5 text-sm text-ink-primary placeholder:text-ink-faint outline-none focus:border-accent/60"
          />
        </div>
      )}
      <div className={`overflow-y-auto overscroll-contain ${layout === "list" ? "flex flex-col p-2 gap-0.5" : "flex flex-wrap gap-2 p-3"}`}>
        {filtered.length === 0 && <div className="text-sm text-ink-faint px-2 py-2">Nessun risultato.</div>}
        {filtered.map((option) => {
          const active = selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              aria-pressed={active}
              onClick={() => selectOption(option)}
              className={optionButtonClass(active)}
            >
              {renderOption ? renderOption(option) : option}
            </button>
          );
        })}
      </div>
      {footerNote && <div className="border-t border-base-border px-3 py-2 text-[11px] text-ink-faint shrink-0">{footerNote}</div>}
    </>
    );
  }

  return (
    <div ref={rootRef} className="filter-inline relative max-w-full">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={mounted ? panelId : undefined}
        onClick={() => setOpen(!open)}
        className="filter-trigger min-h-11 cursor-pointer select-none text-xs font-mono uppercase tracking-wider text-ink-muted hover:text-ink-primary flex items-center gap-2 rounded-lg px-2 -mx-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
      >
        <span aria-hidden className={`transition-transform duration-200 ${open ? "rotate-90" : ""}`}>▸</span>
        <span>{label}</span>
        {selected.length > 0 && (
          <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-accent-bright">{selected.length}</span>
        )}
      </button>

      {/* Desktop/tablet: popover ancorato al trigger, sopra il contenuto
          (position: absolute, mai in flusso) - non spinge giu' nulla ne'
          conta per la larghezza del genitore, ne' da aperto ne' da chiuso. */}
      {mounted && (
        <div
          ref={desktopPanelRef}
          id={panelId}
          role="dialog"
          aria-modal="false"
          aria-hidden={!open}
          // Il useLayoutEffect qui sopra scrive --tw-translate-x
          // direttamente sul nodo (stessa variabile che Tailwind usa per
          // translate-y-*, cosi' si combinano in un solo transform invece
          // di scavalcarsi) per tenere il pannello dentro al viewport
          // quando il trigger e' abbastanza a destra da farlo uscire - es.
          // "Tutte le espansioni" (fino a 34rem di larghezza) su schermi
          // desktop non larghissimi (bug reale, trovato verificando il fix
          // dello scroll qui sopra: la casella di ricerca finiva con il
          // bordo destro fuori dal viewport, invisibile per via di
          // overflow-x:hidden su body).
          className={`filter-panel-anim hidden sm:block absolute left-0 top-[calc(100%+0.5rem)] z-40 w-max max-w-[min(34rem,calc(100vw-2.5rem))] rounded-card border border-base-border bg-base-surface shadow-card transition-[opacity,transform] duration-200 ease-out ${
            visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1 pointer-events-none"
          }`}
        >
          <div className={layout === "list" ? "flex flex-col max-h-80" : "flex flex-col max-h-[28rem]"}>
            {renderOptionsBody("desktop", desktopSearchInputRef)}
          </div>
        </div>
      )}

      {/* Telefono: modale centrato in portale su document.body (non un
          bottom sheet - richiesto esplicitamente: "quando apro un filtro
          nn si posiziona in centro"), con backdrop dedicato - chiusura
          affidabile con UN solo evento click reale sul backdrop, niente
          listener document-level duplicati da inseguire. */}
      {mounted && createPortal(
        <div className="sm:hidden fixed inset-0 z-50 flex items-center justify-center p-4" aria-hidden={!open}>
          <div
            onClick={() => { close(); focusTrigger(); }}
            className={`filter-panel-anim absolute inset-0 bg-black/50 transition-opacity duration-200 ease-out ${visible ? "opacity-100" : "opacity-0"}`}
          />
          <div
            ref={mobileSheetRef}
            id={`${panelId}-mobile`}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            className={`filter-panel-anim relative w-full max-w-sm max-h-[80vh] flex flex-col rounded-2xl border border-base-border bg-base-surface shadow-card transition-[opacity,transform] duration-200 ${
              visible ? "opacity-100 scale-100 ease-out" : "opacity-0 scale-95 ease-in"
            }`}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-base-border shrink-0">
              <span className="text-sm font-mono uppercase tracking-wider text-ink-primary">{label}</span>
              <button
                type="button"
                onClick={() => { close(); focusTrigger(); }}
                aria-label="Chiudi"
                className="min-h-11 min-w-11 flex items-center justify-center rounded-full text-ink-faint hover:text-ink-primary hover:bg-base-surface2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
              >
                ✕
              </button>
            </div>
            <div className="flex flex-col overflow-y-auto">{renderOptionsBody("mobile", mobileSearchInputRef)}</div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

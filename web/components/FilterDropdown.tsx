"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

type Placement = { x: "left" | "right"; y: "down" | "up" };

/** Filtro a tendina "flottante": si apre sopra il contenuto (non lo spinge
 * in basso) e si chiude da solo cliccando fuori o con Esc — a differenza di
 * <details>/<summary>, che resta aperto finche' non si ri-clicca lo stesso
 * toggle e sposta il contenuto sotto quando e' aperto.
 *
 * Si posiziona da solo (flip a sinistra/sopra se non c'e' spazio a destra/
 * sotto, misurato via getBoundingClientRect prima del paint) invece di
 * uscire dal viewport su schermi stretti — bug reale trovato usando il
 * sito su mobile. */
export default function FilterDropdown({
  label,
  options,
  selected,
  onToggle,
  renderOption,
  searchable = false,
  getSearchText,
  layout = "pills",
  footerNote,
  closeOnSelect = false,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (option: string) => void;
  renderOption?: (option: string) => React.ReactNode;
  /** Aggiunge un campo di ricerca in cima al pannello, utile con tante opzioni
   * (es. l'elenco espansioni) dove scorrere a mano e' scomodo. */
  searchable?: boolean;
  /** Testo su cui cercare per opzione, se diverso dal valore grezzo (es. il
   * nome espansione invece del suo codice interno). */
  getSearchText?: (option: string) => string;
  /** "pills": bottoncini affiancati che vanno a capo (rarita'/lingua/condizione).
   * "list": una colonna scorrevole, piu' adatta a elenchi lunghi. */
  layout?: "pills" | "list";
  footerNote?: React.ReactNode;
  /** Chiude il pannello subito dopo una selezione — utile in modalita' "list"
   * dove di solito si sceglie una sola opzione alla volta. */
  closeOnSelect?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  const [placement, setPlacement] = useState<Placement>({ x: "left", y: "down" });
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointer(e: MouseEvent | TouchEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("touchstart", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("touchstart", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  // Apre subito (mounted=true) cosi' il pannello esiste nel DOM per essere
  // misurato, poi con un frame di ritardo attiva la classe "visibile" che fa
  // partire la transizione — altrimenti apertura/chiusura sono un semplice
  // taglio netto invece di un fade+scale morbido.
  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => setPlacement(computePlacement()));
      return () => cancelAnimationFrame(raf);
    }
    setQuery("");
  }, [open]);

  function computePlacement(): Placement {
    const el = panelRef.current;
    const root = rootRef.current;
    if (!el || !root) return { x: "left", y: "down" };
    const rootRect = root.getBoundingClientRect();
    const panelRect = el.getBoundingClientRect();
    const x: Placement["x"] =
      rootRect.left + panelRect.width > window.innerWidth - 8 ? "right" : "left";
    const y: Placement["y"] =
      rootRect.bottom + panelRect.height > window.innerHeight - 8 ? "up" : "down";
    return { x, y };
  }

  useLayoutEffect(() => {
    if (open && mounted) setPlacement(computePlacement());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mounted, query]);

  function handleTransitionEnd() {
    if (!open) setMounted(false);
  }

  function handleOptionClick(o: string) {
    onToggle(o);
    if (closeOnSelect) setOpen(false);
  }

  if (options.length === 0) return null;

  const filtered = searchable && query
    ? options.filter((o) => (getSearchText ? getSearchText(o) : o).toLowerCase().includes(query.toLowerCase()))
    : options;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="cursor-pointer select-none text-xs font-mono uppercase tracking-wider text-ink-muted hover:text-ink-primary flex items-center gap-1.5"
      >
        <span className={`transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
        {label}
        {selected.length > 0 && <span className="text-accent-bright">({selected.length})</span>}
      </button>

      {mounted && (
        <div
          ref={panelRef}
          onTransitionEnd={handleTransitionEnd}
          className={`absolute z-30 mt-3 w-max max-w-[85vw] rounded-card border border-base-border bg-base-surface shadow-card transition-[opacity,transform] duration-150 ease-out origin-top ${
            placement.x === "left" ? "left-0" : "right-0"
          } ${placement.y === "down" ? "top-full" : "bottom-full mt-0 mb-3"} ${
            open ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"
          }`}
        >
          {searchable && (
            <div className="p-2 border-b border-base-border">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cerca…"
                className="w-full min-w-[14rem] bg-base-surface2 border border-base-border rounded px-2.5 py-1.5 text-xs text-ink-primary placeholder:text-ink-faint outline-none focus:border-accent/60"
              />
            </div>
          )}
          <div
            className={
              layout === "list"
                ? "flex flex-col max-h-80 overflow-y-auto p-2 gap-0.5"
                : "flex flex-wrap gap-2 p-3"
            }
          >
            {filtered.length === 0 && (
              <div className="text-xs text-ink-faint px-2 py-1.5">Nessun risultato.</div>
            )}
            {filtered.map((o) => {
              const active = selected.includes(o);
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() => handleOptionClick(o)}
                  className={
                    layout === "list"
                      ? `text-left text-xs px-2.5 py-1.5 rounded transition-colors ${
                          active
                            ? "bg-accent/10 text-accent-bright"
                            : "text-ink-muted hover:bg-base-surface2 hover:text-ink-primary"
                        }`
                      : `text-xs px-3 py-1.5 rounded-full border transition-colors active:scale-95 ${
                          active
                            ? "bg-accent/10 border-accent/60 text-accent-bright"
                            : "bg-base-surface2 border-base-border text-ink-muted hover:text-ink-primary"
                        }`
                  }
                >
                  {renderOption ? renderOption(o) : o}
                </button>
              );
            })}
          </div>
          {footerNote && (
            <div className="border-t border-base-border px-3 py-2 text-[11px] text-ink-faint">
              {footerNote}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

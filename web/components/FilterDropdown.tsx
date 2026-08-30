"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

/** Pannello filtro inline: resta nel flusso e non puo' coprire le card. */
export default function FilterDropdown({
  label, options, selected, onToggle, renderOption, searchable = false,
  getSearchText, layout = "pills", footerNote, closeOnSelect = false,
  open: controlledOpen, onOpenChange,
}: {
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
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const [query, setQuery] = useState("");
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  const setOpen = useCallback((open: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(open);
    onOpenChange?.(open);
  }, [controlledOpen, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        rootRef.current?.querySelector<HTMLButtonElement>("[aria-expanded]")?.focus();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, setOpen]);

  const filtered = searchable && query
    ? options.filter((option) =>
        (getSearchText ? getSearchText(option) : option)
          .toLocaleLowerCase("it")
          .includes(query.toLocaleLowerCase("it"))
      )
    : options;

  if (options.length === 0) return null;

  return (
    <div ref={rootRef} className={`filter-inline max-w-full ${open ? "is-open" : ""}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen(!open);
          if (open) setQuery("");
        }}
        className="filter-trigger min-h-11 cursor-pointer select-none text-xs font-mono uppercase tracking-wider text-ink-muted hover:text-ink-primary flex items-center gap-2 rounded-lg px-2 -mx-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
      >
        <span aria-hidden className={`transition-transform duration-200 ${open ? "rotate-90" : ""}`}>▸</span>
        <span>{label}</span>
        {selected.length > 0 && (
          <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-accent-bright">{selected.length}</span>
        )}
      </button>

      <div
        id={panelId}
        aria-hidden={!open}
        className={`filter-panel-grid grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${
          open ? "grid-rows-[1fr] opacity-100 mt-2" : "grid-rows-[0fr] opacity-0 mt-0 pointer-events-none"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="filter-panel w-max max-w-[calc(100vw-2.5rem)] rounded-card border border-base-border bg-base-surface/95 shadow-card">
            {searchable && (
              <div className="p-2 border-b border-base-border">
                <label className="sr-only" htmlFor={`${panelId}-search`}>Cerca in {label.toLocaleLowerCase("it")}</label>
                <input
                  id={`${panelId}-search`}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Cerca…"
                  tabIndex={open ? 0 : -1}
                  className="w-full min-w-0 sm:min-w-56 bg-base-surface2 border border-base-border rounded-lg px-3 py-2.5 text-sm text-ink-primary placeholder:text-ink-faint outline-none focus:border-accent/60"
                />
              </div>
            )}
            <div className={layout === "list"
              ? "flex min-w-64 flex-col max-h-80 overflow-y-auto overscroll-contain p-2 gap-0.5"
              : "flex max-w-[34rem] flex-wrap gap-2 p-3"}
            >
              {filtered.length === 0 && <div className="text-xs text-ink-faint px-2 py-2">Nessun risultato.</div>}
              {filtered.map((option) => {
                const active = selected.includes(option);
                return (
                  <button
                    key={option}
                    type="button"
                    tabIndex={open ? 0 : -1}
                    aria-pressed={active}
                    onClick={() => {
                      onToggle(option);
                      if (closeOnSelect) {
                        setOpen(false);
                        setQuery("");
                        requestAnimationFrame(() => rootRef.current?.querySelector<HTMLButtonElement>("[aria-expanded]")?.focus());
                      }
                    }}
                    className={layout === "list"
                      ? `min-h-11 text-left text-xs px-3 py-2 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 ${active ? "bg-accent/10 text-accent-bright" : "text-ink-muted hover:bg-base-surface2 hover:text-ink-primary"}`
                      : `min-h-11 text-xs px-3 py-2 rounded-full border transition-[color,background-color,border-color,transform] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 ${active ? "bg-accent/10 border-accent/60 text-accent-bright" : "bg-base-surface2 border-base-border text-ink-muted hover:text-ink-primary"}`
                    }
                  >
                    {renderOption ? renderOption(option) : option}
                  </button>
                );
              })}
            </div>
            {footerNote && <div className="border-t border-base-border px-3 py-2 text-[11px] text-ink-faint">{footerNote}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

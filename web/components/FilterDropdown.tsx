"use client";

import { useEffect, useRef, useState } from "react";

/** Filtro a tendina "flottante": si apre sopra il contenuto (non lo spinge
 * in basso) e si chiude da solo cliccando fuori o con Esc — a differenza di
 * <details>/<summary>, che resta aperto finche' non si ri-clicca lo stesso
 * toggle e sposta il contenuto sotto quando e' aperto. */
export default function FilterDropdown({
  label,
  options,
  selected,
  onToggle,
  renderOption,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (option: string) => void;
  renderOption?: (option: string) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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

  if (options.length === 0) return null;

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

      {open && (
        <div className="absolute left-0 z-30 mt-3 w-max max-w-[85vw] flex flex-wrap gap-2 rounded-card border border-base-border bg-base-surface p-3 shadow-card">
          {options.map((o) => {
            const active = selected.includes(o);
            return (
              <button
                key={o}
                type="button"
                onClick={() => onToggle(o)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors active:scale-95 ${
                  active
                    ? "bg-accent/10 border-accent/60 text-accent-bright"
                    : "bg-base-surface2 border-base-border text-ink-muted hover:text-ink-primary"
                }`}
              >
                {renderOption ? renderOption(o) : o}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

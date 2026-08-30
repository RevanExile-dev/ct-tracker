"use client";

import { useEffect, useRef, useState } from "react";
import {
  FilterPreset,
  readFilterPreset,
  removeFilterPreset,
  writeFilterPreset,
} from "@/lib/filterPreset";

export default function FilterPresetControls({ scope, current, onApply }: {
  scope: string;
  current: FilterPreset;
  onApply: (preset: FilterPreset) => void;
}) {
  const [saved, setSaved] = useState<FilterPreset | null>(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const noticeTimer = useRef<number | null>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setSaved(readFilterPreset(scope));
      setReady(true);
    });
    return () => {
      cancelAnimationFrame(frame);
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    };
  }, [scope]);

  function flash(message: string) {
    setNotice(message);
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(""), 1800);
  }

  function save() {
    writeFilterPreset(scope, current);
    setSaved(current);
    flash(saved ? "Preset aggiornato" : "Preset salvato");
  }

  function remove() {
    removeFilterPreset(scope);
    setSaved(null);
    flash("Preset eliminato");
  }

  return (
    <div className="flex min-h-11 items-center gap-2 flex-wrap" aria-label="Preset filtri">
      {!ready && <span className="h-9 w-36 rounded-full bg-base-surface2 skeleton" aria-hidden />}
      {ready && saved ? (
        <>
          <button
            type="button"
            onClick={() => { onApply(saved); flash("Preset applicato"); }}
            className="btn-lift min-h-11 text-xs px-3 py-2 rounded-full border border-accent/50 bg-accent/10 text-accent-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
          >
            ✦ Applica il mio filtro
          </button>
          <button
            type="button"
            onClick={save}
            className="min-h-11 text-xs px-3 py-2 rounded-full border border-base-border bg-base-surface2 text-ink-muted hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
          >
            Sovrascrivi
          </button>
          <button
            type="button"
            onClick={remove}
            aria-label="Elimina il preset personale"
            title="Elimina preset"
            className="min-h-11 min-w-11 text-xs rounded-full border border-base-border text-ink-faint hover:border-signal-down/50 hover:text-signal-down focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-down/70"
          >
            ✕
          </button>
        </>
      ) : ready ? (
        <button
          type="button"
          onClick={save}
          className="btn-lift min-h-11 text-xs px-3 py-2 rounded-full border border-base-border bg-base-surface2 text-ink-muted hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
        >
          ☆ Salva filtro personale
        </button>
      ) : null}
      <span aria-live="polite" className="text-[11px] font-mono text-accent min-w-fit">{notice}</span>
    </div>
  );
}

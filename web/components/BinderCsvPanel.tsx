"use client";

import { useRef, useState } from "react";
import { fetchCards } from "@/lib/db";
import { BinderEntry, importBinderEntries } from "@/lib/binder";
import { MAX_BINDER_CARDS } from "@/lib/accountLimits";
import { buildBinderCsv, MAX_CSV_BYTES, parseBinderCsv, type BinderCsvRow, type ParsedBinderCsvRow } from "@/lib/binderCsv";

type Props = {
  rows: BinderCsvRow[];
  entries: BinderEntry[];
  onImported: (entries: BinderEntry[]) => void;
};

type Preview = { rows: ParsedBinderCsvRow[]; added: number; updated: number; unknown: number; warnings: string[] };

/** Esporta il binder in CSV (backup + Excel) e reimporta un CSV esportato da
 * qui. Tutto sui dati dell'utente, nessuna rete oltre al controllo degli id
 * contro il catalogo prima di scrivere. */
export default function BinderCsvPanel({ rows, entries, onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function exportCsv() {
    const blob = new Blob([buildBinderCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `cartaviva-binder-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage(`Esportate ${rows.length} carte.`);
  }

  async function onFile(file: File | undefined) {
    setPreview(null);
    setMessage(null);
    if (!file) return;
    if (file.size > MAX_CSV_BYTES) { setMessage("File troppo grande (massimo 1 MB)."); return; }
    setBusy(true);
    try {
      const parsed = parseBinderCsv(await file.text());
      if (parsed.rows.length === 0) { setMessage(parsed.warnings[0] ?? "Nessuna carta trovata nel file."); return; }
      const found = await fetchCards({ ids: parsed.rows.map((r) => r.id) });
      const known = new Set(found.map((c) => c.id));
      const valid = parsed.rows.filter((r) => known.has(r.id));
      const owned = new Set(entries.map((e) => e.blueprintId));
      const added = valid.filter((r) => !owned.has(r.id)).length;
      if (owned.size + added > MAX_BINDER_CARDS) {
        setMessage(`Il binder può avere al massimo ${MAX_BINDER_CARDS} carte: con questo file ne avresti ${owned.size + added}.`);
        return;
      }
      setPreview({
        rows: valid, added, updated: valid.length - added, unknown: parsed.rows.length - valid.length,
        warnings: parsed.warnings.slice(0, 5),
      });
    } catch {
      setMessage("Non riesco a leggere il file. Riprova con un CSV esportato da CartaViva.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function confirmImport() {
    if (!preview) return;
    onImported(importBinderEntries(preview.rows.map((r) => ({
      id: r.id, language: r.language, condition: r.condition, finish: r.finish, quantity: r.quantity,
    }))));
    setMessage(`Importate ${preview.rows.length} carte (${preview.added} nuove, ${preview.updated} aggiornate).`);
    setPreview(null);
  }

  const buttonClass = "min-h-11 inline-flex items-center rounded-lg border border-base-border bg-base-surface px-4 text-sm text-ink-muted transition-colors hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:opacity-50";
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3" data-testid="binder-csv">
      <button type="button" onClick={exportCsv} title="Scarica il binder come file CSV (si apre in Excel)" disabled={rows.length === 0} className={buttonClass}>Esporta binder</button>
      <label className={`${buttonClass} cursor-pointer`}>
        {busy ? "Controllo il file…" : "Importa binder"}
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      {message && <span role="status" className="text-xs text-ink-faint">{message}</span>}
      {preview && (
        <div role="alertdialog" aria-label="Conferma importazione" className="w-full rounded-card border border-base-border bg-base-surface p-4 text-sm">
          <p>
            {preview.rows.length === 1 ? "Trovata 1 carta" : `Trovate ${preview.rows.length} carte`}: <strong>{preview.added}</strong> nuove, <strong>{preview.updated}</strong> già nel binder (quantità e lingua del file sostituiscono le tue).
            {preview.unknown > 0 && <> {preview.unknown} non sono nel catalogo e vengono ignorate.</>} Nessuna carta viene tolta.
          </p>
          {preview.warnings.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs text-ink-faint">{preview.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
          <div className="mt-3 flex gap-3">
            <button type="button" onClick={confirmImport} disabled={preview.rows.length === 0} className={`${buttonClass} text-accent-bright`}>Importa</button>
            <button type="button" onClick={() => setPreview(null)} className={buttonClass}>Annulla</button>
          </div>
        </div>
      )}
    </div>
  );
}

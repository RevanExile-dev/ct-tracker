"use client";

import { useRef, useState } from "react";

type ImportOutcome =
  | { status: "imported"; rowNumber: number; name: string; matchedName: string; matchedExpansion: string | null; created: boolean }
  | { status: "unmatched"; rowNumber: number; name: string }
  | { status: "ambiguous"; rowNumber: number; name: string; candidates: string[] };

type ImportResponse = { outcomes: ImportOutcome[]; warnings: string[] };

/** Pannello "Importa da Markdown" in cima a /lotti: incolla (o carica un
 * file .md) una tabella con le carte comprate - stesso formato descritto
 * dall'utente nella richiesta di origine di questa funzionalita' (colonne
 * Carta/Set/Prezzo pagato, Data opzionale) - e la invia a POST
 * /api/account/lots/import, che fa matching contro il catalogo e crea/
 * aggiorna un lotto "acquisto" per ogni riga riconosciuta senza ambiguita'.
 * Le righe non trovate o ambigue non scrivono nulla (scelta esplicita
 * dell'utente: "auto-match + report finale", mai un tentativo indovinato) -
 * il report qui sotto le elenca cosi' si possono correggere a mano su
 * /lotti o ripetere l'import dopo aver corretto il nome/set nel Markdown. */
export default function LotImportPanel({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === "string") setText(reader.result); };
    reader.readAsText(file);
  }

  async function submitImport() {
    setError(null);
    setResult(null);
    if (!text.trim()) { setError("Incolla prima una tabella Markdown, o carica un file."); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/account/lots/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown: text }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) { setError(body?.error ?? `Richiesta fallita (${res.status}).`); return; }
      setResult(body as ImportResponse);
      onImported();
    } catch {
      setError("Errore di rete. Riprova tra poco.");
    } finally {
      setSubmitting(false);
    }
  }

  const importedCount = result?.outcomes.filter((o) => o.status === "imported").length ?? 0;
  const problemOutcomes = result?.outcomes.filter((o) => o.status !== "imported") ?? [];

  return (
    <div className="mb-8 rounded-card border border-base-border bg-base-surface/70 p-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <h2 className="font-display text-lg font-semibold">Importa da Markdown</h2>
        <span className="text-ink-faint text-sm">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="mt-4">
          <p className="text-sm text-ink-muted mb-3">
            Incolla una tabella Markdown con le carte comprate (colonne <em>Carta</em>, <em>Set</em>, <em>Prezzo pagato</em> e opzionalmente <em>Data</em>). Le carte già nel binder vengono aggiornate (prezzo e, se presente, data); le altre vengono aggiunte. Una riga senza data non tocca una data già registrata.
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder={"| # | Carta | Set | Tipo | Prezzo pagato |\n|---|-------|-----|------|---------------|\n| 1 | Primarina | Buio Pesto | IR | €3.54 |"}
            className="w-full rounded-lg border border-base-border bg-base-surface2 px-3 py-2.5 text-sm font-mono text-ink-primary placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
          />
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-sm px-4 py-2.5 rounded-card border border-base-border bg-base-surface2 text-ink-muted hover:text-ink-primary transition-colors active:scale-95"
            >
              Carica file .md
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.markdown,text/markdown,text/plain"
              className="hidden"
              onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFile(file); e.target.value = ""; }}
            />
            <button
              type="button"
              onClick={submitImport}
              disabled={submitting}
              className="btn-lift text-sm px-5 py-2.5 rounded-card border border-accent/30 bg-accent/10 text-accent-bright hover:border-accent/60 hover:bg-accent/15 transition-colors active:scale-95 disabled:opacity-50"
            >
              {submitting ? "Importo…" : "Importa"}
            </button>
          </div>

          {error && <p role="alert" className="mt-3 text-sm text-signal-down">{error}</p>}

          {result && (
            <div className="mt-4 rounded-lg border border-base-border bg-base-surface2 p-4 text-sm">
              <p className="text-ink-primary">
                {importedCount} carte importate/aggiornate{problemOutcomes.length > 0 ? `, ${problemOutcomes.length} non riconosciute` : ""}.
              </p>
              {result.warnings.length > 0 && (
                <ul className="mt-2 list-disc list-inside text-xs text-ink-faint">
                  {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}
              {problemOutcomes.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {problemOutcomes.map((o) => (
                    <li key={o.rowNumber} className="text-xs text-ink-faint">
                      Riga {o.rowNumber} (&quot;{o.name}&quot;):{" "}
                      {o.status === "unmatched"
                        ? "nessuna carta trovata nel catalogo con questo nome."
                        : `più carte corrispondono, servono nome/set più precisi (${(o as { candidates: string[] }).candidates.join("; ")}).`}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

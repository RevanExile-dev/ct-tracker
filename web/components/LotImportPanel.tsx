"use client";

import { useRef, useState } from "react";
import { fetchCards, type CardRow } from "@/lib/db";
import { formatCents } from "@/lib/format";

type ImportCandidate = { id: number; name: string; expansionName: string | null; rarity: string | null; imageUrl: string | null };

type ImportOutcome =
  | { status: "imported"; rowNumber: number; name: string; matchedName: string; matchedExpansion: string | null; created: boolean }
  | { status: "unmatched"; rowNumber: number; name: string; priceCents: number | null; acquiredAt: string | null }
  | { status: "ambiguous"; rowNumber: number; name: string; priceCents: number | null; acquiredAt: string | null; candidates: ImportCandidate[] };

type ImportResponse = { outcomes: ImportOutcome[]; warnings: string[] };

type ResolvedState = Record<number, { matchedName: string; matchedExpansion: string | null }>;

/** Riga di risoluzione manuale per UNA riga di import rimasta ambigua o
 * senza corrispondenza: per "ambiguous" mostra i candidati gia' trovati dal
 * server (con rarita'/immagine per distinguerli quando nome+set coincidono
 * - caso reale frequente: piu' stampe della stessa carta nello stesso set),
 * per "unmatched" una ricerca libera nel catalogo (stesso fetchCards usato
 * dal form di /lotti). In entrambi i casi la scelta finale va a POST
 * /api/account/lots/import/resolve con il blueprintId scelto + il
 * prezzo/data GIA' estratti dalla riga originale (mai richiesti di nuovo
 * all'utente, mai ri-parsati). */
function ResolveRow({
  outcome, onResolved,
}: {
  outcome: Extract<ImportOutcome, { status: "unmatched" | "ambiguous" }>;
  onResolved: (rowNumber: number, result: { matchedName: string; matchedExpansion: string | null }) => void;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(
    outcome.status === "ambiguous" && outcome.candidates.length > 0 ? outcome.candidates[0].id : null
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<CardRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runSearch() {
    if (!searchTerm.trim()) return;
    setSearching(true);
    try {
      const cards = await fetchCards({ search: searchTerm, limit: 8 });
      setSearchResults(cards);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }

  async function confirm(blueprintId: number) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/account/lots/import/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blueprintId, costTotalCents: outcome.priceCents, acquiredAt: outcome.acquiredAt }),
      });
      const body = await res.json().catch(() => null);
      // Su un fallimento la riga NON va segnata risolta (rilievo review,
      // verificato reale): il padre la toglierebbe subito dalla vista non
      // appena resolved[rowNumber] smette di essere undefined, portandosi
      // via il messaggio d'errore prima ancora che l'utente possa leggerlo
      // o scegliere un'altra carta - resta visibile finche' non riesce.
      if (!res.ok) { setError(body?.error ?? `Richiesta fallita (${res.status})`); return; }
      onResolved(outcome.rowNumber, { matchedName: body.matchedName, matchedExpansion: body.matchedExpansion });
    } catch {
      setError("Errore di rete.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <li className="rounded-lg border border-base-border bg-base-surface px-3 py-2.5">
      <div className="text-xs text-ink-faint mb-2">
        Riga {outcome.rowNumber} (&quot;{outcome.name}&quot;)
        {outcome.priceCents !== null && <> — {formatCents(outcome.priceCents)}</>}
        {outcome.status === "unmatched" ? ": nessuna carta trovata con questo nome." : ": più carte corrispondono, scegli quella giusta."}
      </div>

      {outcome.status === "ambiguous" && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedId ?? ""}
            onChange={(e) => setSelectedId(Number(e.target.value))}
            className="min-h-9 rounded-lg border border-base-border bg-base-surface2 px-2 text-xs text-ink-primary max-w-full"
          >
            {outcome.candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} — {c.expansionName ?? "espansione sconosciuta"}{c.rarity ? ` (${c.rarity})` : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={selectedId === null || submitting}
            onClick={() => selectedId !== null && confirm(selectedId)}
            className="text-xs px-3 py-1.5 rounded-card border border-accent/30 bg-accent/10 text-accent-bright hover:border-accent/60 transition-colors disabled:opacity-50"
          >
            {submitting ? "…" : "Conferma"}
          </button>
        </div>
      )}

      {outcome.status === "unmatched" && (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); runSearch(); } }}
              placeholder="Cerca la carta nel catalogo…"
              className="min-h-9 flex-1 min-w-[10rem] rounded-lg border border-base-border bg-base-surface2 px-2 text-xs text-ink-primary placeholder:text-ink-faint"
            />
            <button
              type="button"
              onClick={runSearch}
              disabled={searching}
              className="text-xs px-3 py-1.5 rounded-card border border-base-border bg-base-surface2 text-ink-muted hover:text-ink-primary transition-colors disabled:opacity-50"
            >
              {searching ? "…" : "Cerca"}
            </button>
          </div>
          {searchResults.length > 0 && (
            <ul className="mt-2 space-y-1">
              {searchResults.map((card) => (
                <li key={card.id}>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => confirm(card.id)}
                    className="text-xs text-left w-full px-2 py-1.5 rounded-lg hover:bg-base-surface2 transition-colors text-ink-primary disabled:opacity-50"
                  >
                    {card.name} <span className="text-ink-faint">— {card.expansion_name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p role="alert" className="mt-1.5 text-xs text-signal-down">{error}</p>}
    </li>
  );
}

/** Pannello "Importa da Markdown" in cima a /lotti: incolla (o carica un
 * file .md) una tabella con le carte comprate - stesso formato descritto
 * dall'utente nella richiesta di origine di questa funzionalita' (colonne
 * Carta/Set/Prezzo pagato, Data opzionale) - e la invia a POST
 * /api/account/lots/import, che fa matching contro il catalogo e crea/
 * aggiorna un lotto "acquisto" per ogni riga riconosciuta senza ambiguita'.
 * Le righe non trovate o ambigue non scrivono nulla in automatico (scelta
 * esplicita dell'utente: "auto-match + report finale", mai un tentativo
 * indovinato) - ma restano risolvibili a mano qui sotto (ResolveRow),
 * pensato apposta per il caso reale in cui il nome del Set nel Markdown non
 * corrisponde al nome inglese salvato nel catalogo (es. nomi italiani delle
 * espansioni: il catalogo li conosce solo in inglese, vedi
 * scripts/sync_catalog.py) - senza questo, l'unica alternativa sarebbe
 * riscrivere a mano l'intera tabella Markdown con i nomi set "giusti". */
export default function LotImportPanel({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [resolved, setResolved] = useState<ResolvedState>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === "string") setText(reader.result); };
    reader.readAsText(file);
  }

  async function submitImport() {
    setError(null);
    setResult(null);
    setResolved({});
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
  const problemOutcomes = (result?.outcomes.filter((o) => o.status !== "imported") ?? []) as Extract<ImportOutcome, { status: "unmatched" | "ambiguous" }>[];
  const unresolvedProblems = problemOutcomes.filter((o) => resolved[o.rowNumber] === undefined);
  const resolvedCount = Object.keys(resolved).length;

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
            Incolla una tabella Markdown con le carte comprate (colonne <em>Carta</em>, <em>Set</em>, <em>Prezzo pagato</em> e opzionalmente <em>Data</em>). Le carte già nel binder vengono aggiornate (prezzo e, se presente, data); le altre vengono aggiunte. Una riga senza data non tocca una data già registrata. Se il nome del Set non corrisponde a quello inglese usato dal catalogo, la riga non viene indovinata: comparirà qui sotto da risolvere a mano.
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
                {importedCount + resolvedCount} carte importate/aggiornate
                {unresolvedProblems.length > 0 ? `, ${unresolvedProblems.length} ancora da risolvere` : ""}.
              </p>
              {result.warnings.length > 0 && (
                <ul className="mt-2 list-disc list-inside text-xs text-ink-faint">
                  {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}
              {unresolvedProblems.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {unresolvedProblems.map((o) => (
                    <ResolveRow
                      key={o.rowNumber}
                      outcome={o}
                      onResolved={(rowNumber, r) => setResolved((prev) => ({ ...prev, [rowNumber]: r }))}
                    />
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

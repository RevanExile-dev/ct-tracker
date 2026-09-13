"use client";

import { useRef, useState } from "react";
import { fetchCards, type CardRow } from "@/lib/db";
import { formatCents, formatDateLong } from "@/lib/format";

type ImportCandidate = { id: number; name: string; expansionName: string | null; rarity: string | null; imageUrl: string | null };

type ImportOutcome =
  | { status: "imported"; rowNumber: number; name: string; matchedName: string; matchedExpansion: string | null; created: boolean }
  | { status: "unmatched"; rowNumber: number; name: string; priceCents: number | null; acquiredAt: string | null }
  | { status: "ambiguous"; rowNumber: number; name: string; priceCents: number | null; acquiredAt: string | null; declaredType: string | null; candidates: ImportCandidate[] }
  | {
      status: "confirm_update"; rowNumber: number; name: string; priceCents: number | null; acquiredAt: string | null;
      matchedId: number; matchedName: string; matchedExpansion: string | null;
      existingCostCents: number | null; existingAcquiredAt: string | null;
    };

type ImportResponse = { outcomes: ImportOutcome[]; warnings: string[] };

type ResolvedState = Record<number, { matchedName: string; matchedExpansion: string | null }>;

/** Chiamata condivisa da ResolveRow, ConfirmUpdateRow e dal pulsante bulk
 * "Aggiorna tutte" - un solo punto che parla con POST
 * /api/account/lots/import/resolve, cosi' i tre punti d'ingresso non
 * possono divergere nel payload inviato. */
async function postImportResolve(blueprintId: number, costTotalCents: number | null, acquiredAt: string | null) {
  const res = await fetch("/api/account/lots/import/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blueprintId, costTotalCents, acquiredAt }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Richiesta fallita (${res.status})`);
  return body as { matchedName: string; matchedExpansion: string | null };
}

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
      const result = await postImportResolve(blueprintId, outcome.priceCents, outcome.acquiredAt);
      onResolved(outcome.rowNumber, result);
    } catch (err) {
      // Su un fallimento la riga NON va segnata risolta: il padre la
      // toglierebbe subito dalla vista non appena resolved[rowNumber]
      // smette di essere undefined, portandosi via questo messaggio
      // d'errore prima ancora che l'utente possa leggerlo o riprovare.
      setError(String((err as Error)?.message ?? err));
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
        {outcome.status === "ambiguous" && outcome.declaredType && <> Tipo dichiarato: <strong className="text-ink-muted">{outcome.declaredType}</strong>.</>}
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

/** Riga per UNA carta trovata senza ambiguita' ma gia' presente nel binder:
 * l'import non l'ha scritta da solo (vedi web/lib/lotImport.server.ts,
 * "confirm_update") - qui l'utente vede cosa cambierebbe (prezzo/data
 * attuali vs quelli della riga importata) e decide se aggiornare o lasciare
 * com'e'. "Lascia com'è" non chiama nessuna API: la riga semplicemente
 * smette di comparire tra quelle da confermare, senza aver scritto nulla. */
function ConfirmUpdateRow({
  outcome, onUpdated, onSkipped, disabled,
}: {
  outcome: Extract<ImportOutcome, { status: "confirm_update" }>;
  onUpdated: (rowNumber: number, result: { matchedName: string; matchedExpansion: string | null }) => void;
  onSkipped: (rowNumber: number) => void;
  /** True mentre "Aggiorna tutte" sta girando (rilievo review, verificato
   * reale): senza questo, un click su "Lascia com'è" durante il bulk non
   * impedisce affatto la scrittura di questa riga - il bulk ha gia' letto
   * l'elenco delle righe pendenti all'avvio e la processera' comunque,
   * ignorando la scelta appena fatta dall'utente. Disabilitare ENTRAMBI i
   * pulsanti mentre il bulk gira evita che l'utente creda di aver skippato
   * una riga che invece verra' comunque aggiornata. */
  disabled?: boolean;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function update() {
    setSubmitting(true);
    setError(null);
    try {
      const result = await postImportResolve(outcome.matchedId, outcome.priceCents, outcome.acquiredAt);
      onUpdated(outcome.rowNumber, result);
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <li className="rounded-lg border border-base-border bg-base-surface px-3 py-2.5">
      <div className="text-xs text-ink-primary mb-1">
        {outcome.matchedName} <span className="text-ink-faint">— {outcome.matchedExpansion ?? "espansione sconosciuta"}</span>
      </div>
      <div className="text-xs text-ink-faint mb-2">
        Già nel binder — attuale: {outcome.existingCostCents !== null ? formatCents(outcome.existingCostCents) : "prezzo sconosciuto"}
        {outcome.existingAcquiredAt && <>, {formatDateLong(outcome.existingAcquiredAt)}</>}
        {" → "}nuovo: {outcome.priceCents !== null ? formatCents(outcome.priceCents) : "prezzo sconosciuto"}
        {outcome.acquiredAt && <>, {formatDateLong(outcome.acquiredAt)}</>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={submitting || disabled}
          onClick={update}
          className="text-xs px-3 py-1.5 rounded-card border border-accent/30 bg-accent/10 text-accent-bright hover:border-accent/60 transition-colors disabled:opacity-50"
        >
          {submitting ? "…" : "Aggiorna"}
        </button>
        <button
          type="button"
          disabled={submitting || disabled}
          onClick={() => onSkipped(outcome.rowNumber)}
          className="text-xs px-3 py-1.5 rounded-card border border-base-border bg-base-surface2 text-ink-muted hover:text-ink-primary transition-colors disabled:opacity-50"
        >
          Lascia com&apos;è
        </button>
      </div>
      {error && <p role="alert" className="mt-1.5 text-xs text-signal-down">{error}</p>}
    </li>
  );
}

/** Pannello "Importa da Markdown" in cima a /lotti: incolla (o carica un
 * file .md) una tabella con le carte comprate - stesso formato descritto
 * dall'utente nella richiesta di origine di questa funzionalita' (colonne
 * Carta/Set/Prezzo pagato, Data opzionale) - e la invia a POST
 * /api/account/lots/import, che fa matching contro il catalogo. Solo le
 * carte NUOVE (non ancora nel binder) vengono scritte subito - una carta
 * gia' presente finisce invece tra quelle da confermare (ConfirmUpdateRow):
 * l'utente ha notato che un ri-import aggiornava silenziosamente prezzo/
 * data di carte gia' importate in un giro precedente, quindi ora quella
 * scrittura richiede un click esplicito. Le righe ambigue o senza
 * corrispondenza restano risolvibili a mano (ResolveRow), pensato apposta
 * per il caso reale in cui il nome del Set nel Markdown non corrisponde al
 * nome inglese salvato nel catalogo (es. nomi italiani delle espansioni: il
 * catalogo li conosce solo in inglese, vedi scripts/sync_catalog.py). */
export default function LotImportPanel({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [resolved, setResolved] = useState<ResolvedState>({});
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [bulkUpdating, setBulkUpdating] = useState(false);
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
    setSkipped(new Set());
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
  const problemOutcomes = (result?.outcomes.filter((o) => o.status === "unmatched" || o.status === "ambiguous") ?? []) as Extract<ImportOutcome, { status: "unmatched" | "ambiguous" }>[];
  const unresolvedProblems = problemOutcomes.filter((o) => resolved[o.rowNumber] === undefined);
  const confirmOutcomes = (result?.outcomes.filter((o) => o.status === "confirm_update") ?? []) as Extract<ImportOutcome, { status: "confirm_update" }>[];
  const pendingConfirms = confirmOutcomes.filter((o) => resolved[o.rowNumber] === undefined && !skipped.has(o.rowNumber));
  const resolvedCount = Object.keys(resolved).length;

  async function updateAllPending() {
    setBulkUpdating(true);
    setError(null);
    // Promise.allSettled (non un for...await sequenziale, rilievo review):
    // ogni riga e' una richiesta indipendente, aspettarle una alla volta
    // significherebbe una latenza di rete moltiplicata per il numero di
    // carte da confermare, senza nessun vantaggio - bulkUpdating disabilita
    // gia' i pulsanti delle singole righe (vedi ConfirmUpdateRow), quindi
    // qui non c'e' rischio di doppia scrittura in parallelo sulla stessa
    // riga.
    const settled = await Promise.allSettled(
      pendingConfirms.map(async (outcome) => ({
        rowNumber: outcome.rowNumber,
        result: await postImportResolve(outcome.matchedId, outcome.priceCents, outcome.acquiredAt),
      }))
    );
    const updates: ResolvedState = {};
    let failures = 0;
    for (const settledResult of settled) {
      if (settledResult.status === "fulfilled") updates[settledResult.value.rowNumber] = settledResult.value.result;
      else failures++;
    }
    setResolved((prev) => ({ ...prev, ...updates }));
    setBulkUpdating(false);
    if (failures > 0) setError(`${failures} carte non aggiornate per un errore: riprovale singolarmente qui sotto.`);
  }

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
            Incolla una tabella Markdown con le carte comprate (colonne <em>Carta</em>, <em>Set</em>, <em>Prezzo pagato</em> e opzionalmente <em>Data</em>). Le carte non ancora nel binder vengono aggiunte subito; per quelle già presenti ti chiediamo conferma prima di aggiornare prezzo/data. Una riga senza data non tocca una data già registrata. Se il nome del Set non corrisponde a quello inglese usato dal catalogo, la riga non viene indovinata: comparirà qui sotto da risolvere a mano.
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
                {importedCount} carte nuove aggiunte
                {resolvedCount > 0 ? `, ${resolvedCount} aggiornate` : ""}
                {pendingConfirms.length > 0 ? `, ${pendingConfirms.length} già presenti da confermare` : ""}
                {unresolvedProblems.length > 0 ? `, ${unresolvedProblems.length} ancora da risolvere` : ""}.
              </p>
              {result.warnings.length > 0 && (
                <ul className="mt-2 list-disc list-inside text-xs text-ink-faint">
                  {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}

              {pendingConfirms.length > 0 && (
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-xs font-mono uppercase tracking-wider text-ink-faint">Già nel binder</div>
                    <button
                      type="button"
                      onClick={updateAllPending}
                      disabled={bulkUpdating}
                      className="text-xs px-3 py-1.5 rounded-card border border-accent/30 bg-accent/10 text-accent-bright hover:border-accent/60 transition-colors disabled:opacity-50"
                    >
                      {bulkUpdating ? "…" : "Aggiorna tutte"}
                    </button>
                  </div>
                  <ul className="space-y-2">
                    {pendingConfirms.map((o) => (
                      <ConfirmUpdateRow
                        key={o.rowNumber}
                        outcome={o}
                        disabled={bulkUpdating}
                        onUpdated={(rowNumber, r) => setResolved((prev) => ({ ...prev, [rowNumber]: r }))}
                        onSkipped={(rowNumber) => setSkipped((prev) => new Set(prev).add(rowNumber))}
                      />
                    ))}
                  </ul>
                </div>
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

"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { CardRow, fetchCards, fetchOwnedLanguagePrices } from "@/lib/db";
import { formatCents, formatDateLong, languageFlag, languageLabel } from "@/lib/format";
import type { Lot, LotProvenance } from "@/lib/types";
import { type LanguagePriceMap, resolveLotUnitPrice, summarizeLotEconomics } from "@/lib/lotSummary";
import LotImportPanel from "@/components/LotImportPanel";
import SiteHeader from "@/components/SiteHeader";

const PROVENANCE_LABELS: Record<LotProvenance, string> = {
  acquisto: "Acquisto",
  pacchetto: "Pacchetto",
  regalo: "Regalo",
  scambio: "Scambio",
  non_specificata: "Non specificata",
};

const PROVENANCE_OPTIONS = Object.entries(PROVENANCE_LABELS) as [LotProvenance, string][];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type SortColumn = "name" | "quantity" | "provenance" | "acquiredAt" | "cost" | "value" | "gain";
type SortState = { column: SortColumn; direction: "asc" | "desc" } | null;

// Testo -> crescente al primo click (A→Z ha piu' senso "in ordine"); i
// numeri -> decrescente al primo click, perche' la domanda tipica e' "quali
// carte mi fanno guadagnare di piu'/costano di piu'", non il contrario -
// richiesto esplicitamente dall'utente per la plusvalenza.
const DEFAULT_SORT_DIRECTION: Record<SortColumn, "asc" | "desc"> = {
  name: "asc", quantity: "desc", provenance: "asc", acquiredAt: "desc", cost: "desc", value: "desc", gain: "desc",
};

type EnrichedLot = {
  lot: Lot;
  card: CardRow | undefined;
  priceInfo: ReturnType<typeof resolveLotUnitPrice>;
  lotValue: number | null;
  gain: number | null;
};

// Funzione pura di modulo (non dentro LotsPage): non dipende da props/state
// del componente, solo dagli argomenti e da PROVENANCE_LABELS (costante di
// modulo) - tenerla qui evita di ricrearla ad ogni render e rende inutile
// l'eslint-disable altrimenti necessario nelle dipendenze di sortedLots.
function sortKey(row: EnrichedLot, column: SortColumn): string | number | null {
  switch (column) {
    case "name": return row.card?.name ?? `Carta #${row.lot.blueprintId}`;
    case "quantity": return row.lot.quantity;
    case "provenance": return PROVENANCE_LABELS[row.lot.provenance];
    case "acquiredAt": return row.lot.acquiredAt;
    case "cost": return row.lot.costTotalCents;
    case "value": return row.lotValue;
    case "gain": return row.gain;
  }
}

// Componente a modulo (non definito dentro LotsPage): un componente
// ridefinito ad ogni render del genitore smonterebbe e rimonterebbe questi
// <th> ogni volta, inutile qui dato che bastano props semplici.
function SortableHeader({ column, sort, onToggle, children }: {
  column: SortColumn; sort: SortState; onToggle: (column: SortColumn) => void; children: ReactNode;
}) {
  const active = sort?.column === column;
  const ariaSort = active ? (sort.direction === "asc" ? "ascending" : "descending") : "none";
  return (
    <th className="p-0" aria-sort={ariaSort}>
      <button
        type="button"
        onClick={() => onToggle(column)}
        className={`w-full px-4 py-3 flex items-center gap-1 text-left hover:text-ink-primary transition-colors ${active ? "text-ink-primary" : ""}`}
      >
        {children}
        <span className="text-[9px]" aria-hidden="true">{active ? (sort.direction === "asc" ? "▲" : "▼") : "⇅"}</span>
      </button>
    </th>
  );
}

export default function LotsPage() {
  const { data: session, status } = useSession();
  const [lots, setLots] = useState<Lot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cardsById, setCardsById] = useState<Map<number, CardRow>>(new Map());
  const [languagePrices, setLanguagePrices] = useState<LanguagePriceMap>({});

  // --- Ricerca carta per il form "nuovo lotto" ---
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  const [searchResults, setSearchResults] = useState<CardRow[]>([]);
  const [selectedCard, setSelectedCard] = useState<CardRow | null>(null);

  useEffect(() => {
    // Niente da cercare (campo vuoto o carta gia' selezionata): nessun
    // fetch, "visibleSearchResults" sotto nasconde comunque i risultati
    // stantii senza bisogno di un setState sincrono qui nel corpo
    // dell'effetto (regola di lint del progetto, react-hooks/set-state-in-effect).
    if (!debouncedSearch || selectedCard) return;
    let cancelled = false;
    fetchCards({ search: debouncedSearch, limit: 8 })
      .then((cards) => { if (!cancelled) setSearchResults(cards); })
      .catch(() => { if (!cancelled) setSearchResults([]); });
    return () => { cancelled = true; };
  }, [debouncedSearch, selectedCard]);
  const visibleSearchResults = !debouncedSearch || selectedCard ? [] : searchResults;

  // --- Resto del form ---
  const [quantity, setQuantity] = useState(1);
  const [language, setLanguage] = useState("");
  const [provenance, setProvenance] = useState<LotProvenance>("acquisto");
  const [acquiredAt, setAcquiredAt] = useState(() => todayIso());
  const [costInput, setCostInput] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function resetForm() {
    setSearch(""); setSelectedCard(null); setQuantity(1); setLanguage("");
    setProvenance("acquisto"); setAcquiredAt(todayIso()); setCostInput(""); setNote("");
  }

  // reloadTick permette all'importer Markdown sotto (LotImportPanel) di far
  // ricaricare l'elenco dopo aver creato/aggiornato lotti in blocco, senza
  // che questo effetto debba conoscere i dettagli di quella richiesta.
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    fetch("/api/account/lots")
      .then(async (res) => {
        if (!res.ok) throw new Error(`Lotti non disponibili (${res.status}).`);
        return res.json();
      })
      .then((data: Lot[]) => { if (!cancelled) setLots(data); })
      .catch(() => { if (!cancelled) setError("Non riesco a caricare i lotti. Riprova tra poco."); });
    return () => { cancelled = true; };
  }, [session, reloadTick]);

  useEffect(() => {
    // ids sempre passato esplicitamente (anche [] quando lots e' vuoto/non
    // ancora caricato): idsProvided scatta comunque (vedi cardsFilterParams
    // in web/lib/db.ts), quindi fetchCards torna [] invece dell'intero
    // catalogo - nessun bisogno di un ramo sincrono separato per il caso
    // vuoto (che avrebbe richiesto un setState nel corpo dell'effetto).
    let cancelled = false;
    const ids = [...new Set((lots ?? []).map((l) => l.blueprintId))];
    fetchCards({ ids })
      .then((cards) => { if (!cancelled) setCardsById(new Map(cards.map((c) => [c.id, c]))); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [lots]);

  useEffect(() => {
    // fetchOwnedLanguagePrices torna {} subito (nessuna rete) su un array
    // vuoto - vedi web/lib/db.ts - stesso motivo per cui qui non serve un
    // ramo sincrono separato per "lots" nullo/senza carte con lingua nota.
    let cancelled = false;
    const entries = (lots ?? [])
      .filter((l): l is Lot & { language: string } => !!l.language)
      .map((l) => ({ id: l.blueprintId, language: l.language }));
    fetchOwnedLanguagePrices(entries)
      .then((result) => { if (!cancelled) setLanguagePrices(result); })
      .catch(() => { if (!cancelled) setLanguagePrices({}); });
    return () => { cancelled = true; };
  }, [lots]);

  async function submitLot(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    if (!selectedCard) { setFormError("Seleziona prima una carta dalla ricerca."); return; }
    let costTotalCents: number | null = null;
    if (costInput.trim()) {
      const parsed = Number(costInput.replace(",", "."));
      if (!Number.isFinite(parsed) || parsed < 0) { setFormError("Costo non valido."); return; }
      costTotalCents = Math.round(parsed * 100);
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/account/lots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blueprintId: selectedCard.id,
          quantity,
          language: language || null,
          provenance,
          acquiredAt,
          costTotalCents,
          costCurrency: costTotalCents !== null ? "EUR" : null,
          note: note || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Richiesta fallita (${res.status})`);
      }
      const created: Lot = await res.json();
      setLots((current) => [created, ...(current ?? [])]);
      resetForm();
    } catch (err) {
      setFormError(String((err as Error)?.message ?? err));
    } finally {
      setSubmitting(false);
    }
  }

  async function removeLot(id: string) {
    const previous = lots;
    setLots((current) => current?.filter((l) => l.id !== id) ?? current);
    try {
      const res = await fetch(`/api/account/lots/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setLots(previous ?? null);
      setError("Non sono riuscito a eliminare il lotto. Riprova.");
    }
  }

  const summary = useMemo(
    () => summarizeLotEconomics(lots ?? [], cardsById, languagePrices),
    [lots, cardsById, languagePrices]
  );

  // Costo/valore/plusvalenza calcolati UNA VOLTA per lotto qui (non piu'
  // inline nel render, vedi tabella sotto): servono sia per disegnare le
  // righe sia come chiave di ordinamento, e vanno tenuti identici nei due
  // punti - un solo calcolo evita che i due possano divergere.
  const enrichedLots = useMemo(() => {
    return (lots ?? []).map((lot) => {
      const card = cardsById.get(lot.blueprintId);
      const priceInfo = resolveLotUnitPrice(lot, card, languagePrices);
      const lotValue = priceInfo ? priceInfo.cents * lot.quantity : null;
      const costCurrency = lot.costCurrency ?? "EUR";
      const gain = lot.costTotalCents !== null && lotValue !== null && costCurrency === (priceInfo?.currency ?? "EUR")
        ? lotValue - lot.costTotalCents
        : null;
      return { lot, card, priceInfo, lotValue, gain };
    });
  }, [lots, cardsById, languagePrices]);

  const [sort, setSort] = useState<SortState>(null);

  function toggleSort(column: SortColumn) {
    setSort((current) =>
      current?.column === column
        ? { column, direction: current.direction === "asc" ? "desc" : "asc" }
        : { column, direction: DEFAULT_SORT_DIRECTION[column] }
    );
  }

  // Chiave comparabile per colonna - null/undefined SEMPRE in fondo
  // indipendentemente dalla direzione (un costo/valore/plusvalenza
  // sconosciuti non sono "il piu' piccolo", sono semplicemente un dato
  // mancante: metterli in cima ordinando decrescente sarebbe fuorviante).
  const sortedLots = useMemo(() => {
    if (!sort) return enrichedLots;
    const { column, direction } = sort;
    const withKey = enrichedLots.map((row) => ({ row, key: sortKey(row, column) }));
    withKey.sort((a, b) => {
      if (a.key === null && b.key === null) return 0;
      if (a.key === null) return 1;
      if (b.key === null) return -1;
      const cmp = typeof a.key === "string" && typeof b.key === "string" ? a.key.localeCompare(b.key) : a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
      return direction === "asc" ? cmp : -cmp;
    });
    return withKey.map((w) => w.row);
  }, [enrichedLots, sort]);

  if (status === "loading") {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 sm:px-8 py-8 sm:py-10">
        <SiteHeader compact />
        <div className="py-20 text-center text-sm font-mono text-ink-muted animate-pulse">Carico…</div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 sm:px-8 py-8 sm:py-10">
        <SiteHeader compact />
        <div className="rounded-card border border-base-border bg-base-surface/60 py-20 px-5 text-center text-ink-muted">
          <p className="mb-4">I lotti sono legati al tuo account: accedi per tracciare costo e provenienza dei tuoi acquisti.</p>
          <Link href="/login" className="btn-lift inline-flex text-sm px-4 py-2.5 rounded-card border border-accent/30 bg-accent/10 text-accent-bright hover:border-accent/60">Accedi</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 sm:px-8 py-8 sm:py-10">
      <SiteHeader compact />
      <Link href="/binder?view=collection" className="text-sm text-ink-muted hover:text-accent-bright transition-colors inline-flex items-center gap-1.5 mb-4">← Binder</Link>
      <h1 className="font-display text-3xl sm:text-4xl font-bold text-ink-primary mb-1">I miei lotti</h1>
      <p className="text-ink-muted mb-6">
        Traccia costo e provenienza dei tuoi acquisti, separati per lotto. Ogni indicatore di plusvalenza qui sotto è una stima <strong>non realizzata</strong> (valore di mercato attuale meno costo dichiarato): diventa un guadagno vero solo se registri una vendita, funzionalità non ancora disponibile.
      </p>

      {lots && lots.length > 0 && (
        <div className="mb-7 flex flex-wrap items-start gap-x-8 gap-y-3 rounded-card border border-base-border bg-base-surface/70 px-5 py-4">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-wider text-ink-faint">Lotti</div>
            <div className="font-display text-xl font-bold">{summary.totalLots}</div>
          </div>
          <div>
            <div className="text-[11px] font-mono uppercase tracking-wider text-ink-faint">Costo registrato</div>
            <div className="font-display text-xl font-bold">{formatCents(summary.costCents)}</div>
            {summary.costUnknownCount > 0 && <div className="text-xs text-ink-faint">{summary.costUnknownCount} lotti senza costo</div>}
          </div>
          <div>
            <div className="text-[11px] font-mono uppercase tracking-wider text-ink-faint">Valore di mercato attuale</div>
            <div className="font-display text-xl font-bold text-accent-bright">{formatCents(summary.valueCents)}</div>
            {summary.valueUnknownCount > 0 && <div className="text-xs text-ink-faint">{summary.valueUnknownCount} lotti senza prezzo di mercato</div>}
          </div>
          <div>
            <div className="text-[11px] font-mono uppercase tracking-wider text-ink-faint">Plusvalenza non realizzata</div>
            <div className={`font-display text-xl font-bold ${summary.gainCents >= 0 ? "text-signal-up" : "text-signal-down"}`}>
              {summary.gainCount > 0 ? formatCents(summary.gainCents) : "—"}
            </div>
            {summary.gainCount < summary.totalLots && (
              <div className="text-xs text-ink-faint">calcolata su {summary.gainCount}/{summary.totalLots} lotti (serve costo e prezzo di mercato noti)</div>
            )}
          </div>
        </div>
      )}

      <LotImportPanel onImported={() => setReloadTick((t) => t + 1)} />

      <form onSubmit={submitLot} className="mb-8 rounded-card border border-base-border bg-base-surface/70 p-5">
        <h2 className="font-display text-lg font-semibold mb-4">Nuovo lotto</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2 relative">
            <label className="block text-xs font-mono uppercase tracking-wider text-ink-faint mb-1.5" htmlFor="lot-search">Carta</label>
            {selectedCard ? (
              <div className="flex items-center justify-between rounded-lg border border-base-border bg-base-surface2 px-3 py-2.5">
                <span className="text-sm text-ink-primary">{selectedCard.name} <span className="text-ink-faint">— {selectedCard.expansion_name}</span></span>
                <button type="button" onClick={() => { setSelectedCard(null); setSearch(""); }} className="text-xs text-ink-muted hover:text-signal-down min-h-8 px-2">Cambia</button>
              </div>
            ) : (
              <>
                <input
                  id="lot-search"
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cerca una carta per nome…"
                  className="w-full min-h-11 rounded-lg border border-base-border bg-base-surface2 px-3 text-sm text-ink-primary placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                />
                {visibleSearchResults.length > 0 && (
                  <ul className="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-base-border bg-base-surface shadow-card">
                    {visibleSearchResults.map((card) => (
                      <li key={card.id}>
                        <button
                          type="button"
                          onClick={() => { setSelectedCard(card); setSearchResults([]); }}
                          className="w-full text-left px-3 py-2.5 text-sm hover:bg-base-surface2 transition-colors"
                        >
                          {card.name} <span className="text-ink-faint">— {card.expansion_name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-ink-faint mb-1.5" htmlFor="lot-quantity">Quantità</label>
            <input id="lot-quantity" type="number" min={1} max={999} value={quantity}
              onChange={(e) => setQuantity(Math.min(999, Math.max(1, Number(e.target.value) || 1)))}
              className="w-full min-h-11 rounded-lg border border-base-border bg-base-surface2 px-3 text-sm text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70" />
          </div>

          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-ink-faint mb-1.5" htmlFor="lot-language">Lingua (opzionale)</label>
            <input id="lot-language" type="text" value={language} onChange={(e) => setLanguage(e.target.value.toLowerCase())}
              placeholder="es. it, en, jp" maxLength={8}
              className="w-full min-h-11 rounded-lg border border-base-border bg-base-surface2 px-3 text-sm text-ink-primary placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70" />
          </div>

          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-ink-faint mb-1.5" htmlFor="lot-provenance">Provenienza</label>
            <select id="lot-provenance" value={provenance} onChange={(e) => setProvenance(e.target.value as LotProvenance)}
              className="w-full min-h-11 rounded-lg border border-base-border bg-base-surface2 px-3 text-sm text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70">
              {PROVENANCE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-ink-faint mb-1.5" htmlFor="lot-date">Data acquisizione</label>
            <input id="lot-date" type="date" value={acquiredAt} max={todayIso()} onChange={(e) => setAcquiredAt(e.target.value)}
              className="w-full min-h-11 rounded-lg border border-base-border bg-base-surface2 px-3 text-sm text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70" />
          </div>

          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-ink-faint mb-1.5" htmlFor="lot-cost">Costo totale del lotto € (opzionale)</label>
            <input id="lot-cost" type="text" inputMode="decimal" value={costInput} onChange={(e) => setCostInput(e.target.value)}
              placeholder="es. 12.50 — lascia vuoto se non lo conosci"
              className="w-full min-h-11 rounded-lg border border-base-border bg-base-surface2 px-3 text-sm text-ink-primary placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70" />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-mono uppercase tracking-wider text-ink-faint mb-1.5" htmlFor="lot-note">Nota (opzionale)</label>
            <input id="lot-note" type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500}
              className="w-full min-h-11 rounded-lg border border-base-border bg-base-surface2 px-3 text-sm text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70" />
          </div>
        </div>

        {formError && <p role="alert" className="mt-3 text-sm text-signal-down">{formError}</p>}

        <button type="submit" disabled={submitting}
          className="btn-lift mt-4 min-h-11 text-sm px-5 py-2.5 rounded-card border border-accent/30 bg-accent/10 text-accent-bright hover:border-accent/60 hover:bg-accent/15 transition-colors active:scale-95 disabled:opacity-50">
          {submitting ? "Salvo…" : "Aggiungi lotto"}
        </button>
      </form>

      {error && <div className="rounded-card border border-signal-down/30 bg-signal-down/5 p-5 text-signal-down mb-6">{error}</div>}
      {lots === null && !error && <div className="py-20 text-center text-sm font-mono text-ink-muted animate-pulse">Carico i lotti…</div>}
      {lots && lots.length === 0 && (
        <div className="rounded-card border border-base-border bg-base-surface/60 py-16 px-5 text-center text-ink-muted">Non hai ancora registrato nessun lotto.</div>
      )}

      {lots && lots.length > 0 && (
        <div className="overflow-x-auto rounded-card border border-base-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-base-border bg-base-surface2 text-left text-[11px] font-mono uppercase tracking-wider text-ink-faint">
                <SortableHeader column="name" sort={sort} onToggle={toggleSort}>Carta</SortableHeader>
                <SortableHeader column="quantity" sort={sort} onToggle={toggleSort}>Qtà</SortableHeader>
                <SortableHeader column="provenance" sort={sort} onToggle={toggleSort}>Provenienza</SortableHeader>
                <SortableHeader column="acquiredAt" sort={sort} onToggle={toggleSort}>Data</SortableHeader>
                <SortableHeader column="cost" sort={sort} onToggle={toggleSort}>Costo</SortableHeader>
                <SortableHeader column="value" sort={sort} onToggle={toggleSort}>Valore attuale</SortableHeader>
                <SortableHeader column="gain" sort={sort} onToggle={toggleSort}>Plusvalenza</SortableHeader>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {sortedLots.map(({ lot, card, priceInfo, lotValue, gain }) => {
                const costCurrency = lot.costCurrency ?? "EUR";
                return (
                  <tr key={lot.id} className="border-b border-base-border last:border-0">
                    <td className="px-4 py-3">
                      {card ? (
                        <Link href={`/card/${card.id}`} className="hover:text-accent-bright transition-colors">{card.name}</Link>
                      ) : (
                        <span className="text-ink-faint">Carta #{lot.blueprintId}</span>
                      )}
                      {lot.language && <span className="ml-1.5 text-xs text-ink-faint">{languageFlag(lot.language)} {languageLabel(lot.language)}</span>}
                      {lot.note && <div className="text-xs text-ink-faint mt-0.5">{lot.note}</div>}
                    </td>
                    <td className="px-4 py-3">{lot.quantity}</td>
                    <td className="px-4 py-3">{PROVENANCE_LABELS[lot.provenance]}</td>
                    <td className="px-4 py-3 text-ink-faint">{formatDateLong(lot.acquiredAt)}</td>
                    <td className="px-4 py-3">{lot.costTotalCents !== null ? formatCents(lot.costTotalCents, costCurrency) : <span className="text-ink-faint">sconosciuto</span>}</td>
                    <td className="px-4 py-3">{lotValue !== null ? formatCents(lotValue, priceInfo?.currency ?? "EUR") : <span className="text-ink-faint">n/d</span>}</td>
                    <td className={`px-4 py-3 ${gain !== null ? (gain >= 0 ? "text-signal-up" : "text-signal-down") : "text-ink-faint"}`}>
                      {gain !== null ? formatCents(gain, priceInfo?.currency ?? "EUR") : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => removeLot(lot.id)} className="text-xs text-ink-muted hover:text-signal-down min-h-8 px-2">Elimina</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CardRow, ExpansionInfo, SortOption,
  fetchCards, fetchExpansions, fetchLanguages, fetchMeta, fetchRarities,
} from "@/lib/db";
import { getBinderIds, toggleBinder } from "@/lib/binder";
import { formatCents, priceDeltaPct } from "@/lib/format";
import CardTile from "@/components/CardTile";
import Toolbar from "@/components/Toolbar";
import SiteHeader from "@/components/SiteHeader";

const PAGE_SIZE = 60;

export default function Home() {
  const [cards, setCards] = useState<CardRow[] | null>(null);
  const [expansions, setExpansions] = useState<ExpansionInfo[]>([]);
  const [rarities, setRarities] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [lastSync, setLastSync] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [expansionCode, setExpansionCode] = useState("");
  const [selectedRarities, setSelectedRarities] = useState<string[]>([]);
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortOption>("expansion");
  const [onlyBinder, setOnlyBinder] = useState(false);
  const [binderIds, setBinderIds] = useState<Set<number>>(new Set());
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    setBinderIds(getBinderIds());
    fetchExpansions().then(setExpansions).catch(() => {});
    fetchRarities().then(setRarities).catch(() => {});
    fetchLanguages().then(setLanguages).catch(() => {});
    fetchMeta()
      .then((m) => setLastSync(m["last_price_sync"]))
      .catch(() => {});
  }, []);

  // Ricarica le carte quando cambiano i filtri lato-query (ricerca, espansione,
  // rarità, lingua, ordinamento): sono gestiti in SQL, non serve rifiltrare in JS.
  useEffect(() => {
    setError(null);
    fetchCards({ search, expansionCode, rarities: selectedRarities, languages: selectedLanguages, sortBy })
      .then(setCards)
      .catch((e) => setError(String(e.message ?? e)));
  }, [search, expansionCode, selectedRarities, selectedLanguages, sortBy]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [search, expansionCode, selectedRarities, selectedLanguages, sortBy, onlyBinder]);

  const filtered = useMemo(() => {
    if (!cards) return null;
    if (!onlyBinder) return cards;
    return cards.filter((c) => binderIds.has(c.id));
  }, [cards, onlyBinder, binderIds]);

  const visible = filtered ? filtered.slice(0, visibleCount) : null;

  const binderSummary = useMemo(() => {
    if (!onlyBinder || !filtered) return null;
    const priced = filtered.filter((c) => c.latest_price_cents !== null);
    const totalCents = priced.reduce((sum, c) => sum + (c.latest_price_cents as number), 0);
    const currency = priced[0]?.latest_price_currency ?? "EUR";
    const drops = filtered.filter((c) => {
      const d = priceDeltaPct(c.latest_price_cents, c.prev_price_cents);
      return d !== null && d < 0;
    }).length;
    return { count: filtered.length, priced: priced.length, totalCents, currency, drops };
  }, [onlyBinder, filtered]);

  function handleToggleRarity(r: string) {
    setSelectedRarities((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]
    );
  }

  function handleToggleLanguage(l: string) {
    setSelectedLanguages((prev) =>
      prev.includes(l) ? prev.filter((x) => x !== l) : [...prev, l]
    );
  }

  function handleToggleBinderCard(id: number) {
    setBinderIds(new Set(toggleBinder(id)));
  }

  return (
    <main className="max-w-7xl mx-auto px-5 sm:px-8 py-12">
      <SiteHeader lastSync={lastSync} />

      <div className="sticky top-0 z-20 -mx-5 sm:-mx-8 px-5 sm:px-8 py-3 bg-base-bg/85 backdrop-blur-sm">
        <Toolbar
          search={search}
          onSearch={setSearch}
          expansions={expansions}
          expansionCode={expansionCode}
          onExpansionChange={setExpansionCode}
          rarities={rarities}
          selectedRarities={selectedRarities}
          onToggleRarity={handleToggleRarity}
          languages={languages}
          selectedLanguages={selectedLanguages}
          onToggleLanguage={handleToggleLanguage}
          sortBy={sortBy}
          onSortChange={setSortBy}
          onlyBinder={onlyBinder}
          onToggleBinder={() => setOnlyBinder((v) => !v)}
        />
      </div>

      {binderSummary && (
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-card border border-base-border bg-base-surface px-5 py-4">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-wider text-ink-faint">
              Carte nel binder
            </div>
            <div className="font-display text-xl font-bold text-ink-primary">
              {binderSummary.count}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-mono uppercase tracking-wider text-ink-faint">
              Valore stimato
            </div>
            <div className="font-display text-xl font-bold text-accent-bright">
              {formatCents(binderSummary.totalCents, binderSummary.currency)}
              {binderSummary.priced < binderSummary.count && (
                <span className="text-xs font-mono text-ink-faint ml-1.5">
                  ({binderSummary.priced}/{binderSummary.count} con prezzo)
                </span>
              )}
            </div>
          </div>
          {binderSummary.drops > 0 && (
            <div>
              <div className="text-[11px] font-mono uppercase tracking-wider text-ink-faint">
                In calo
              </div>
              <div className="font-display text-xl font-bold text-signal-down">
                ▼ {binderSummary.drops}
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mt-8 rounded-card border border-signal-down/30 bg-signal-down/5 text-signal-down p-5 font-mono text-sm">
          {error}
          <div className="text-ink-muted mt-2 font-body">
            Verifica che il workflow &quot;Sync prezzi&quot; sia già stato eseguito almeno una
            volta e che il file sia stato copiato in{" "}
            <code className="text-ink-primary">web/public/data/cardtrader.db</code>.
          </div>
        </div>
      )}

      {!cards && !error && (
        <div className="mt-8">
          <div className="text-center text-ink-muted font-mono text-sm mb-6">
            Carico il database locale…
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 sm:gap-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className="skeleton rounded-card border border-base-border bg-base-surface overflow-hidden"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <div className="aspect-[5/7] bg-base-surface2" />
                <div className="p-3 space-y-2">
                  <div className="h-2.5 w-2/3 rounded bg-base-surface2" />
                  <div className="h-3.5 w-4/5 rounded bg-base-surface2" />
                  <div className="h-4 w-1/2 rounded bg-base-surface2 mt-3" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {filtered && filtered.length === 0 && (
        <div className="mt-16 text-center text-ink-muted">
          {onlyBinder
            ? "Il tuo binder è vuoto. Apri una carta e tocca \"Aggiungi al binder\"."
            : "Nessuna carta trovata. Prova a modificare la ricerca o i filtri."}
        </div>
      )}

      {visible && visible.length > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 sm:gap-5 mt-8">
            {visible.map((card, i) => (
              <CardTile
                key={card.id}
                card={card}
                index={i}
                inBinder={binderIds.has(card.id)}
                onToggleBinder={() => handleToggleBinderCard(card.id)}
              />
            ))}
          </div>

          {filtered && visibleCount < filtered.length && (
            <div className="flex justify-center mt-8">
              <button
                onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}
                className="text-sm px-6 py-2.5 rounded-card border border-base-border bg-base-surface text-ink-muted hover:text-ink-primary hover:border-accent/60 transition-colors active:scale-95"
              >
                Mostra altre {Math.min(PAGE_SIZE, filtered.length - visibleCount)} carte
                <span className="text-ink-faint"> ({visibleCount}/{filtered.length})</span>
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}

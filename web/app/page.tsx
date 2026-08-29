"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CardRow, ExpansionInfo, SortOption,
  fetchCards, fetchExpansions, fetchLanguages, fetchMeta, fetchRarities,
} from "@/lib/db";
import { getBinderIds, toggleBinder } from "@/lib/binder";
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
        <div className="mt-16 text-center text-ink-muted font-mono text-sm animate-pulse">
          Carico il database locale…
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
            {visible.map((card) => (
              <CardTile
                key={card.id}
                card={card}
                inBinder={binderIds.has(card.id)}
                onToggleBinder={() => handleToggleBinderCard(card.id)}
              />
            ))}
          </div>

          {filtered && visibleCount < filtered.length && (
            <div className="flex justify-center mt-8">
              <button
                onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}
                className="text-sm px-6 py-2.5 rounded-card border border-base-border bg-base-surface text-ink-muted hover:text-ink-primary hover:border-accent/60 transition-colors"
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

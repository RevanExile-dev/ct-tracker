"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  CardRow, ExpansionInfo, SortOption,
  fetchCards, fetchCatalogStats, fetchExpansions, fetchLanguages, fetchMeta, fetchRarities,
} from "@/lib/db";
import { getBinderIds, toggleBinder } from "@/lib/binder";
import { formatCents, priceDeltaPct } from "@/lib/format";
import CardTile from "@/components/CardTile";
import BinderTable from "@/components/BinderTable";
import Toolbar from "@/components/Toolbar";
import SiteHeader from "@/components/SiteHeader";
import CountUp from "@/components/CountUp";

const PAGE_SIZE = 60;

function splitCsv(v: string | null): string[] {
  return v ? v.split(",").filter(Boolean) : [];
}

function HomeContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [cards, setCards] = useState<CardRow[] | null>(null);
  const [expansions, setExpansions] = useState<ExpansionInfo[]>([]);
  const [rarities, setRarities] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [lastSync, setLastSync] = useState<string | undefined>();
  const [totalCards, setTotalCards] = useState<number | undefined>();
  const [error, setError] = useState<string | null>(null);

  // Lo stato dei filtri e' inizializzato dalla query string cosi' che
  // "indietro" dal browser dopo aver aperto una carta torni alla stessa
  // vista filtrata, invece di una home resettata.
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [expansionCode, setExpansionCode] = useState(() => searchParams.get("exp") ?? "");
  const [selectedRarities, setSelectedRarities] = useState<string[]>(() =>
    splitCsv(searchParams.get("rarity"))
  );
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(() =>
    splitCsv(searchParams.get("lang"))
  );
  const [sortBy, setSortBy] = useState<SortOption>(
    () => (searchParams.get("sort") as SortOption) || "expansion"
  );
  const [onlyBinder, setOnlyBinder] = useState(() => searchParams.get("binder") === "1");
  const [viewMode, setViewMode] = useState<"grid" | "table">(
    () => (searchParams.get("view") === "table" ? "table" : "grid")
  );
  const [binderIds, setBinderIds] = useState<Set<number>>(new Set());
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Specchia i filtri nella URL (senza aggiungere una entry nella cronologia
  // ad ogni singola modifica: solo la navigazione verso una carta la crea).
  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (expansionCode) params.set("exp", expansionCode);
    if (selectedRarities.length) params.set("rarity", selectedRarities.join(","));
    if (selectedLanguages.length) params.set("lang", selectedLanguages.join(","));
    if (sortBy !== "expansion") params.set("sort", sortBy);
    if (onlyBinder) params.set("binder", "1");
    if (viewMode === "table") params.set("view", "table");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [search, expansionCode, selectedRarities, selectedLanguages, sortBy, onlyBinder, viewMode, pathname, router]);

  useEffect(() => {
    setBinderIds(getBinderIds());
    fetchExpansions().then(setExpansions).catch(() => {});
    fetchRarities().then(setRarities).catch(() => {});
    fetchLanguages().then(setLanguages).catch(() => {});
    fetchMeta()
      .then((m) => setLastSync(m["last_price_sync"]))
      .catch(() => {});
    fetchCatalogStats()
      .then((s) => setTotalCards(s.totalCards))
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

  // Indice di mercato dell'espansione selezionata: media delle variazioni
  // giorno-su-giorno delle carte gia' caricate (nessuna richiesta aggiuntiva,
  // usa solo prev_price_cents gia' presente in cardtrader.db).
  const expansionSummary = useMemo(() => {
    if (!expansionCode || !cards) return null;
    const deltas = cards
      .map((c) => priceDeltaPct(c.latest_price_cents, c.prev_price_cents))
      .filter((d): d is number => d !== null);
    if (deltas.length === 0) return null;
    const avgPct = deltas.reduce((sum, d) => sum + d, 0) / deltas.length;
    const expansionName = cards[0]?.expansion_name ?? "";
    return { avgPct, sampleSize: deltas.length, totalCards: cards.length, expansionName };
  }, [expansionCode, cards]);

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
      <SiteHeader lastSync={lastSync} totalCards={totalCards} />

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

      {expansionSummary && (
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-card border border-base-border bg-base-surface px-5 py-4">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-wider text-ink-faint">
              Andamento {expansionSummary.expansionName} (giorno su giorno)
            </div>
            <div
              className={`font-display text-xl font-bold ${
                expansionSummary.avgPct >= 0 ? "text-signal-up" : "text-signal-down"
              }`}
            >
              {expansionSummary.avgPct >= 0 ? "▲" : "▼"}{" "}
              <CountUp
                value={Math.abs(expansionSummary.avgPct)}
                format={(n) => `${n.toFixed(1)}%`}
              />
              <span className="text-xs font-mono text-ink-faint ml-1.5">
                (media su {expansionSummary.sampleSize}/{expansionSummary.totalCards} carte)
              </span>
            </div>
          </div>
        </div>
      )}

      {binderSummary && (
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-card border border-base-border bg-base-surface px-5 py-4">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-wider text-ink-faint">
              Carte nel binder
            </div>
            <div className="font-display text-xl font-bold text-ink-primary">
              <CountUp value={binderSummary.count} />
            </div>
          </div>
          <div>
            <div className="text-[11px] font-mono uppercase tracking-wider text-ink-faint">
              Valore stimato
            </div>
            <div className="font-display text-xl font-bold text-accent-bright">
              <CountUp
                value={binderSummary.totalCents}
                format={(n) => formatCents(Math.round(n), binderSummary.currency)}
              />
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

          <div className="ml-auto flex gap-1.5">
            <button
              onClick={() => setViewMode("grid")}
              className={`btn-lift text-xs px-3 py-1.5 rounded-card border transition-colors active:scale-95 ${
                viewMode === "grid"
                  ? "bg-accent/10 border-accent/60 text-accent-bright"
                  : "bg-base-surface2 border-base-border text-ink-muted hover:text-ink-primary"
              }`}
            >
              Griglia
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={`btn-lift text-xs px-3 py-1.5 rounded-card border transition-colors active:scale-95 ${
                viewMode === "table"
                  ? "bg-accent/10 border-accent/60 text-accent-bright"
                  : "bg-base-surface2 border-base-border text-ink-muted hover:text-ink-primary"
              }`}
            >
              Tabella (confronto)
            </button>
          </div>
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
          {onlyBinder && viewMode === "table" ? (
            <BinderTable cards={filtered ?? []} />
          ) : (
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
          )}

          {!(onlyBinder && viewMode === "table") && filtered && visibleCount < filtered.length && (
            <div className="flex justify-center mt-8">
              <button
                onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}
                className="btn-lift text-sm px-6 py-2.5 rounded-card border border-base-border bg-base-surface text-ink-muted hover:text-ink-primary hover:border-accent/60 transition-colors active:scale-95"
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

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeContent />
    </Suspense>
  );
}

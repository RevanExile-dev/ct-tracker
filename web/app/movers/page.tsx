"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  MOVERS_PAGE_SIZE,
  MoversPageResult,
  MoversSort,
  fetchMoversPage,
  fetchRarities,
  normalizeRarity,
} from "@/lib/db";
import { MOVERS_TIERS, findMoversTier } from "@/lib/moversTiers";
import { getBinderIds, toggleBinder } from "@/lib/binder";
import CardTile from "@/components/CardTile";
import SiteHeader from "@/components/SiteHeader";
import FilterDropdown from "@/components/FilterDropdown";
import { useScrollRestoration } from "@/lib/useScrollRestoration";

function MoversSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 sm:gap-5">
      {Array.from({ length: 6 }).map((_, i) => (
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
  );
}

/** Precedente/Successiva indipendenti per rialzi e cali (pagine diverse,
 * ognuna con il proprio conteggio totale). */
function Pagination({
  page,
  totalCount,
  onChange,
}: {
  page: number;
  totalCount: number;
  onChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / MOVERS_PAGE_SIZE));
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-3 mt-6">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        className="min-h-9 px-3 text-xs rounded-full border border-base-border bg-base-surface2 text-ink-muted disabled:opacity-40 disabled:cursor-not-allowed hover:text-ink-primary transition-colors active:scale-95"
      >
        ← Precedente
      </button>
      <span className="text-xs font-mono text-ink-faint">
        {page} / {totalPages}
      </span>
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        className="min-h-9 px-3 text-xs rounded-full border border-base-border bg-base-surface2 text-ink-muted disabled:opacity-40 disabled:cursor-not-allowed hover:text-ink-primary transition-colors active:scale-95"
      >
        Successiva →
      </button>
    </div>
  );
}

function splitCsv(value: string | null): string[] {
  return value ? value.split(",").filter(Boolean) : [];
}

function parsePage(value: string | null): number {
  const n = value ? parseInt(value, 10) : 1;
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** Centesimi correnti da usare per il filtro min/max: la fascia scelta ha
 * la priorita' sui campi manuali (selezionare una fascia svuota i campi, vedi
 * handleSelectTier) - solo uno dei due puo' essere attivo alla volta. */
function computeRangeCents(
  tierKey: string | null,
  customMin: string,
  customMax: string
): { minCents: number | null; maxCents: number | null } {
  const tier = findMoversTier(tierKey);
  if (tier) return { minCents: tier.minCents, maxCents: tier.maxCents };
  const minEuro = customMin.trim() ? parseFloat(customMin) : NaN;
  const maxEuro = customMax.trim() ? parseFloat(customMax) : NaN;
  return {
    minCents: Number.isFinite(minEuro) ? Math.round(minEuro * 100) : null,
    maxCents: Number.isFinite(maxEuro) ? Math.round(maxEuro * 100) : null,
  };
}

function MoversContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [rises, setRises] = useState<MoversPageResult | null>(null);
  const [drops, setDrops] = useState<MoversPageResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [binderIds, setBinderIds] = useState<Set<number>>(new Set());
  const [rarities, setRarities] = useState<string[]>([]);
  const [selectedRarities, setSelectedRarities] = useState<string[]>(() =>
    splitCsv(searchParams.get("rarity")).map(normalizeRarity)
  );
  const [tierKey, setTierKey] = useState<string | null>(() => searchParams.get("tier"));
  const [customMin, setCustomMin] = useState<string>(() =>
    searchParams.get("tier") ? "" : searchParams.get("min") ?? ""
  );
  const [customMax, setCustomMax] = useState<string>(() =>
    searchParams.get("tier") ? "" : searchParams.get("max") ?? ""
  );
  const [sort, setSort] = useState<MoversSort>(() => (searchParams.get("sort") === "abs" ? "abs" : "pct"));
  const [risePage, setRisePage] = useState(() => parsePage(searchParams.get("risePage")));
  const [dropPage, setDropPage] = useState(() => parsePage(searchParams.get("dropPage")));
  const [activeFilter, setActiveFilter] = useState<"rarity" | null>(null);
  const [activeTab, setActiveTab] = useState<"rises" | "drops">("rises");

  useEffect(() => {
    const params = new URLSearchParams();
    if (selectedRarities.length) params.set("rarity", selectedRarities.join(","));
    if (tierKey) {
      params.set("tier", tierKey);
    } else {
      if (customMin.trim()) params.set("min", customMin.trim());
      if (customMax.trim()) params.set("max", customMax.trim());
    }
    if (sort !== "pct") params.set("sort", sort);
    if (risePage > 1) params.set("risePage", String(risePage));
    if (dropPage > 1) params.set("dropPage", String(dropPage));
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [selectedRarities, tierKey, customMin, customMax, sort, risePage, dropPage, pathname, router]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setBinderIds(getBinderIds()));
    fetchRarities().then(setRarities).catch(() => {});
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const { minCents, maxCents } = computeRangeCents(tierKey, customMin, customMax);
    const base = { rarities: selectedRarities, minCents, maxCents, sort };
    Promise.all([
      fetchMoversPage({ ...base, direction: "rise", page: risePage }),
      fetchMoversPage({ ...base, direction: "drop", page: dropPage }),
    ])
      .then(([nextRises, nextDrops]) => {
        if (cancelled) return;
        setError(null);
        setRises(nextRises);
        setDrops(nextDrops);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e.message ?? e));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRarities, tierKey, customMin, customMax, sort, risePage, dropPage]);

  function handleToggleBinderCard(id: number) {
    setBinderIds(new Set(toggleBinder(id)));
  }

  // Ogni handler di filtro riparte esplicitamente dalla prima pagina di
  // entrambe le liste (non un useEffect separato che osserva i filtri e
  // chiama setState - la regola di lint del progetto vieta setState
  // sincrono nel corpo di un effetto, e qui il punto "e' cambiato un
  // filtro" e' gia' noto per costruzione in ogni singolo handler): restare
  // sulla pagina 3 di "rialzi" dopo aver cambiato fascia di prezzo
  // mostrerebbe con ottime probabilita' una pagina vuota anche se la nuova
  // combinazione ha risultati.
  function resetPages() {
    setRisePage(1);
    setDropPage(1);
  }

  function handleToggleRarity(r: string) {
    setSelectedRarities((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
    resetPages();
  }

  function handleSelectTier(key: string) {
    setTierKey((prev) => (prev === key ? null : key));
    setCustomMin("");
    setCustomMax("");
    resetPages();
  }

  function handleCustomMinChange(value: string) {
    setCustomMin(value);
    if (value.trim()) setTierKey(null);
    resetPages();
  }

  function handleCustomMaxChange(value: string) {
    setCustomMax(value);
    if (value.trim()) setTierKey(null);
    resetPages();
  }

  function handleSortChange(next: MoversSort) {
    setSort(next);
    resetPages();
  }

  const hasActiveFilters = Boolean(
    selectedRarities.length || tierKey || customMin.trim() || customMax.trim() || sort !== "pct"
  );
  const currentQuery = searchParams.toString();
  const returnTo = currentQuery ? `${pathname}?${currentQuery}` : pathname;
  useScrollRestoration("movers", (rises !== null && drops !== null) || error !== null, returnTo);

  function resetAllFilters() {
    setSelectedRarities([]);
    setTierKey(null);
    setCustomMin("");
    setCustomMax("");
    setSort("pct");
    resetPages();
  }

  // Quando il database corrente non ha ancora la serie esatta it_nm_zero_*
  // (prima del prossimo sync completo, vedi cardsDbHasExactSeries in
  // db.ts), fetchMoversPage torna available:false su entrambi i lati -
  // distinto da "0 carte in questa combinazione di filtri", che merita un
  // messaggio diverso (non e' un problema di filtri, i dati non ci sono
  // ancora).
  const notYetAvailable = rises !== null && drops !== null && !rises.available && !drops.available;

  return (
    <main className="max-w-7xl mx-auto px-5 sm:px-8 py-12">
      <SiteHeader compact />

      <Link
        href="/"
        className="text-sm text-ink-muted hover:text-accent-bright transition-colors inline-flex items-center gap-1.5 mb-8"
      >
        ← Torna al catalogo
      </Link>

      <h2 className="font-display text-2xl font-bold text-ink-primary">Carte in movimento</h2>
      <p className="text-ink-muted mt-1 max-w-xl">
        Le variazioni di prezzo più marcate registrate nell&apos;ultimo sync rispetto al
        precedente, sulla serie italiano · Near Mint · CardTrader Zero.
      </p>

      <div className="filter-toolbar mt-5 flex flex-row flex-wrap items-center gap-x-5 gap-y-3 rounded-card border border-base-border bg-base-surface/55 px-4 py-3">
        <FilterDropdown
          label="Rarità"
          options={rarities}
          selected={selectedRarities}
          onToggle={handleToggleRarity}
          open={activeFilter === "rarity"}
          onOpenChange={(open) => setActiveFilter(open ? "rarity" : null)}
        />

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-mono uppercase tracking-wider text-ink-faint mr-0.5">Fascia</span>
          {MOVERS_TIERS.map((tier) => (
            <button
              key={tier.key}
              type="button"
              aria-pressed={tierKey === tier.key}
              onClick={() => handleSelectTier(tier.key)}
              className={`min-h-9 text-xs px-2.5 py-1.5 rounded-full border transition-colors active:scale-95 ${
                tierKey === tier.key
                  ? "bg-accent/10 border-accent/60 text-accent-bright"
                  : "bg-base-surface2 border-base-border text-ink-muted hover:text-ink-primary"
              }`}
            >
              {tier.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <label className="sr-only" htmlFor="movers-min">Prezzo minimo in euro</label>
          <input
            id="movers-min"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            placeholder="Min €"
            value={customMin}
            onChange={(e) => handleCustomMinChange(e.target.value)}
            className="w-[4.5rem] min-h-9 bg-base-surface2 border border-base-border rounded-lg px-2 text-sm text-ink-primary placeholder:text-ink-faint outline-none focus:border-accent/60"
          />
          <span className="text-ink-faint text-xs" aria-hidden>–</span>
          <label className="sr-only" htmlFor="movers-max">Prezzo massimo in euro</label>
          <input
            id="movers-max"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            placeholder="Max €"
            value={customMax}
            onChange={(e) => handleCustomMaxChange(e.target.value)}
            className="w-[4.5rem] min-h-9 bg-base-surface2 border border-base-border rounded-lg px-2 text-sm text-ink-primary placeholder:text-ink-faint outline-none focus:border-accent/60"
          />
        </div>

        <div className="flex items-center gap-1.5" role="group" aria-label="Ordina per">
          <button
            type="button"
            aria-pressed={sort === "pct"}
            onClick={() => handleSortChange("pct")}
            className={`min-h-9 text-xs px-3 py-1.5 rounded-full border transition-colors active:scale-95 ${
              sort === "pct"
                ? "bg-accent/10 border-accent/60 text-accent-bright"
                : "bg-base-surface2 border-base-border text-ink-muted hover:text-ink-primary"
            }`}
          >
            Ordina per %
          </button>
          <button
            type="button"
            aria-pressed={sort === "abs"}
            onClick={() => handleSortChange("abs")}
            className={`min-h-9 text-xs px-3 py-1.5 rounded-full border transition-colors active:scale-95 ${
              sort === "abs"
                ? "bg-accent/10 border-accent/60 text-accent-bright"
                : "bg-base-surface2 border-base-border text-ink-muted hover:text-ink-primary"
            }`}
          >
            Ordina per €
          </button>
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={resetAllFilters}
            className="min-h-9 text-xs px-2 font-mono uppercase tracking-wider text-ink-faint hover:text-signal-down transition-colors"
          >
            ✕ Reset filtri
          </button>
        )}
      </div>

      {error && (
        <div className="mt-8 rounded-card border border-signal-down/30 bg-signal-down/5 text-signal-down p-5 font-mono text-sm">
          {error}
        </div>
      )}

      {!error && notYetAvailable && (
        <div className="mt-8 rounded-card border border-base-border bg-base-surface/55 text-ink-muted p-5 text-sm max-w-xl">
          Questa sezione si basa sulla serie di prezzo esatta (italiano · Near Mint · CardTrader
          Zero), non ancora presente nel database corrente: sarà disponibile dopo il prossimo sync
          completo dei prezzi.
        </div>
      )}

      {!error && !notYetAvailable && (
        <>
          <div className="lg:hidden flex gap-2 mt-8">
            <button
              type="button"
              aria-pressed={activeTab === "rises"}
              onClick={() => setActiveTab("rises")}
              className={`flex-1 min-h-11 text-sm font-display font-medium rounded-lg border px-3 py-2 transition-colors ${
                activeTab === "rises"
                  ? "bg-signal-up/10 border-signal-up/50 text-signal-up"
                  : "bg-base-surface2 border-base-border text-ink-muted"
              }`}
            >
              ▲ Rialzi
            </button>
            <button
              type="button"
              aria-pressed={activeTab === "drops"}
              onClick={() => setActiveTab("drops")}
              className={`flex-1 min-h-11 text-sm font-display font-medium rounded-lg border px-3 py-2 transition-colors ${
                activeTab === "drops"
                  ? "bg-signal-down/10 border-signal-down/50 text-signal-down"
                  : "bg-base-surface2 border-base-border text-ink-muted"
              }`}
            >
              ▼ Cali
            </button>
          </div>

          <div className="grid lg:grid-cols-2 gap-x-8 gap-y-12 mt-4 lg:mt-8">
            <section className={activeTab === "rises" ? "" : "hidden lg:block"}>
              <h3 className="font-display font-medium text-signal-up flex items-center gap-2 mb-4">
                ▲ Maggiori rialzi
                {rises !== null && (
                  <span className="text-xs font-mono text-ink-faint">({rises.totalCount})</span>
                )}
              </h3>
              {rises === null && <MoversSkeleton />}
              {rises !== null && rises.cards.length === 0 && (
                <div className="text-ink-muted text-sm">Nessun rialzo di prezzo in questa combinazione di filtri.</div>
              )}
              {rises !== null && rises.cards.length > 0 && (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 sm:gap-5">
                    {rises.cards.map((card, i) => (
                      <CardTile
                        key={card.id}
                        card={card}
                        index={i}
                        priceProfile="exact"
                        inBinder={binderIds.has(card.id)}
                        onToggleBinder={() => handleToggleBinderCard(card.id)}
                        returnTo={returnTo}
                      />
                    ))}
                  </div>
                  <Pagination page={risePage} totalCount={rises.totalCount} onChange={setRisePage} />
                </>
              )}
            </section>

            <section className={activeTab === "drops" ? "" : "hidden lg:block"}>
              <h3 className="font-display font-medium text-signal-down flex items-center gap-2 mb-4">
                ▼ Maggiori cali
                {drops !== null && (
                  <span className="text-xs font-mono text-ink-faint">({drops.totalCount})</span>
                )}
              </h3>
              {drops === null && <MoversSkeleton />}
              {drops !== null && drops.cards.length === 0 && (
                <div className="text-ink-muted text-sm">Nessun calo di prezzo in questa combinazione di filtri.</div>
              )}
              {drops !== null && drops.cards.length > 0 && (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 sm:gap-5">
                    {drops.cards.map((card, i) => (
                      <CardTile
                        key={card.id}
                        card={card}
                        index={i}
                        priceProfile="exact"
                        inBinder={binderIds.has(card.id)}
                        onToggleBinder={() => handleToggleBinderCard(card.id)}
                        returnTo={returnTo}
                      />
                    ))}
                  </div>
                  <Pagination page={dropPage} totalCount={drops.totalCount} onChange={setDropPage} />
                </>
              )}
            </section>
          </div>
        </>
      )}
    </main>
  );
}

export default function MoversPage() {
  return (
    <Suspense fallback={null}>
      <MoversContent />
    </Suspense>
  );
}

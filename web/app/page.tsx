"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  CardRow, CardsSummary, ExpansionInfo, SortOption,
  fetchCards, fetchCardsCount, fetchCardsSummary, fetchCatalogStats, fetchConditions, fetchExpansions,
  fetchLanguages, fetchMeta, fetchRarities, normalizeRarity,
} from "@/lib/db";
import { getBinderIds, toggleBinder } from "@/lib/binder";
import { getWishlistIds, toggleWishlist } from "@/lib/wishlist";
import { FilterPreset } from "@/lib/filterPreset";
import { useScrollRestoration } from "@/lib/useScrollRestoration";
import { useHideOnScrollDown } from "@/lib/useHideOnScrollDown";
import CardTile from "@/components/CardTile";
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
  // Conteggio totale delle carte che soddisfano i filtri correnti,
  // calcolato in SQL (fetchCardsCount) - NON e' cards.length: cards e'
  // limitato a visibleCount (vedi fetchCards limit), altrimenti ogni
  // ricerca/filtro tornerebbe a scaricare l'intero catalogo in JS solo per
  // sapere quante righe corrispondono in tutto.
  const [resultCount, setResultCount] = useState<number | undefined>();
  const [expansions, setExpansions] = useState<ExpansionInfo[]>([]);
  const [rarities, setRarities] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [conditions, setConditions] = useState<string[]>([]);
  const [lastSync, setLastSync] = useState<string | undefined>();
  const [totalCards, setTotalCards] = useState<number | undefined>();
  const [error, setError] = useState<string | null>(null);
  // Incrementato dal pulsante "Riprova" nello stato d'errore per rilanciare
  // le stesse fetch senza dover duplicare la logica in due punti diversi -
  // funziona perche' getDb()/getHistoryDb() ora resettano la Promise in
  // cache a null quando falliscono (altrimenti riproverebbe la STESSA
  // richiesta gia' fallita per sempre, vedi lib/db.ts).
  const [reloadTick, setReloadTick] = useState(0);
  const [expansionSummaryData, setExpansionSummaryData] = useState<CardsSummary | null>(null);

  // Lo stato dei filtri e' inizializzato dalla query string cosi' che
  // "indietro" dal browser dopo aver aperto una carta torni alla stessa
  // vista filtrata, invece di una home resettata.
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  // Il valore digitato aggiorna subito l'input (search, sopra) ma la query
  // vera e propria parte solo 250ms dopo l'ultimo tasto premuto: senza
  // questo, ogni singolo carattere rilanciava una query SQL sull'intero
  // catalogo (bug reale trovato in revisione, aggravato dal fatto che
  // fetchCards prima non aveva nemmeno un LIMIT - vedi sotto).
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  const [expansionCode, setExpansionCode] = useState(() => searchParams.get("exp") ?? "");
  const [selectedRarities, setSelectedRarities] = useState<string[]>(() =>
    splitCsv(searchParams.get("rarity")).map(normalizeRarity)
  );
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(() =>
    splitCsv(searchParams.get("lang"))
  );
  const [selectedConditions, setSelectedConditions] = useState<string[]>(() =>
    splitCsv(searchParams.get("cond"))
  );
  const [onlyZero, setOnlyZero] = useState(() => searchParams.get("zero") === "1");
  const [sortBy, setSortBy] = useState<SortOption>(
    () => (searchParams.get("sort") as SortOption) || "expansion"
  );
  const [binderIds, setBinderIds] = useState<Set<number>>(new Set());
  const [wishlistIds, setWishlistIds] = useState<Set<number>>(new Set());
  const [visibleCount, setVisibleCount] = useState(() => {
    const shown = Number(searchParams.get("shown"));
    return Number.isFinite(shown) && shown >= PAGE_SIZE ? shown : PAGE_SIZE;
  });
  const filterKey = [debouncedSearch, expansionCode, selectedRarities.join(","), selectedLanguages.join(","), selectedConditions.join(","), onlyZero, sortBy].join("|");
  const previousFilterKey = useRef(filterKey);

  // Barra filtri sticky: si nasconde scrollando verso il basso (piu' spazio
  // per vedere le carte, richiesto esplicitamente dall'utente - "quando
  // scrollo in basso il filtro scompaia"), torna scrollando verso l'alto.
  // Anche una maniglia manuale (sotto) puo' aprirla/chiuderla in qualunque
  // momento, indipendentemente dallo scroll.
  const toolbarWrapRef = useRef<HTMLDivElement>(null);
  // Stato applicativo "e' aperto un pannello filtro", non desunto dal
  // focus DOM: il pannello mobile e' in portale fuori da toolbarWrapRef e
  // Safari (desktop/iOS) non da' focus a un <button> al click/tap - il
  // solo controllo di focus in useHideOnScrollDown mancava entrambi i
  // casi, comprimendo la barra (e il popover ancorato a essa) mentre un
  // filtro era ancora visibilmente aperto (bug reale segnalato su iOS e
  // desktop, riprodotto con uno scroll reale a filtro aperto).
  const [anyFilterOpen, setAnyFilterOpen] = useState(false);
  const [toolbarVisible, setToolbarVisible] = useHideOnScrollDown(toolbarWrapRef, undefined, undefined, anyFilterOpen);

  // Specchia i filtri nella URL (senza aggiungere una entry nella cronologia
  // ad ogni singola modifica: solo la navigazione verso una carta la crea).
  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (expansionCode) params.set("exp", expansionCode);
    if (selectedRarities.length) params.set("rarity", selectedRarities.join(","));
    if (selectedLanguages.length) params.set("lang", selectedLanguages.join(","));
    if (selectedConditions.length) params.set("cond", selectedConditions.join(","));
    if (onlyZero) params.set("zero", "1");
    if (sortBy !== "expansion") params.set("sort", sortBy);
    if (visibleCount > PAGE_SIZE) params.set("shown", String(visibleCount));
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [search, expansionCode, selectedRarities, selectedLanguages, selectedConditions, onlyZero, sortBy, visibleCount, pathname, router]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setBinderIds(getBinderIds());
      setWishlistIds(getWishlistIds());
    });
    fetchExpansions().then(setExpansions).catch(() => {});
    fetchRarities().then(setRarities).catch(() => {});
    fetchLanguages().then(setLanguages).catch(() => {});
    fetchConditions().then(setConditions).catch(() => {});
    fetchMeta()
      .then((m) => setLastSync(m["last_price_sync"]))
      .catch(() => {});
    fetchCatalogStats()
      .then((s) => setTotalCards(s.totalCards))
      .catch(() => {});
    return () => cancelAnimationFrame(frame);
  }, []);

  // Ricarica le carte quando cambiano i filtri lato-query (ricerca,
  // espansione, rarità, lingua, condizione, ordinamento) o quante mostrarne
  // (visibleCount, "mostra altre"): sono gestiti in SQL con un LIMIT, non
  // si scarica ne' si rifiltra in JS. reloadTick permette al pulsante
  // "Riprova" dello stato d'errore di rilanciare la stessa fetch.
  // `limit` qui e' l'intervento piu' importante trovato in revisione:
  // prima, senza LIMIT, ogni ricerca/filtro materializzava in oggetti JS
  // TUTTE le righe corrispondenti (decine di migliaia a catalogo pieno)
  // per poi mostrarne solo 60 con uno slice() lato client.
  useEffect(() => {
    let cancelled = false;
    fetchCards({
      search: debouncedSearch, expansionCode, rarities: selectedRarities, languages: selectedLanguages,
      conditions: selectedConditions, onlyZero, sortBy, limit: visibleCount,
    })
      .then((nextCards) => {
        if (!cancelled) { setError(null); setCards(nextCards); }
      })
      .catch((e) => { if (!cancelled) setError(String(e.message ?? e)); });
    return () => { cancelled = true; };
  }, [debouncedSearch, expansionCode, selectedRarities, selectedLanguages, selectedConditions, onlyZero, sortBy, visibleCount, reloadTick]);

  useEffect(() => {
    if (previousFilterKey.current !== filterKey) {
      previousFilterKey.current = filterKey;
      setVisibleCount(PAGE_SIZE);
    }
  }, [filterKey]);

  // Conteggio totale e andamento medio dell'espansione: calcolati in SQL
  // (fetchCardsCount/fetchCardsSummary) invece che derivati da `cards`, che
  // ora e' limitato a visibleCount e non contiene piu' tutte le righe che
  // soddisfano i filtri correnti. Non dipende da visibleCount/reloadTick
  // sortBy: il totale e l'andamento medio non cambiano ne' scorrendo "mostra
  // altre" ne' cambiando ordinamento.
  useEffect(() => {
    let cancelled = false;
    let frame: number | null = null;
    const filters = {
      search: debouncedSearch, expansionCode, rarities: selectedRarities,
      languages: selectedLanguages, conditions: selectedConditions, onlyZero,
    };
    fetchCardsCount(filters).then((c) => { if (!cancelled) setResultCount(c); }).catch(() => {});
    if (expansionCode) {
      fetchCardsSummary(filters)
        .then((s) => { if (!cancelled) setExpansionSummaryData(s); })
        .catch(() => { if (!cancelled) setExpansionSummaryData(null); });
    } else {
      // setState va dentro un callback (rAF), mai sincrono nel corpo
      // dell'effetto (regola di lint del progetto, react-hooks/set-state-in-effect).
      frame = requestAnimationFrame(() => { if (!cancelled) setExpansionSummaryData(null); });
    }
    return () => { cancelled = true; if (frame !== null) cancelAnimationFrame(frame); };
  }, [debouncedSearch, expansionCode, selectedRarities, selectedLanguages, selectedConditions, onlyZero]);

  // Gia' limitato lato SQL a visibleCount (vedi fetchCards sopra): nessuno
  // slice() lato client necessario.
  const visible = cards;
  const currentQuery = searchParams.toString();
  const returnTo = currentQuery ? `${pathname}?${currentQuery}` : pathname;

  useScrollRestoration("catalog", cards !== null || error !== null, returnTo);

  const expansionSummary = expansionSummaryData && cards
    ? { ...expansionSummaryData, expansionName: cards[0]?.expansion_name ?? "" }
    : null;

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

  function handleToggleCondition(c: string) {
    setSelectedConditions((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    );
  }

  function handleToggleBinderCard(id: number) {
    setBinderIds(new Set(toggleBinder(id)));
  }

  function handleToggleWishlistCard(id: number) {
    setWishlistIds(new Set(toggleWishlist(id)));
  }

  const hasActiveFilters = Boolean(
    search || expansionCode || selectedRarities.length || selectedLanguages.length ||
      selectedConditions.length || onlyZero || sortBy !== "expansion"
  );

  function resetAllFilters() {
    setSearch("");
    setExpansionCode("");
    setSelectedRarities([]);
    setSelectedLanguages([]);
    setSelectedConditions([]);
    setOnlyZero(false);
    setSortBy("expansion");
  }

  function applyPreset(preset: FilterPreset) {
    setSearch(preset.search ?? "");
    setExpansionCode(preset.expansionCode ?? "");
    setSelectedRarities(preset.rarities.map(normalizeRarity));
    setSelectedLanguages(preset.languages);
    setSelectedConditions(preset.conditions);
    setOnlyZero(preset.onlyZero);
    setSortBy(preset.sortBy ?? "expansion");
  }

  return (
    // overflow-anchor:none e' necessario, non decorativo: la barra filtri
    // sticky sotto cambia altezza reale (si comprime/espande) quando si
    // nasconde/mostra scrollando. Senza questo, lo "scroll anchoring"
    // nativo del browser compensa quel cambio di altezza spostando da solo
    // scrollY per tenere fermo il contenuto sotto - il che genera un NUOVO
    // evento scroll, che il hook interpreta come un gesto dell'utente e
    // reagisce di nuovo, in un loop infinito (bug reale, osservato: scrollY
    // oscillava senza mai assestarsi, decine di volte al secondo).
    <main className="max-w-7xl mx-auto px-5 sm:px-8 py-12 [overflow-anchor:none]">
      <SiteHeader
        lastSync={lastSync}
        totalCards={totalCards}
        onLogoClick={hasActiveFilters ? resetAllFilters : undefined}
      />

      <div ref={toolbarWrapRef} data-testid="toolbar-collapse" className="sticky top-0 z-20 -mx-5 sm:-mx-8 px-5 sm:px-8 bg-base-bg/85 backdrop-blur-sm">
        <div
          className={`grid transition-[grid-template-rows] duration-300 ease-out ${
            toolbarVisible ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          }`}
        >
          {/* overflow-hidden SOLO mentre la barra e' compressa o si sta
              comprimendo (necessario perche' grid-template-rows a 0fr
              collassi visivamente) - overflow-visible a barra aperta,
              altrimenti questo stesso contenitore taglia il popover
              desktop di FilterDropdown (position:absolute, si estende
              sotto l'altezza naturale della barra) ogni volta che un
              pannello filtro e' aperto, anche a barra pienamente visibile
              (bug reale segnalato dall'utente: "i filtri sono nascosti
              sotto" su desktop - su mobile FilterDropdown non ne soffre
              perche' il suo pannello e' in portale su document.body,
              fuori da questo contenitore). Sicuro cambiare la classe in
              sincrono con toolbarVisible: un filtro aperto forza sempre
              toolbarVisible a true PRIMA che l'utente possa vedere un
              pannello (vedi keepVisible in useHideOnScrollDown), quindi
              overflow-visible e' gia' attivo in quell'istante. */}
          <div className={toolbarVisible ? "overflow-visible" : "overflow-hidden"}>
            <div className="py-3">
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
                conditions={conditions}
                selectedConditions={selectedConditions}
                onToggleCondition={handleToggleCondition}
                onlyZero={onlyZero}
                onToggleOnlyZero={() => setOnlyZero((v) => !v)}
                sortBy={sortBy}
                onSortChange={setSortBy}
                hasActiveFilters={hasActiveFilters}
                onResetAll={resetAllFilters}
                onApplyPreset={applyPreset}
                resultCount={resultCount}
                onAnyFilterOpenChange={setAnyFilterOpen}
              />
            </div>
          </div>
        </div>
        {/* Maniglia sempre visibile (fuori dal blocco che si comprime) per
            riaprire/richiudere a mano, indipendentemente dallo scroll -
            richiesto esplicitamente: "una tendina a scomparsa che lo fa
            estendere o nascondere". */}
        <button
          type="button"
          onClick={() => setToolbarVisible((v) => !v)}
          aria-expanded={toolbarVisible}
          aria-label={toolbarVisible ? "Nascondi filtri" : "Mostra filtri"}
          className="w-full min-h-6 flex items-center justify-center text-ink-faint hover:text-ink-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 rounded"
        >
          <span
            aria-hidden
            className={`text-[10px] transition-transform duration-300 ${toolbarVisible ? "rotate-180" : ""}`}
          >
            ▲
          </span>
        </button>
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

      {error && (
        <div className="mt-8 rounded-card border border-signal-down/30 bg-signal-down/5 p-5">
          <div className="text-signal-down font-display font-medium">
            Non riesco a caricare il catalogo al momento.
          </div>
          <p className="text-ink-muted mt-1.5 text-sm">
            Può essere un problema di connessione temporaneo — riprova tra qualche secondo.
          </p>
          <button
            type="button"
            onClick={() => setReloadTick((t) => t + 1)}
            className="btn-lift mt-4 text-sm px-4 py-2 rounded-card border border-signal-down/40 text-signal-down hover:bg-signal-down/10 transition-colors active:scale-95"
          >
            Riprova
          </button>
          <details className="mt-3 text-xs text-ink-faint">
            <summary className="cursor-pointer select-none">Dettagli tecnici</summary>
            <div className="mt-1 font-mono">{error}</div>
          </details>
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

      {cards && cards.length === 0 && (
        <div className="mt-16 text-center text-ink-muted">
          Nessuna carta trovata. Prova a modificare la ricerca o i filtri.
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
                  inWishlist={wishlistIds.has(card.id)}
                  onToggleWishlist={() => handleToggleWishlistCard(card.id)}
                  returnTo={returnTo}
                />
              ))}
          </div>

          {resultCount !== undefined && visibleCount < resultCount && (
            <div className="flex justify-center mt-8">
              <button
                onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}
                className="btn-lift text-sm px-6 py-2.5 rounded-card border border-base-border bg-base-surface text-ink-muted hover:text-ink-primary hover:border-accent/60 transition-colors active:scale-95"
              >
                Mostra altre {Math.min(PAGE_SIZE, resultCount - visibleCount)} carte
                <span className="text-ink-faint"> ({cards?.length ?? 0}/{resultCount})</span>
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

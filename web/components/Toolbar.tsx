"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArtistOption, ExpansionInfo, fetchNameSuggestions, SortOption } from "@/lib/db";
import { FilterPreset } from "@/lib/filterPreset";
import { formatDateLong, formatNumber, languageFlag, languageLabel } from "@/lib/format";
import { PRICE_BANDS, priceBandByKey } from "@/lib/priceBands";
import { releaseDateFor, UPCOMING_SETS } from "@/lib/expansions";
import ConditionBadge from "./ConditionBadge";
import FilterDropdown from "./FilterDropdown";
import FilterPresetControls from "./FilterPresetControls";

type SuggestionItem =
  | { kind: "name"; key: string; name: string }
  | { kind: "set"; key: string; name: string; code: string };

function foldText(v: string): string {
  return v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
const wordsOf = (v: string) => foldText(v).split(/[^a-z0-9]+/).filter(Boolean);
const usableToken = (t: string) => t.length >= 3 || (t.length >= 2 && /^\d+$/.test(t));

/** Espansioni che combaciano con le parole digitate: parola intera del nome
 * del set, o inizio di parola per l'ultima parola (ancora in digitazione). */
function matchExpansions(text: string, expansions: ExpansionInfo[]) {
  const tokens = wordsOf(text);
  const indexed = expansions.map((e) => ({ e, words: wordsOf(e.name) }));
  const exactFor = (t: string) => indexed.filter((x) => x.words.includes(t));
  const found = new Map<string, ExpansionInfo>();
  const setTokens: string[] = [];
  tokens.forEach((t, i) => {
    if (!usableToken(t)) return;
    const exact = exactFor(t);
    if (exact.length > 0) setTokens.push(t);
    for (const x of exact) found.set(x.e.code, x.e);
    if (i === tokens.length - 1) {
      for (const x of indexed) if (x.words.some((w) => w.startsWith(t))) found.set(x.e.code, x.e);
    }
  });
  const sets = [...found.values()].slice(0, 3);
  const rest = tokens.filter((t) => !setTokens.includes(t));
  const first = setTokens.length > 0 ? exactFor(setTokens[0]) : [];
  return {
    sets,
    exactSet: setTokens.length > 0,
    fallbackQuery: setTokens.length > 0 ? rest.join(" ") : "",
    fallbackCode: first.length === 1 ? first[0].e.code : "",
    /** Testo di ricerca senza le parole che hanno portato a quel set. */
    restWithout(code: string): string {
      const x = indexed.find((i) => i.e.code === code);
      if (!x) return text;
      return tokens.filter((t) => !(usableToken(t) && x.words.some((w) => w === t || w.startsWith(t)))).join(" ");
    },
  };
}

export default function Toolbar({
  search,
  onSearch,
  expansions,
  expansionCode,
  onExpansionChange,
  rarities,
  selectedRarities,
  onToggleRarity,
  artists,
  selectedArtists,
  onToggleArtist,
  languages,
  selectedLanguages,
  onToggleLanguage,
  conditions,
  selectedConditions,
  onToggleCondition,
  onlyZero,
  onToggleOnlyZero,
  exactName,
  onToggleExactName,
  priceBand,
  onPriceBandChange,
  sortBy,
  onSortChange,
  hasActiveFilters,
  onResetAll,
  onApplyPreset,
  resultCount,
  onAnyFilterOpenChange,
}: {
  search: string;
  onSearch: (v: string) => void;
  expansions: ExpansionInfo[];
  expansionCode: string;
  onExpansionChange: (v: string) => void;
  rarities: string[];
  selectedRarities: string[];
  onToggleRarity: (rarity: string) => void;
  /** Artisti selezionabili (lista curata, vedi web/config/top_artists.json) con quante carte hanno a catalogo. */
  artists: ArtistOption[];
  selectedArtists: string[];
  onToggleArtist: (artist: string) => void;
  languages: string[];
  selectedLanguages: string[];
  onToggleLanguage: (lang: string) => void;
  conditions: string[];
  selectedConditions: string[];
  onToggleCondition: (condition: string) => void;
  onlyZero: boolean;
  onToggleOnlyZero: () => void;
  /** Il nome deve contenere le parole cercate come parole intere ("mew" non trova "Mewtwo"). */
  exactName: boolean;
  onToggleExactName: () => void;
  /** Chiave della fascia di prezzo scelta ("" = nessuna), vedi lib/priceBands.ts. */
  priceBand: string;
  onPriceBandChange: (key: string) => void;
  sortBy: SortOption;
  onSortChange: (v: SortOption) => void;
  hasActiveFilters: boolean;
  onResetAll: () => void;
  onApplyPreset: (preset: FilterPreset) => void;
  /** Conteggio totale (non solo le carte gia' caricate/visibili) - mostrato
   * come feedback immediato dopo una ricerca/filtro. undefined finche' non
   * e' ancora arrivato dal DB, non mostra nulla in quel caso. */
  resultCount?: number;
  /** Notifica se ALMENO UN pannello filtro e' aperto (espansione inclusa) -
   * usato dalla pagina per non nascondere la toolbar allo scroll mentre un
   * filtro e' in uso. Deliberatamente basato sullo stato applicativo, non
   * sul focus DOM: il pannello espansione e' in portale su document.body
   * (fuori dal contenitore controllato) e Safari (desktop e iOS) non da'
   * focus a un <button> al click/tap - un controllo solo di focus manca
   * entrambi i casi (bug reale, trovato riproducendo lo scroll con un
   * filtro aperto: la barra si comprimeva a 0px portando con se' il
   * popover ancorato, che spariva a meta' consultazione). */
  onAnyFilterOpenChange?: (open: boolean) => void;
}) {
  const selectedExpansion = expansions.find((e) => e.code === expansionCode);
  const [activeFilter, setActiveFilter] = useState<"rarity" | "price" | "artist" | "language" | "condition" | null>(null);
  const [expansionFilterOpen, setExpansionFilterOpen] = useState(false);
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const secondaryFilterCount =
    selectedRarities.length + selectedArtists.length + selectedLanguages.length + selectedConditions.length + (onlyZero ? 1 : 0);

  // Suggerimenti mentre si digita (tipo Google): nomi di carta e, in coda,
  // le espansioni che combaciano con una parola ("charizard 151" propone il
  // set 151). L'elenco si apre solo con il campo a fuoco, si chiude da solo
  // appena si scorre la pagina o si tocca fuori (0 tocchi per liberare i
  // risultati); Invio sceglie quello evidenziato o, se non ce n'e' uno, il
  // primo.
  const listboxId = useId();
  const [suggestions, setSuggestions] = useState<string[]>([]);
  // Testo per cui sono stati calcolati: mentre arriva la risposta nuova si
  // vede ancora l'elenco precedente (niente sfarfallio), ma Invio non deve
  // scegliere da un elenco di un testo che non c'e' piu'.
  const [suggestionsFor, setSuggestionsFor] = useState("");
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const trimmedSearch = search.trim();
  const setMatches = useMemo(() => matchExpansions(trimmedSearch, expansions), [trimmedSearch, expansions]);
  // Set a cui riportare la scelta di un nome quando i nomi sono stati cercati
  // senza la parola-set ("charizard 151": nessun nome contiene "151").
  const [suggestionsSet, setSuggestionsSet] = useState("");
  const { fallbackQuery, fallbackCode } = setMatches;
  useEffect(() => {
    if (trimmedSearch.length < 2) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetchNameSuggestions(trimmedSearch)
        .then(async (names) => {
          let via = "";
          if (names.length === 0 && fallbackQuery.length >= 2) {
            names = await fetchNameSuggestions(fallbackQuery);
            via = fallbackCode;
          }
          if (!cancelled) { setSuggestions(names); setSuggestionsSet(via); setSuggestionsFor(trimmedSearch); setActiveSuggestion(-1); }
        })
        .catch(() => { if (!cancelled) setSuggestions([]); });
    }, 150);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [trimmedSearch, fallbackQuery, fallbackCode]);
  const shownSuggestions: SuggestionItem[] = suggestOpen && trimmedSearch.length >= 2
    ? (() => {
        const names = suggestions.map((name): SuggestionItem => ({ kind: "name", key: `n:${name}`, name }));
        const sets = setMatches.sets.map((e): SuggestionItem => ({ kind: "set", key: `s:${e.code}`, name: e.name, code: e.code }));
        // Una parola che e' il nome intero di un set ("151") mette il set in
        // cima: dopo 8 nomi finirebbe fuori dalla parte visibile dell'elenco.
        return setMatches.exactSet && names.length === 0 ? [...sets, ...names] : [...names, ...sets];
      })()
    : [];
  const suggestionsFresh = suggestionsFor === trimmedSearch;
  function chooseSuggestion(item: SuggestionItem) {
    if (item.kind === "set") {
      onExpansionChange(item.code);
      onSearch(setMatches.restWithout(item.code));
    } else {
      onSearch(item.name);
      // Nomi trovati senza la parola-set ("151"): il set diventa il filtro espansione.
      if (suggestionsSet) onExpansionChange(suggestionsSet);
    }
    setSuggestOpen(false);
    setActiveSuggestion(-1);
  }
  // Scorrere la pagina o toccare fuori dal campo chiude l'elenco senza
  // toccare nulla: su telefono il campo resta a fuoco (tastiera aperta),
  // quindi il solo blur non basta.
  useEffect(() => {
    if (!suggestOpen) return;
    const closeOnScroll = (e: Event) => {
      const t = e.target as Node | null;
      if (t && searchBoxRef.current?.contains(t)) return; // scorre l'elenco stesso
      setSuggestOpen(false);
    };
    const closeOnOutside = (e: PointerEvent) => {
      if (!searchBoxRef.current?.contains(e.target as Node)) setSuggestOpen(false);
    };
    document.addEventListener("scroll", closeOnScroll, { capture: true, passive: true });
    document.addEventListener("pointerdown", closeOnOutside, { passive: true });
    return () => {
      document.removeEventListener("scroll", closeOnScroll, { capture: true });
      document.removeEventListener("pointerdown", closeOnOutside);
    };
  }, [suggestOpen]);

  useEffect(() => {
    onAnyFilterOpenChange?.(activeFilter !== null || expansionFilterOpen);
  }, [activeFilter, expansionFilterOpen, onAnyFilterOpenChange]);

  // Riepilogo dei filtri attivi come pillole rimovibili singolarmente,
  // cosi' non serve riaprire ogni pannello solo per vedere/togliere una
  // selezione. closeButtonClass/chip condivisi per restare coerenti con lo
  // stile pillola gia' usato altrove nella toolbar.
  const chips: { key: string; label: React.ReactNode; onRemove: () => void }[] = [];
  if (search) chips.push({ key: "search", label: `"${search}"`, onRemove: () => onSearch("") });
  if (selectedExpansion) {
    chips.push({ key: "exp", label: selectedExpansion.name, onRemove: () => onExpansionChange("") });
  }
  for (const r of selectedRarities) chips.push({ key: `r-${r}`, label: r, onRemove: () => onToggleRarity(r) });
  for (const a of selectedArtists) chips.push({ key: `a-${a}`, label: `🎨 ${a}`, onRemove: () => onToggleArtist(a) });
  for (const l of selectedLanguages) {
    chips.push({ key: `l-${l}`, label: `${languageFlag(l)} ${languageLabel(l)}`, onRemove: () => onToggleLanguage(l) });
  }
  for (const c of selectedConditions) {
    chips.push({ key: `c-${c}`, label: <ConditionBadge condition={c} />, onRemove: () => onToggleCondition(c) });
  }
  if (priceBand) chips.push({ key: "price", label: priceBandByKey(priceBand)?.label ?? priceBand, onRemove: () => onPriceBandChange("") });
  if (exactName) chips.push({ key: "exact", label: "Nome esatto", onRemove: onToggleExactName });
  if (onlyZero) chips.push({ key: "zero", label: "⚡ Solo CardTrader Zero", onRemove: onToggleOnlyZero });

  return (
    <div className="flex flex-col gap-3">
      {resultCount !== undefined && (
        <div aria-live="polite" className="text-xs font-mono text-ink-faint">
          {formatNumber(resultCount)} {resultCount === 1 ? "carta trovata" : "carte trovate"}
        </div>
      )}
      {/* Telefono: controlli impilati a larghezza piena. Tablet md: espansione
          e ordinamento condividono una riga senza essere compressi. Desktop lg:
          ricerca + controlli tornano nel layout orizzontale compatto. */}
      <div className="flex flex-col lg:flex-row lg:items-start gap-3">
        {/* Interruttore "Nome esatto" dentro il campo: non aggiunge una riga
            alla barra filtri (sul telefono ha un'altezza massima verificata
            da tests/mobile-toolbar.spec.mjs). */}
        <div ref={searchBoxRef} className="relative lg:flex-1 w-full">
          <input
            value={search}
            onChange={(e) => { onSearch(e.target.value); setSuggestOpen(true); }}
            onFocus={() => setSuggestOpen(true)}
            onBlur={() => setSuggestOpen(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setSuggestOpen(false); return; }
              if (shownSuggestions.length === 0) return;
              if (e.key !== "Enter" && !suggestionsFresh) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveSuggestion((i) => (i + 1) % shownSuggestions.length);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveSuggestion((i) => (i <= 0 ? shownSuggestions.length - 1 : i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                // Con una voce evidenziata si sceglie quella. Senza: il nome piu'
                // vicino, ma mai un'espansione e mai quando il testo ha un numero
                // ("pikachu 25/165"): li' Invio tiene quello che hai scritto.
                const picked = !suggestionsFresh ? undefined
                  : activeSuggestion >= 0 ? shownSuggestions[activeSuggestion]
                  : /\d/.test(trimmedSearch) ? undefined : shownSuggestions.find((x) => x.kind === "name");
                if (picked) chooseSuggestion(picked);
                else { setSuggestOpen(false); setActiveSuggestion(-1); }
              }
            }}
            placeholder="Nome o numero (es. 12/98)"
            aria-label="Cerca una carta per nome o numero"
            role="combobox"
            aria-expanded={shownSuggestions.length > 0}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeSuggestion >= 0 ? `${listboxId}-${activeSuggestion}` : undefined}
            autoComplete="off"
            className="w-full min-h-11 bg-base-surface border border-base-border rounded-card pl-4 pr-28 py-2.5 text-sm text-ink-primary placeholder:text-ink-faint outline-none focus:border-accent/60 focus:shadow-glow transition-shadow"
          />
          {shownSuggestions.length > 0 && (
            <ul
              id={listboxId}
              role="listbox"
              aria-label="Suggerimenti"
              className="absolute left-0 right-0 top-full mt-1 z-30 max-h-72 overflow-y-auto bg-base-surface border border-base-border rounded-card shadow-lg py-1"
            >
              {shownSuggestions.map((item, i) => (
                <li
                  key={item.key}
                  id={`${listboxId}-${i}`}
                  role="option"
                  aria-selected={i === activeSuggestion}
                  // mousedown (che il tap genera comunque) non deve togliere il
                  // fuoco al campo, altrimenti l'elenco si chiude prima del click.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => chooseSuggestion(item)}
                  className={`min-h-11 flex items-center px-4 text-sm cursor-pointer ${
                    i === activeSuggestion ? "bg-accent/10 text-accent-bright" : "text-ink-primary hover:bg-base-surface2"
                  }`}
                >
                  {item.kind === "set" ? (
                    <span className="flex w-full items-center justify-between gap-3 min-w-0">
                      <span className="truncate">{item.name}</span>
                      <span className="shrink-0 text-[10px] font-mono uppercase tracking-wider text-ink-faint">espansione</span>
                    </span>
                  ) : item.name}
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={onToggleExactName}
            aria-pressed={exactName}
            title="Cerca il nome come parola intera: «mew» non trova «Mewtwo»"
            className={`absolute right-1.5 top-1/2 -translate-y-1/2 min-h-8 text-xs px-3 rounded-full border transition-colors active:scale-95 ${
              exactName
                ? "bg-accent/10 border-accent/60 text-accent-bright"
                : "bg-base-surface2 border-base-border text-ink-muted hover:text-ink-primary"
            }`}
          >
            Nome esatto
          </button>
        </div>

        <div className="min-w-0 w-full grid grid-cols-2 gap-2 md:gap-3 lg:w-auto lg:flex lg:flex-row">
          <div className="min-w-0 w-full lg:w-auto flex items-center gap-1">
            <FilterDropdown
              reserveSpace
              label={selectedExpansion ? `${selectedExpansion.name} (${selectedExpansion.cardCount})` : "Tutte le espansioni"}
              options={expansions.map((e) => e.code)}
              selected={expansionCode ? [expansionCode] : []}
              onToggle={(code) => onExpansionChange(code === expansionCode ? "" : code)}
              searchable
              closeOnSelect
              layout="list"
              onOpenChange={setExpansionFilterOpen}
              getSearchText={(code) => expansions.find((e) => e.code === code)?.name ?? code}
              renderOption={(code) => {
                const e = expansions.find((x) => x.code === code);
                if (!e) return code;
                const date = releaseDateFor(code);
                return (
                  <span className="flex items-center justify-between gap-3 w-full min-w-0">
                    <span className="truncate min-w-0">
                      {e.name} <span className="text-ink-faint">({e.cardCount})</span>
                    </span>
                    {date && <span className="text-ink-faint text-[10px] shrink-0">{formatDateLong(date)}</span>}
                  </span>
                );
              }}
              footerNote={
                UPCOMING_SETS.length > 0 ? (
                  <span>
                    📅 In arrivo: {UPCOMING_SETS.map((s) => `${s.name} (${s.expectedDate})`).join(", ")}
                  </span>
                ) : undefined
              }
            />
            {expansionCode && (
              <button
                type="button"
                onClick={() => onExpansionChange("")}
                aria-label="Rimuovi filtro espansione"
                title="Rimuovi filtro espansione"
                className="shrink-0 min-h-11 min-w-11 flex items-center justify-center rounded-full text-ink-faint hover:text-signal-down hover:bg-base-surface2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
              >
                ✕
              </button>
            )}
          </div>

          <select
            value={sortBy}
            onChange={(e) => onSortChange(e.target.value as SortOption)}
            aria-label="Ordina carte"
            className="min-w-0 w-full lg:w-auto bg-base-surface border border-base-border rounded-card pl-3 pr-1 py-2.5 text-[13px] sm:text-sm text-ink-primary outline-none focus:border-accent/60 lg:max-w-[13rem]"
          >
            <option value="expansion">Ordina: espansione</option>
            <option value="price_asc">Prezzo: dal più basso</option>
            <option value="price_desc">Prezzo: dal più alto</option>
            <option value="drop_first">Ribassi di prezzo prima</option>
            <option value="rise_first">Rialzi di prezzo prima</option>
            <option value="name">Nome A-Z</option>
          </select>
        </div>
      </div>

      {/* Rarità e Prezzo sono i filtri piu' usati: sempre in vista, 2 tocchi
          (apri, scegli) invece di 4 dietro "Filtri". */}
      <div className="grid grid-cols-3 gap-2 md:flex md:flex-row md:items-start md:gap-3">
        <FilterDropdown
          reserveSpace
          label="Rarità"
          options={rarities}
          selected={selectedRarities}
          onToggle={onToggleRarity}
          open={activeFilter === "rarity"}
          onOpenChange={(open) => setActiveFilter(open ? "rarity" : null)}
        />
        <FilterDropdown
          reserveSpace
          label={priceBandByKey(priceBand)?.label ?? "Prezzo"}
          options={PRICE_BANDS.map((b) => b.key)}
          selected={priceBand ? [priceBand] : []}
          onToggle={(key) => onPriceBandChange(key === priceBand ? "" : key)}
          closeOnSelect
          renderOption={(key) => priceBandByKey(key)?.label ?? key}
          open={activeFilter === "price"}
          onOpenChange={(open) => setActiveFilter(open ? "price" : null)}
        />
        <button
          type="button"
          onClick={() => setMoreFiltersOpen((v) => !v)}
          aria-expanded={moreFiltersOpen}
          aria-controls="home-filters"
          className="md:hidden w-full min-w-0 min-h-11 flex items-center justify-between gap-1 rounded-card border border-base-border bg-base-surface/45 px-3 text-sm text-ink-muted active:scale-[0.99]"
        >
          <span className="truncate">Filtri{secondaryFilterCount > 0 ? ` (${secondaryFilterCount})` : ""}</span>
          <span aria-hidden>{moreFiltersOpen ? "▲" : "▼"}</span>
        </button>
      </div>

      {/* Su telefono i filtri secondari stanno dietro un pulsante (chiusi di
          default) cosi' le carte entrano nel primo schermo; le selezioni attive
          restano visibili come chip qui sotto. Da md in su il pannello e' sempre aperto. */}
      <div id="home-filters" className={`filter-toolbar ${moreFiltersOpen ? "flex" : "hidden"} md:flex flex-row flex-wrap items-start gap-x-5 gap-y-2 rounded-card border border-base-border bg-base-surface/45 px-4 py-2.5`}>
        {/* Pochi artisti scelti (non tutti gli illustratori): lista corta con
            ricerca, il numero di carte accanto al nome. */}
        <FilterDropdown
          reserveSpace
          label="Artista"
          options={artists.map((a) => a.name)}
          selected={selectedArtists}
          onToggle={onToggleArtist}
          searchable
          layout="list"
          renderOption={(name) => (
            <span className="flex w-full items-baseline justify-between gap-3">
              <span>{name}</span>
              <span className="text-ink-faint font-mono text-[11px]">{artists.find((a) => a.name === name)?.count}</span>
            </span>
          )}
          open={activeFilter === "artist"}
          onOpenChange={(open) => setActiveFilter(open ? "artist" : null)}
        />
        <FilterDropdown
          reserveSpace
          label="Lingua"
          options={languages}
          selected={selectedLanguages}
          onToggle={onToggleLanguage}
          renderOption={(l) => `${languageFlag(l)} ${languageLabel(l)}`}
          open={activeFilter === "language"}
          onOpenChange={(open) => setActiveFilter(open ? "language" : null)}
        />
        <FilterDropdown
          reserveSpace
          label="Condizione"
          options={conditions}
          selected={selectedConditions}
          onToggle={onToggleCondition}
          renderOption={(c) => <ConditionBadge condition={c} />}
          open={activeFilter === "condition"}
          onOpenChange={(open) => setActiveFilter(open ? "condition" : null)}
        />
        <button
          type="button"
          onClick={onToggleOnlyZero}
          className={`min-h-11 text-xs px-3 py-2 rounded-full border transition-colors active:scale-95 ${
            onlyZero
              ? "bg-accent/10 border-accent/60 text-accent-bright"
              : "bg-base-surface2 border-base-border text-ink-muted hover:text-ink-primary"
          }`}
        >
          ⚡ Solo CardTrader Zero
        </button>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={onResetAll}
            className="min-h-11 text-xs px-2 font-mono uppercase tracking-wider text-ink-faint hover:text-signal-down transition-colors"
          >
            ✕ Reset filtri
          </button>
        )}
        <FilterPresetControls
          scope="catalog"
          current={{
            search,
            expansionCode,
            rarities: selectedRarities,
            artists: selectedArtists,
            languages: selectedLanguages,
            conditions: selectedConditions,
            onlyZero,
            exactName,
            priceBand,
            sortBy,
          }}
          onApply={onApplyPreset}
        />
      </div>

      {/* Riepilogo dei filtri attivi: rimuovere UNA selezione non deve
          richiedere di riaprire il pannello che l'ha impostata. Scorrimento
          orizzontale su mobile invece di andare a capo all'infinito (molte
          selezioni insieme occuperebbero altrimenti parecchio spazio
          verticale su schermi stretti). */}
      {chips.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto sm:flex-wrap sm:overflow-visible -mx-1 px-1 pb-1">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={chip.onRemove}
              className="shrink-0 inline-flex items-center gap-1.5 min-h-8 text-xs pl-3 pr-2 py-1 rounded-full border border-base-border bg-base-surface2 text-ink-muted hover:text-ink-primary hover:border-signal-down/50 transition-colors active:scale-95"
            >
              <span className="whitespace-nowrap">{chip.label}</span>
              <span aria-hidden className="text-ink-faint">✕</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

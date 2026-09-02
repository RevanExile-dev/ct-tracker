"use client";

import { useEffect, useState } from "react";
import { ExpansionInfo, SortOption } from "@/lib/db";
import { FilterPreset } from "@/lib/filterPreset";
import { formatDateLong, languageFlag, languageLabel } from "@/lib/format";
import { releaseDateFor, UPCOMING_SETS } from "@/lib/expansions";
import ConditionBadge from "./ConditionBadge";
import FilterDropdown from "./FilterDropdown";
import FilterPresetControls from "./FilterPresetControls";

export default function Toolbar({
  search,
  onSearch,
  expansions,
  expansionCode,
  onExpansionChange,
  rarities,
  selectedRarities,
  onToggleRarity,
  languages,
  selectedLanguages,
  onToggleLanguage,
  conditions,
  selectedConditions,
  onToggleCondition,
  onlyZero,
  onToggleOnlyZero,
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
  languages: string[];
  selectedLanguages: string[];
  onToggleLanguage: (lang: string) => void;
  conditions: string[];
  selectedConditions: string[];
  onToggleCondition: (condition: string) => void;
  onlyZero: boolean;
  onToggleOnlyZero: () => void;
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
  const [activeFilter, setActiveFilter] = useState<"rarity" | "language" | "condition" | null>(null);
  const [expansionFilterOpen, setExpansionFilterOpen] = useState(false);

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
  for (const l of selectedLanguages) {
    chips.push({ key: `l-${l}`, label: `${languageFlag(l)} ${languageLabel(l)}`, onRemove: () => onToggleLanguage(l) });
  }
  for (const c of selectedConditions) {
    chips.push({ key: `c-${c}`, label: <ConditionBadge condition={c} />, onRemove: () => onToggleCondition(c) });
  }
  if (onlyZero) chips.push({ key: "zero", label: "⚡ Solo CardTrader Zero", onRemove: onToggleOnlyZero });

  return (
    <div className="flex flex-col gap-3">
      {resultCount !== undefined && (
        <div aria-live="polite" className="text-xs font-mono text-ink-faint">
          {resultCount} {resultCount === 1 ? "carta trovata" : "carte trovate"}
        </div>
      )}
      {/* Telefono: controlli impilati a larghezza piena. Tablet md: espansione
          e ordinamento condividono una riga senza essere compressi. Desktop lg:
          ricerca + controlli tornano nel layout orizzontale compatto. */}
      <div className="flex flex-col lg:flex-row lg:items-start gap-3">
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Cerca una carta per nome…"
          aria-label="Cerca una carta per nome"
          className="lg:flex-1 w-full bg-base-surface border border-base-border rounded-card px-4 py-2.5 text-sm text-ink-primary placeholder:text-ink-faint outline-none focus:border-accent/60 focus:shadow-glow transition-shadow"
        />

        <div className="min-w-0 w-full grid grid-cols-1 md:grid-cols-2 gap-3 lg:w-auto lg:flex lg:flex-row">
          <div className="min-w-0 w-full lg:w-auto flex items-center gap-1">
            <FilterDropdown
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
            className="min-w-0 w-full lg:w-auto bg-base-surface border border-base-border rounded-card px-3 py-2.5 text-sm text-ink-primary outline-none focus:border-accent/60 lg:max-w-[13rem]"
          >
            <option value="expansion">Ordina: espansione</option>
            <option value="price_asc">Prezzo: dal più basso</option>
            <option value="price_desc">Prezzo: dal più alto</option>
            <option value="drop_first">Cali di prezzo prima</option>
            <option value="rise_first">Rialzi di prezzo prima</option>
            <option value="name">Nome A-Z</option>
          </select>
        </div>
      </div>

      <div className="filter-toolbar flex flex-row flex-wrap items-start gap-x-5 gap-y-2 rounded-card border border-base-border bg-base-surface/45 px-4 py-2.5">
        <FilterDropdown
          label="Rarità"
          options={rarities}
          selected={selectedRarities}
          onToggle={onToggleRarity}
          open={activeFilter === "rarity"}
          onOpenChange={(open) => setActiveFilter(open ? "rarity" : null)}
        />
        <FilterDropdown
          label="Lingua"
          options={languages}
          selected={selectedLanguages}
          onToggle={onToggleLanguage}
          renderOption={(l) => `${languageFlag(l)} ${languageLabel(l)}`}
          open={activeFilter === "language"}
          onOpenChange={(open) => setActiveFilter(open ? "language" : null)}
        />
        <FilterDropdown
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
            languages: selectedLanguages,
            conditions: selectedConditions,
            onlyZero,
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

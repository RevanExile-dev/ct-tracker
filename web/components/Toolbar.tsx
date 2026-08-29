"use client";

import { ExpansionInfo, SortOption } from "@/lib/db";
import { formatDateLong, languageFlag, languageLabel } from "@/lib/format";
import { releaseDateFor, UPCOMING_SETS } from "@/lib/expansions";
import ConditionBadge from "./ConditionBadge";
import FilterDropdown from "./FilterDropdown";

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
  onlyBinder,
  onToggleBinder,
  hasActiveFilters,
  onResetAll,
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
  onlyBinder: boolean;
  onToggleBinder: () => void;
  hasActiveFilters: boolean;
  onResetAll: () => void;
}) {
  const selectedExpansion = expansions.find((e) => e.code === expansionCode);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Cerca una carta per nome…"
          className="sm:flex-1 w-full bg-base-surface border border-base-border rounded-card px-4 py-2.5 text-sm text-ink-primary placeholder:text-ink-faint outline-none focus:border-accent/60 focus:shadow-glow transition-shadow"
        />

        {/* Su mobile espansione+ordina condividono una riga (invece di 4 righe
            piene una sotto l'altra) cosi' si arriva prima alle carte.
            min-w-0 e' necessario: senza, questo contenitore (essendo lui
            stesso flex/grid) rifiuta di restringersi sotto la sua larghezza
            "naturale" quando e' un figlio del flex row esterno, schiacciando
            la ricerca a pochi pixel su viewport medi tipo tablet (bug reale
            trovato testando a 768px). */}
        <div className="min-w-0 grid grid-cols-2 sm:flex sm:flex-row gap-3">
          <FilterDropdown
            label={selectedExpansion ? `${selectedExpansion.name} (${selectedExpansion.cardCount})` : "Tutte le espansioni"}
            options={expansions.map((e) => e.code)}
            selected={expansionCode ? [expansionCode] : []}
            onToggle={(code) => onExpansionChange(code === expansionCode ? "" : code)}
            searchable
            closeOnSelect
            layout="list"
            getSearchText={(code) => expansions.find((e) => e.code === code)?.name ?? code}
            renderOption={(code) => {
              const e = expansions.find((x) => x.code === code);
              if (!e) return code;
              const date = releaseDateFor(code);
              return (
                <span className="flex items-center justify-between gap-3 w-full">
                  <span className="truncate">
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

          <select
            value={sortBy}
            onChange={(e) => onSortChange(e.target.value as SortOption)}
            className="min-w-0 bg-base-surface border border-base-border rounded-card px-3 py-2.5 text-sm text-ink-primary outline-none focus:border-accent/60 sm:max-w-[9rem] lg:max-w-[13rem]"
          >
            <option value="expansion">Ordina: espansione</option>
            <option value="price_asc">Prezzo: dal più basso</option>
            <option value="price_desc">Prezzo: dal più alto</option>
            <option value="drop_first">Cali di prezzo prima</option>
            <option value="rise_first">Rialzi di prezzo prima</option>
            <option value="name">Nome A-Z</option>
          </select>
        </div>

        <button
          onClick={onToggleBinder}
          className={`btn-lift whitespace-nowrap text-sm px-4 py-2.5 rounded-card border transition-colors active:scale-95 ${
            onlyBinder
              ? "bg-accent/10 border-accent/60 text-accent-bright"
              : "bg-base-surface border-base-border text-ink-muted hover:text-ink-primary"
          }`}
        >
          Il mio binder
        </button>
      </div>

      <div className="flex flex-row flex-wrap items-center gap-4 sm:gap-6">
        <FilterDropdown
          label="Filtra per rarità"
          options={rarities}
          selected={selectedRarities}
          onToggle={onToggleRarity}
        />
        <FilterDropdown
          label="Filtra per lingua"
          options={languages}
          selected={selectedLanguages}
          onToggle={onToggleLanguage}
          renderOption={(l) => `${languageFlag(l)} ${languageLabel(l)}`}
        />
        <FilterDropdown
          label="Filtra per condizione"
          options={conditions}
          selected={selectedConditions}
          onToggle={onToggleCondition}
          renderOption={(c) => <ConditionBadge condition={c} />}
        />
        <button
          type="button"
          onClick={onToggleOnlyZero}
          className={`text-xs px-3 py-1.5 rounded-full border transition-colors active:scale-95 ${
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
            className="text-xs font-mono uppercase tracking-wider text-ink-faint hover:text-signal-down transition-colors"
          >
            ✕ Reset filtri
          </button>
        )}
      </div>
    </div>
  );
}

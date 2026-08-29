"use client";

import { ExpansionInfo, SortOption } from "@/lib/db";
import { languageFlag, languageLabel } from "@/lib/format";
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
  sortBy,
  onSortChange,
  onlyBinder,
  onToggleBinder,
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
  sortBy: SortOption;
  onSortChange: (v: SortOption) => void;
  onlyBinder: boolean;
  onToggleBinder: () => void;
}) {
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
          <select
            value={expansionCode}
            onChange={(e) => onExpansionChange(e.target.value)}
            className="min-w-0 bg-base-surface border border-base-border rounded-card px-3 py-2.5 text-sm text-ink-primary outline-none focus:border-accent/60 sm:max-w-[10rem] lg:max-w-xs"
          >
            <option value="">Tutte le espansioni</option>
            {expansions.map((e) => (
              <option key={e.code} value={e.code}>
                {e.name} ({e.cardCount})
              </option>
            ))}
          </select>

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

      <div className="flex flex-row flex-wrap gap-4 sm:gap-6">
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
      </div>
    </div>
  );
}

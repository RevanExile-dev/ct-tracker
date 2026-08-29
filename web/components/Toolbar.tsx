"use client";

import { ExpansionInfo, SortOption } from "@/lib/db";

export default function Toolbar({
  search,
  onSearch,
  expansions,
  expansionCode,
  onExpansionChange,
  rarities,
  selectedRarities,
  onToggleRarity,
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
  sortBy: SortOption;
  onSortChange: (v: SortOption) => void;
  onlyBinder: boolean;
  onToggleBinder: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="relative flex-1">
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Cerca una carta per nome…"
            className="w-full bg-base-surface border border-base-border rounded-card px-4 py-2.5 text-sm text-ink-primary placeholder:text-ink-faint outline-none focus:border-accent/60 focus:shadow-glow transition-shadow"
          />
        </div>

        <select
          value={expansionCode}
          onChange={(e) => onExpansionChange(e.target.value)}
          className="bg-base-surface border border-base-border rounded-card px-3 py-2.5 text-sm text-ink-primary outline-none focus:border-accent/60 max-w-full sm:max-w-xs"
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
          className="bg-base-surface border border-base-border rounded-card px-3 py-2.5 text-sm text-ink-primary outline-none focus:border-accent/60"
        >
          <option value="expansion">Ordina: espansione</option>
          <option value="price_asc">Prezzo: dal più basso</option>
          <option value="price_desc">Prezzo: dal più alto</option>
          <option value="name">Nome A-Z</option>
        </select>

        <button
          onClick={onToggleBinder}
          className={`whitespace-nowrap text-sm px-4 py-2.5 rounded-card border transition-colors ${
            onlyBinder
              ? "bg-accent/10 border-accent/60 text-accent-bright"
              : "bg-base-surface border-base-border text-ink-muted hover:text-ink-primary"
          }`}
        >
          Il mio binder
        </button>
      </div>

      {rarities.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer select-none text-xs font-mono uppercase tracking-wider text-ink-muted hover:text-ink-primary list-none flex items-center gap-1.5">
            <span className="transition-transform group-open:rotate-90">▸</span>
            Filtra per rarità
            {selectedRarities.length > 0 && (
              <span className="text-accent-bright">({selectedRarities.length})</span>
            )}
          </summary>
          <div className="flex flex-wrap gap-2 mt-3">
            {rarities.map((r) => {
              const active = selectedRarities.includes(r);
              return (
                <button
                  key={r}
                  onClick={() => onToggleRarity(r)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    active
                      ? "bg-accent/10 border-accent/60 text-accent-bright"
                      : "bg-base-surface border-base-border text-ink-muted hover:text-ink-primary"
                  }`}
                >
                  {r}
                </button>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}

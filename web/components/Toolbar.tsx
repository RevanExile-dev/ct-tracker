"use client";

export default function Toolbar({
  search,
  onSearch,
  expansions,
  expansionCode,
  onExpansionChange,
  onlyPremium,
  onTogglePremium,
}: {
  search: string;
  onSearch: (v: string) => void;
  expansions: { code: string; name: string }[];
  expansionCode: string;
  onExpansionChange: (v: string) => void;
  onlyPremium: boolean;
  onTogglePremium: () => void;
}) {
  return (
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
        className="bg-base-surface border border-base-border rounded-card px-3 py-2.5 text-sm text-ink-primary outline-none focus:border-accent/60"
      >
        <option value="">Tutte le espansioni</option>
        {expansions.map((e) => (
          <option key={e.code} value={e.code}>
            {e.name}
          </option>
        ))}
      </select>

      <button
        onClick={onTogglePremium}
        className={`whitespace-nowrap text-sm px-4 py-2.5 rounded-card border transition-colors ${
          onlyPremium
            ? "bg-accent/10 border-accent/60 text-accent-bright"
            : "bg-base-surface border-base-border text-ink-muted hover:text-ink-primary"
        }`}
      >
        Solo premium
      </button>
    </div>
  );
}

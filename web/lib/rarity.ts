// Normalizzazione dei nomi di rarita': pura logica di stringhe, nessun I/O.
// Condivisa tra web/lib/db.ts (canonicalizza i filtri scelti dall'utente
// prima di chiamare le API) e web/lib/db.server.ts (espande un nome
// canonico nei suoi alias per il filtro SQL lato Postgres).

const RARITY_ALIASES: Record<string, string[]> = {
  // CardTrader usa sia il nome abbreviato sia un refuso senza la seconda
  // "t" in set diversi. Per l'utente sono tutti la stessa rarita'.
  "Special Illustration Rare": [
    "Special Illustration Rare",
    "Special Illustration",
    "Special Illustraion Rare",
  ],
};

const RARITY_CANONICAL = new Map(
  Object.entries(RARITY_ALIASES).flatMap(([canonical, aliases]) =>
    aliases.map((alias) => [alias, canonical] as const)
  )
);

export function normalizeRarity(rarity: string): string {
  return RARITY_CANONICAL.get(rarity) ?? rarity;
}

export function expandRarityFilters(rarities: string[]): string[] {
  return Array.from(new Set(rarities.flatMap((rarity) => {
    const canonical = normalizeRarity(rarity);
    return RARITY_ALIASES[canonical] ?? [rarity];
  })));
}

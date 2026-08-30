import { SortOption } from "./db";

export type FilterPreset = {
  search?: string;
  expansionCode?: string;
  rarities: string[];
  languages: string[];
  conditions: string[];
  onlyZero: boolean;
  sortBy?: SortOption;
};

const PREFIX = "carta-viva:filter-preset:v1:";

export function readFilterPreset(scope: string): FilterPreset | null {
  try {
    const raw = localStorage.getItem(`${PREFIX}${scope}`);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<FilterPreset>;
    return {
      search: typeof value.search === "string" ? value.search : undefined,
      expansionCode: typeof value.expansionCode === "string" ? value.expansionCode : undefined,
      rarities: Array.isArray(value.rarities) ? value.rarities.filter((v): v is string => typeof v === "string") : [],
      languages: Array.isArray(value.languages) ? value.languages.filter((v): v is string => typeof v === "string") : [],
      conditions: Array.isArray(value.conditions) ? value.conditions.filter((v): v is string => typeof v === "string") : [],
      onlyZero: value.onlyZero === true,
      sortBy: typeof value.sortBy === "string" ? value.sortBy as SortOption : undefined,
    };
  } catch {
    return null;
  }
}

export function writeFilterPreset(scope: string, preset: FilterPreset) {
  localStorage.setItem(`${PREFIX}${scope}`, JSON.stringify(preset));
}

export function removeFilterPreset(scope: string) {
  localStorage.removeItem(`${PREFIX}${scope}`);
}

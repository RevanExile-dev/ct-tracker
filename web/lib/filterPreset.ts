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

let syncEnabled = false;

function pushPreset(scope: string, preset: FilterPreset) {
  if (!syncEnabled) return;
  fetch(`/api/account/filter-presets/${encodeURIComponent(scope)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(preset),
  }).catch(() => {});
}

export function writeFilterPreset(scope: string, preset: FilterPreset) {
  localStorage.setItem(`${PREFIX}${scope}`, JSON.stringify(preset));
  pushPreset(scope, preset);
}

export function removeFilterPreset(scope: string) {
  localStorage.removeItem(`${PREFIX}${scope}`);
  if (syncEnabled) {
    fetch(`/api/account/filter-presets/${encodeURIComponent(scope)}`, { method: "DELETE" }).catch(() => {});
  }
}

/** Da chiamare una sola volta per ogni scope noto (vedi
 * web/lib/accountSync.ts) subito dopo il login: un preset gia' presente su
 * questo dispositivo e' considerato quello attivo e viene spinto
 * sull'account (sovrascrivendo un eventuale preset salvato da un altro
 * dispositivo) - scelta deliberata, non un vero merge per timestamp: un
 * filtro salvato e' a basso rischio rispetto al binder (non si perde mai
 * una carta, solo l'ultima combinazione di filtri scelta), non vale la
 * complessita' di un confronto tra dispositivi. Solo se questo dispositivo
 * non ha ancora un preset locale per quello scope, adotta quello
 * dell'account. */
export async function syncFilterPresetWithServer(scope: string): Promise<void> {
  if (typeof window === "undefined") return;
  const local = readFilterPreset(scope);
  syncEnabled = true;
  if (local) {
    pushPreset(scope, local);
    return;
  }
  try {
    const res = await fetch(`/api/account/filter-presets/${encodeURIComponent(scope)}`);
    if (res.ok) {
      const server = (await res.json()) as { data: FilterPreset } | null;
      if (server?.data) localStorage.setItem(`${PREFIX}${scope}`, JSON.stringify(server.data));
    }
  } catch {
    // Offline o errore di rete: nessun preset disponibile ora ne' in
    // locale ne' dal server, non e' bloccante.
  }
}

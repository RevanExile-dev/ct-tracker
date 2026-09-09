"use client";

import { syncBinderWithServer } from "./binder";
import { syncWishlistWithServer } from "./wishlist";
import { syncFilterPresetWithServer } from "./filterPreset";

// Unico scope usato oggi da FilterPresetControls (Toolbar.tsx, catalogo
// home - vedi scope="catalog"). Gli scope non sono registrati da nessuna
// parte: se in futuro se ne aggiunge un altro va elencato anche qui,
// altrimenti quel preset continua a funzionare (resta in localStorage) ma
// non viene sincronizzato con l'account.
const KNOWN_FILTER_PRESET_SCOPES = ["catalog"];

/** Chiamata una sola volta subito dopo il login (vedi
 * web/components/AccountSync.tsx): unisce binder/wishlist/filtri salvati
 * locali con quelli dell'account e attiva il push in background per le
 * modifiche successive - vedi i singoli moduli per il ragionamento sul
 * merge di ciascuno. */
export async function syncAccountData(): Promise<void> {
  await Promise.allSettled([
    syncBinderWithServer(),
    syncWishlistWithServer(),
    ...KNOWN_FILTER_PRESET_SCOPES.map((scope) => syncFilterPresetWithServer(scope)),
  ]);
}

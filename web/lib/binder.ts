"use client";

/** Il "binder personale": le carte che possiedi, salvate solo su questo
 * dispositivo (localStorage). Nessun account, nessun server: se cambi
 * browser o cancelli i dati del sito, la lista si perde. */

// Binder v2: da Set<blueprintId> a un'entry per carta con lingua/quantita'/
// condizione/finitura, richiesto per collegare lo scanner (che rileva la
// lingua della copia fisica) e per distinguere piu' copie della stessa
// carta. Chiave NUOVA (":v2"), non quella legacy: se la migrazione dovesse
// fallire a scrivere (quota piena, privacy mode), il dato legacy resta
// intatto e non tentiamo mai di sovrascriverlo o cancellarlo - viene solo
// letto una volta per costruire le entry v2 in memoria, la migrazione vera
// e propria (il salvataggio sotto la chiave v2) viene ritentata alla
// lettura successiva finche' non riesce.
const LEGACY_KEY = "ct-tracker:binder";
const KEY = "ct-tracker:binder:v2";

export type BinderFinish = "normal" | "foil" | "reverse" | "unknown";

export type BinderEntry = {
  blueprintId: number;
  language: string | null;
  quantity: number;
  condition?: string;
  finish: BinderFinish;
  addedAt: string;
};

function isValidEntry(value: unknown): value is BinderEntry {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.blueprintId === "number" && Number.isFinite(v.blueprintId) && typeof v.quantity === "number";
}

function readLegacyIds(): number[] {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is number => typeof x === "number" && Number.isFinite(x)) : [];
  } catch {
    return [];
  }
}

function migrateFromLegacy(): BinderEntry[] {
  const legacyIds = readLegacyIds();
  if (!legacyIds.length) return [];
  const now = new Date().toISOString();
  // Un blueprintId puo' comparire piu' volte nel formato legacy solo se il
  // dato era gia' corrotto (era un Set, non dovrebbe succedere) - dedup
  // difensivo per non creare entry doppie alla prima migrazione.
  const seen = new Set<number>();
  const migrated: BinderEntry[] = [];
  for (const blueprintId of legacyIds) {
    if (seen.has(blueprintId)) continue;
    seen.add(blueprintId);
    migrated.push({ blueprintId, language: null, quantity: 1, finish: "unknown", addedAt: now });
  }
  return migrated;
}

function readEntries(): BinderEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const valid = parsed.filter(isValidEntry);
        // Anche solo UNA riga valida conta come "gia' migrato": non deve
        // rifondersi col legacy ogni volta che l'array v2 e' vuoto per un
        // motivo legittimo (l'utente ha svuotato il binder).
        if (valid.length || parsed.length === 0) return valid;
      }
    }
  } catch {
    // JSON corrotto sotto la chiave v2: prova la migrazione dal legacy
    // sotto invece di propagare l'errore e rompere la pagina.
  }
  const migrated = migrateFromLegacy();
  if (migrated.length) writeEntries(migrated);
  return migrated;
}

function writeEntries(entries: BinderEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Storage non disponibile (privacy mode, quota piena...): ignoriamo,
    // la lista semplicemente non viene salvata in questa sessione.
  }
}

export function getBinderEntries(): BinderEntry[] {
  if (typeof window === "undefined") return [];
  return readEntries();
}

/** Compatibilita' con tutto il codice esistente (CardTile, catalogo, /binder,
 * /movers, pagina carta): un Set di soli id, esattamente come nel formato v1 -
 * nessuno di quei punti deve sapere che sotto ora c'e' un'entry piu' ricca. */
export function getBinderIds(): Set<number> {
  return new Set(getBinderEntries().map((entry) => entry.blueprintId));
}

export function isInBinder(id: number): boolean {
  return getBinderIds().has(id);
}

/** Comportamento invariato rispetto a v1: aggiunge con i valori di default
 * se assente, rimuove se presente. Per impostare lingua/finitura/quantita'
 * durante l'aggiunta (es. dallo scanner) usare upsertBinderEntry(). */
export function toggleBinder(id: number): Set<number> {
  if (typeof window === "undefined") return new Set();
  const entries = readEntries();
  const idx = entries.findIndex((entry) => entry.blueprintId === id);
  const next =
    idx >= 0
      ? entries.slice(0, idx).concat(entries.slice(idx + 1))
      : entries.concat([{ blueprintId: id, language: null, quantity: 1, finish: "unknown", addedAt: new Date().toISOString() }]);
  writeEntries(next);
  return new Set(next.map((entry) => entry.blueprintId));
}

/** Aggiunge la carta se assente (con i campi passati, il resto ai default),
 * oppure aggiorna solo i campi passati se gia' presente - MAI rimuove.
 * Usata dallo scanner per registrare la lingua rilevata della copia fisica. */
export function upsertBinderEntry(blueprintId: number, patch: Partial<Omit<BinderEntry, "blueprintId">>): BinderEntry[] {
  if (typeof window === "undefined") return [];
  const entries = readEntries();
  const idx = entries.findIndex((entry) => entry.blueprintId === blueprintId);
  let next: BinderEntry[];
  if (idx >= 0) {
    next = entries.slice();
    next[idx] = { ...next[idx], ...patch };
  } else {
    next = entries.concat([{
      blueprintId,
      language: patch.language ?? null,
      quantity: patch.quantity ?? 1,
      condition: patch.condition,
      finish: patch.finish ?? "unknown",
      addedAt: new Date().toISOString(),
    }]);
  }
  writeEntries(next);
  return next;
}

export function removeBinderEntry(blueprintId: number): BinderEntry[] {
  if (typeof window === "undefined") return [];
  const next = readEntries().filter((entry) => entry.blueprintId !== blueprintId);
  writeEntries(next);
  return next;
}

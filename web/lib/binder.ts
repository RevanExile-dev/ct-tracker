"use client";

/** Il "binder personale": le carte che possiedi. Sempre salvate in
 * localStorage (letture/scritture restano sincrone, nessuno stato di
 * caricamento per chi usa il sito da sloggato). Se l'utente ha fatto
 * login, ogni modifica viene anche spinta in background su
 * /api/account/binder (best-effort: un fallimento di rete non blocca ne'
 * fa perdere la modifica locale) - vedi syncBinderWithServer(), chiamata
 * una sola volta dopo il login da web/components/AccountSync.tsx. */

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

// Stesso limite di MAX_BINDER_QUANTITY in web/lib/account.server.ts
// (duplicato apposta, un lato client uno server: nessuna dipendenza a
// runtime tra i due, vedi commento in account.server.ts sul motivo del
// limite). Le due soglie vanno tenute allineate.
const MAX_QUANTITY = 999;

function isValidQuantity(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_QUANTITY;
}

function isValidEntry(value: unknown): value is BinderEntry {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.blueprintId === "number" && Number.isFinite(v.blueprintId);
}

// Non fa parte del "cosa rende un'entry valida" sopra: una quantita'
// corrotta o fuori intervallo (es. scritta a mano in devtools, o un vecchio
// bug) non deve far sparire l'intera carta dal binder - solo la sua
// quantita' torna a 1, la carta resta posseduta.
function normalizeQuantity(entry: BinderEntry): BinderEntry {
  return isValidQuantity(entry.quantity) ? entry : { ...entry, quantity: 1 };
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
        const valid = parsed.filter(isValidEntry).map(normalizeQuantity);
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

// Attivato da syncBinderWithServer() dopo il primo merge post-login: da
// quel momento ogni scrittura locale spinge anche verso il server. Resta
// false per l'intera sessione di navigazione da sloggato (nessuna fetch
// inutile verso un endpoint che risponderebbe comunque 401).
let syncEnabled = false;

function pushUpsert(blueprintId: number, patch: Partial<Omit<BinderEntry, "blueprintId" | "addedAt">>) {
  if (!syncEnabled) return;
  fetch(`/api/account/binder/${blueprintId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).catch(() => {
    // Best-effort: la modifica resta comunque salvata in locale. Se questo
    // push fallisce (rete assente, sessione scaduta...) il dato diverge
    // dal server solo finche' non arriva un'altra modifica o un altro
    // login/merge - nessun dato locale viene perso per questo.
  });
}

function pushDelete(blueprintId: number) {
  if (!syncEnabled) return;
  fetch(`/api/account/binder/${blueprintId}`, { method: "DELETE" }).catch(() => {});
}

/** Da chiamare una sola volta subito dopo il login (vedi AccountSync):
 * unisce il binder locale con quello dell'account - l'entry locale vince
 * in caso di conflitto sullo stesso blueprintId (e' quella "attiva" su
 * questo dispositivo proprio ora), le entry presenti solo sul server
 * vengono aggiunte - poi allinea entrambi i lati al risultato e attiva il
 * push in background per le modifiche successive. Nessun dato viene mai
 * scartato, solo unito. */
export async function syncBinderWithServer(): Promise<void> {
  if (typeof window === "undefined") return;
  let serverEntries: BinderEntry[] = [];
  try {
    const res = await fetch("/api/account/binder");
    if (res.ok) serverEntries = await res.json();
  } catch {
    // Offline o errore di rete: procede solo con i dati locali, il merge
    // verra' ritentato al prossimo login/refresh.
  }
  const local = readEntries();
  const localIds = new Set(local.map((entry) => entry.blueprintId));
  const merged = local.concat(serverEntries.filter((entry) => !localIds.has(entry.blueprintId)));
  writeEntries(merged);
  syncEnabled = true;
  if (merged.length) {
    fetch("/api/account/binder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(merged),
    }).catch(() => {});
  }
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
  const wasPresent = idx >= 0;
  const next = wasPresent
    ? entries.slice(0, idx).concat(entries.slice(idx + 1))
    : entries.concat([{ blueprintId: id, language: null, quantity: 1, finish: "unknown", addedAt: new Date().toISOString() }]);
  writeEntries(next);
  if (wasPresent) pushDelete(id);
  else pushUpsert(id, { language: null, quantity: 1, finish: "unknown" });
  return new Set(next.map((entry) => entry.blueprintId));
}

/** Aggiunge la carta se assente (con i campi passati, il resto ai default),
 * oppure aggiorna solo i campi passati se gia' presente - MAI rimuove.
 * Usata dallo scanner per registrare la lingua rilevata della copia fisica,
 * e dallo stepper di quantita' nel binder (vedi setBinderQuantity sotto). */
export function upsertBinderEntry(blueprintId: number, patch: Partial<Omit<BinderEntry, "blueprintId">>): BinderEntry[] {
  if (typeof window === "undefined") return [];
  // Se passata, una quantita' fuori intervallo/non intera torna a 1 invece
  // di propagarsi cosi' com'e' fino al server (dove verrebbe comunque
  // rifiutata con 400, mai scartata in silenzio) - un chiamante qui non si
  // aspetta un errore, solo un valore sempre valido.
  const safePatch = "quantity" in patch ? { ...patch, quantity: isValidQuantity(patch.quantity) ? patch.quantity : 1 } : patch;
  const entries = readEntries();
  const idx = entries.findIndex((entry) => entry.blueprintId === blueprintId);
  let next: BinderEntry[];
  if (idx >= 0) {
    next = entries.slice();
    // Filtra le chiavi undefined dalla patch: senza, {...current, ...patch}
    // sovrascriverebbe un valore gia' impostato con undefined per qualunque
    // chiamante futuro che passi un campo non valorizzato invece di
    // ometterlo del tutto - non capita con le chiamate attuali (rilievo
    // review Gemini, difesa preventiva).
    const cleanPatch = Object.fromEntries(Object.entries(safePatch).filter(([, value]) => value !== undefined));
    next[idx] = { ...next[idx], ...cleanPatch };
    writeEntries(next);
    pushUpsert(blueprintId, cleanPatch);
    return next;
  } else {
    const created = {
      blueprintId,
      language: safePatch.language ?? null,
      quantity: safePatch.quantity ?? 1,
      condition: safePatch.condition,
      finish: safePatch.finish ?? "unknown",
      addedAt: new Date().toISOString(),
    };
    next = entries.concat([created]);
    writeEntries(next);
    pushUpsert(blueprintId, { language: created.language, quantity: created.quantity, condition: created.condition, finish: created.finish });
    return next;
  }
}

/** Imposta la quantita' posseduta di una carta gia' nel binder (stepper in
 * CardTile/BinderTable). Chiamare solo su una carta gia' presente - non
 * aggiunge la carta se assente (a differenza di upsertBinderEntry
 * generico), per evitare che uno stepper mostrato per errore su una carta
 * non posseduta la aggiunga al binder come effetto collaterale. */
export function setBinderQuantity(blueprintId: number, quantity: number): BinderEntry[] {
  if (typeof window === "undefined") return [];
  const entries = readEntries();
  if (!entries.some((entry) => entry.blueprintId === blueprintId)) return entries;
  return upsertBinderEntry(blueprintId, { quantity });
}

export function removeBinderEntry(blueprintId: number): BinderEntry[] {
  if (typeof window === "undefined") return [];
  const next = readEntries().filter((entry) => entry.blueprintId !== blueprintId);
  writeEntries(next);
  pushDelete(blueprintId);
  return next;
}

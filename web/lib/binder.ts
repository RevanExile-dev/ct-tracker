"use client";

/** Il "binder personale": le carte che possiedi, salvate solo su questo
 * dispositivo (localStorage). Nessun account, nessun server: se cambi
 * browser o cancelli i dati del sito, la lista si perde. */
const STORAGE_KEY = "ct-tracker:binder";

function readIds(): Set<number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function writeIds(ids: Set<number>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // Storage non disponibile (privacy mode, quota piena...): ignoriamo,
    // il binder semplicemente non viene salvato in questa sessione.
  }
}

export function getBinderIds(): Set<number> {
  if (typeof window === "undefined") return new Set();
  return readIds();
}

export function isInBinder(id: number): boolean {
  return getBinderIds().has(id);
}

export function toggleBinder(id: number): Set<number> {
  const ids = readIds();
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  writeIds(ids);
  return ids;
}

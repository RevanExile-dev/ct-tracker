"use client";

/** Fabbrica per un insieme di id numerici persistito in localStorage sotto
 * una chiave dedicata - stessa logica usata da "il mio binder" e dalla
 * "lista desideri", solo la chiave cambia. */
export function createIdSetStore(storageKey: string) {
  function readIds(): Set<number> {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set();
    }
  }

  function writeIds(ids: Set<number>) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(Array.from(ids)));
    } catch {
      // Storage non disponibile (privacy mode, quota piena...): ignoriamo,
      // la lista semplicemente non viene salvata in questa sessione.
    }
  }

  return {
    getIds(): Set<number> {
      if (typeof window === "undefined") return new Set();
      return readIds();
    },
    has(id: number): boolean {
      if (typeof window === "undefined") return false;
      return readIds().has(id);
    },
    toggle(id: number): Set<number> {
      const ids = readIds();
      if (ids.has(id)) ids.delete(id);
      else ids.add(id);
      writeIds(ids);
      return ids;
    },
  };
}

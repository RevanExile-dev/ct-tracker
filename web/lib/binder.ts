"use client";

/** Il "binder personale": le carte che possiedi, salvate solo su questo
 * dispositivo (localStorage). Nessun account, nessun server: se cambi
 * browser o cancelli i dati del sito, la lista si perde. */
import { createIdSetStore } from "./idSet";

const store = createIdSetStore("ct-tracker:binder");

export function getBinderIds(): Set<number> {
  return store.getIds();
}

export function isInBinder(id: number): boolean {
  return store.has(id);
}

export function toggleBinder(id: number): Set<number> {
  return store.toggle(id);
}

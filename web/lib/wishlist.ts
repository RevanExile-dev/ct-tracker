"use client";

/** La "lista desideri": carte che NON possiedi ancora ma vuoi tenere
 * d'occhio - distinta dal binder (quello che possiedi gia'). Stesso
 * meccanismo del binder (localStorage + sync in background sull'account
 * se loggato, vedi syncWishlistWithServer() e web/lib/binder.ts per il
 * ragionamento completo), solo la chiave/l'endpoint cambiano cosi' le due
 * liste non si mescolano mai per errore. */
import { createIdSetStore } from "./idSet";

const store = createIdSetStore("ct-tracker:wishlist");

let syncEnabled = false;

export function getWishlistIds(): Set<number> {
  return store.getIds();
}

export function isInWishlist(id: number): boolean {
  return store.has(id);
}

export function toggleWishlist(id: number): Set<number> {
  const wasPresent = store.has(id);
  const next = store.toggle(id);
  if (syncEnabled) {
    const req = wasPresent
      ? fetch(`/api/account/wishlist/${id}`, { method: "DELETE" })
      : fetch(`/api/account/wishlist/${id}`, { method: "PUT" });
    // Best-effort, stesso motivo di lib/binder.ts: la modifica locale e'
    // gia' salvata, un fallimento qui non la fa perdere.
    req.catch(() => {});
  }
  return next;
}

/** Da chiamare una sola volta subito dopo il login (vedi AccountSync):
 * unisce la lista desideri locale con quella dell'account (unione, nessun
 * id viene mai scartato), poi allinea entrambi i lati e attiva il push in
 * background per le modifiche successive. */
export async function syncWishlistWithServer(): Promise<void> {
  if (typeof window === "undefined") return;
  let serverIds: number[] = [];
  try {
    const res = await fetch("/api/account/wishlist");
    if (res.ok) serverIds = await res.json();
  } catch {
    // Offline o errore di rete: procede solo con i dati locali.
  }
  const local = store.getIds();
  for (const id of serverIds) {
    if (!local.has(id)) store.toggle(id);
  }
  syncEnabled = true;
  const merged = Array.from(store.getIds());
  if (merged.length) {
    fetch("/api/account/wishlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(merged),
    }).catch(() => {});
  }
}

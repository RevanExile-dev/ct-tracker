"use client";

/** La "lista desideri": carte che NON possiedi ancora ma vuoi tenere
 * d'occhio - distinta dal binder (quello che possiedi gia'). Stesso
 * meccanismo del binder (solo localStorage, chiave separata), cosi' le due
 * liste non si mescolano mai per errore. */
import { createIdSetStore } from "./idSet";

const store = createIdSetStore("ct-tracker:wishlist");

export function getWishlistIds(): Set<number> {
  return store.getIds();
}

export function isInWishlist(id: number): boolean {
  return store.has(id);
}

export function toggleWishlist(id: number): Set<number> {
  return store.toggle(id);
}

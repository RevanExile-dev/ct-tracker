"use client";

import { useEffect, useState } from "react";
import { getBinderIds } from "./binder";
import { getWishlistIds } from "./wishlist";

/** Carica gli ID salvati in binder/wishlist al mount, deferendo lo setState a
 * un requestAnimationFrame (mai sincrono nel corpo dell'effetto - regola di
 * lint del progetto, react-hooks/set-state-in-effect). Centralizza un
 * pattern ripetuto identico in piu' pagine (catalogo, carte in movimento). */
export function useBinderWishlistIds() {
  const [binderIds, setBinderIds] = useState<Set<number>>(() => new Set());
  const [wishlistIds, setWishlistIds] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setBinderIds(getBinderIds());
      setWishlistIds(getWishlistIds());
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return { binderIds, setBinderIds, wishlistIds, setWishlistIds };
}

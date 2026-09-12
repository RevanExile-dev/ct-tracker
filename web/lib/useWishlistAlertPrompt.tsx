"use client";

import { useCallback, useState } from "react";
import { useSession } from "next-auth/react";
import type { CardRow } from "./types";
import { toggleWishlist } from "./wishlist";
import QuickAlertModal from "@/components/QuickAlertModal";
import LoginToTrackToast from "@/components/LoginToTrackToast";

const TOAST_MS = 5000;

/** Centralizza il comportamento "cuore -> overlay traccia carta" condiviso
 * da tutte le griglie (home, movers) e dalla pagina di dettaglio: chiama
 * promptWishlistToggle() al posto di toggleWishlist() diretto, poi renderizza
 * {overlay} una volta nella pagina. Interviene SOLO quando la carta viene
 * AGGIUNTA ai desideri (wasInWishlist=false) - una rimozione (es. dalla
 * pagina /wishlist stessa) resta un toggle semplice, mai un'occasione per
 * proporre un allarme. */
export function useWishlistAlertPrompt() {
  const { data: session } = useSession();
  const [promptCard, setPromptCard] = useState<CardRow | null>(null);
  const [showToast, setShowToast] = useState(false);

  const promptWishlistToggle = useCallback((card: CardRow, wasInWishlist: boolean): Set<number> => {
    const next = toggleWishlist(card.id);
    const added = !wasInWishlist;
    if (added) {
      if (session) {
        setPromptCard(card);
      } else {
        setShowToast(true);
        window.setTimeout(() => setShowToast(false), TOAST_MS);
      }
    }
    return next;
  }, [session]);

  const overlay = (
    <>
      {promptCard && <QuickAlertModal card={promptCard} onClose={() => setPromptCard(null)} />}
      {showToast && <LoginToTrackToast onDismiss={() => setShowToast(false)} />}
    </>
  );

  return { promptWishlistToggle, overlay };
}

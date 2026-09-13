"use client";

import { useCallback, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import type { CardRow } from "./types";
import { toggleBinder } from "./binder";
import LogPurchaseModal from "@/components/LogPurchaseModal";
import LoginToTrackToast from "@/components/LoginToTrackToast";

const TOAST_MS = 5000;

/** Centralizza il comportamento "stella -> overlay dettagli acquisto",
 * stesso pattern di useWishlistAlertPrompt.tsx ma per il binder: chiama
 * promptBinderToggle() al posto di toggleBinder() diretto nelle griglie
 * condivise (home, movers) e nella pagina di dettaglio, poi renderizza
 * {overlay} una volta nella pagina. Interviene SOLO quando la carta viene
 * AGGIUNTA al binder (wasInBinder=false) - una rimozione resta un toggle
 * semplice. I lotti (binder_lots) sono solo-account (vedi web/lib/types.ts),
 * quindi da sloggati si mostra un toast che invita al login invece
 * dell'overlay, che fallirebbe con 401. */
export function useBinderPurchasePrompt() {
  const { data: session } = useSession();
  const [promptCard, setPromptCard] = useState<CardRow | null>(null);
  const [showToast, setShowToast] = useState(false);
  const toastTimerRef = useRef<number | null>(null);

  const promptBinderToggle = useCallback((card: CardRow, wasInBinder: boolean): Set<number> => {
    const next = toggleBinder(card.id);
    const added = !wasInBinder;
    if (added) {
      if (session) {
        setPromptCard(card);
      } else {
        if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
        setShowToast(true);
        toastTimerRef.current = window.setTimeout(() => setShowToast(false), TOAST_MS);
      }
    }
    return next;
  }, [session]);

  const overlay = (
    <>
      {promptCard && <LogPurchaseModal card={promptCard} onClose={() => setPromptCard(null)} />}
      {showToast && (
        <LoginToTrackToast
          message="Accedi per registrare prezzo di acquisto e provenienza delle tue carte."
          onDismiss={() => setShowToast(false)}
        />
      )}
    </>
  );

  return { promptBinderToggle, overlay };
}

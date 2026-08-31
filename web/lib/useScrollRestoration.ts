"use client";

import { useCallback, useEffect, useRef } from "react";

/** Conserva lo scroll solo per una navigazione di ritorno alla stessa URL. */
export function useScrollRestoration(scope: string, ready: boolean, currentUrl: string) {
  // Confronta l'URL per cui abbiamo GIA' tentato un ripristino in questo
  // giro, non un semplice "fatto/non fatto" booleano: "indietro" nel
  // browser aggiorna comunque pathname/searchParams (quindi currentUrl)
  // anche quando Next.js riusa lo stesso componente dalla Router Cache
  // invece di rimontarlo - un booleano che si blocca su true al primo
  // caricamento impedirebbe per sempre ogni ripristino successivo, un
  // ref per-URL invece lo permette ogni volta che si torna su un URL
  // diverso da quello appena controllato (bug reale, verificato).
  const lastRestoredUrl = useRef<string | null>(null);

  const restoreFor = useCallback((url: string) => {
    try {
      const raw = sessionStorage.getItem(`carta-viva:scroll:${scope}`);
      if (!raw) return;
      const saved = JSON.parse(raw) as { url?: string; y?: number };
      if (saved.url === url && typeof saved.y === "number") {
        requestAnimationFrame(() => window.scrollTo({ top: saved.y, behavior: "instant" }));
      }
    } catch {
      // Uno storage disabilitato non deve bloccare la navigazione.
    }
  }, [scope]);

  useEffect(() => {
    if (!ready || lastRestoredUrl.current === currentUrl) return;
    lastRestoredUrl.current = currentUrl;
    restoreFor(currentUrl);
  }, [ready, currentUrl, restoreFor]);

  useEffect(() => {
    // Diventa true nell'istante in cui rileviamo un click che portera' via
    // da questa pagina (quindi una navigazione client-side sta per
    // partire) - da li' in poi ignoriamo altri eventi "scroll", perche'
    // Next.js riporta lo scroll a 0 PRIMA di smontare questo componente e
    // quello scroll-reset genera a sua volta un evento "scroll" nativo:
    // senza questa guardia il listener qui sotto lo catturerebbe e
    // sovrascriverebbe la posizione buona con 0 un istante dopo averla
    // salvata correttamente (bug reale, verificato).
    let leaving = false;
    let leavingResetTimer: ReturnType<typeof setTimeout> | null = null;
    function save() {
      if (leaving) return;
      try {
        sessionStorage.setItem(`carta-viva:scroll:${scope}`, JSON.stringify({
          url: currentUrl,
          y: window.scrollY,
        }));
      } catch {}
    }
    // Salva la posizione MENTRE si scrolla (throttle via rAF): un semplice
    // "salva quando lasci la pagina" arriva sempre troppo tardi per lo
    // stesso motivo (lo scroll e' gia' stato azzerato dal router).
    let frame: number | null = null;
    function onScroll() {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        save();
      });
    }
    // Fase di cattura: gira PRIMA che React/Next gestiscano il click sul
    // link, quindi window.scrollY qui e' ancora la posizione reale
    // dell'utente, non quella gia' azzerata dalla navigazione in corso.
    function onLinkClickCapture(event: MouseEvent) {
      // Un click che apre in una nuova scheda (Ctrl/Cmd/Shift/tasto
      // centrale, o un link con target="_blank") NON lascia questa
      // pagina: se marcassimo "leaving" anche qui, ogni scroll successivo
      // dell'utente su QUESTA pagina resterebbe silenziosamente ignorato
      // per il resto della sessione del componente (bug reale trovato in
      // review, prima di finire in produzione).
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest("a");
      if (!link || link.target === "_blank") return;
      leaving = true;
      save();
      // Rete di sicurezza: se per qualunque motivo il click non porta
      // davvero a una navigazione (link "#", preventDefault altrove,
      // ecc.) non deve restare bloccato per sempre - la pagina non sarebbe
      // comunque cambiata entro un secondo da un click che naviga davvero.
      if (leavingResetTimer !== null) clearTimeout(leavingResetTimer);
      leavingResetTimer = setTimeout(() => { leaving = false; }, 1000);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("click", onLinkClickCapture, true);
    window.addEventListener("pagehide", save);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      if (leavingResetTimer !== null) clearTimeout(leavingResetTimer);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("click", onLinkClickCapture, true);
      window.removeEventListener("pagehide", save);
    };
  }, [scope, currentUrl]);
}

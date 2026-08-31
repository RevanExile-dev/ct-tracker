"use client";

import { useCallback, useEffect, useRef } from "react";

/** Conserva lo scroll solo per una navigazione di ritorno alla stessa URL. */
export function useScrollRestoration(scope: string, ready: boolean, currentUrl: string) {
  const restored = useRef(false);

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
    if (!ready || restored.current) return;
    restored.current = true;
    restoreFor(currentUrl);
  }, [ready, currentUrl, restoreFor]);

  // Il tasto "indietro" del browser passa dalla Router Cache di Next.js: se
  // la pagina precedente e' gia' in cache, React NON smonta/rimonta questo
  // componente (stesso fiber, stessi ref) - l'effetto sopra semplicemente
  // non riparte perche' nessuna delle sue dipendenze e' davvero cambiata,
  // quindi il ref "restored" resta bloccato su true dal primo caricamento e
  // il ripristino non scatta mai. "popstate" invece e' un evento del
  // browser vero e proprio, garantito ad ogni indietro/avanti a prescindere
  // da cosa fa la Router Cache - usiamo quello come innesco esplicito,
  // indipendente dal ciclo di vita del componente.
  useEffect(() => {
    function onPopState() {
      restoreFor(window.location.pathname + window.location.search);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [restoreFor]);

  useEffect(() => {
    // Diventa true nell'istante in cui rileviamo un click su un link (quindi
    // una navigazione client-side sta per partire) - da li' in poi ignoriamo
    // altri eventi "scroll", perche' Next.js riporta lo scroll a 0 PRIMA di
    // smontare questo componente e quello scroll-reset genera a sua volta
    // un evento "scroll" nativo: senza questa guardia il listener qui sotto
    // lo catturerebbe e sovrascriverebbe la posizione buona con 0 un istante
    // dopo averla salvata correttamente (bug reale, verificato).
    let leaving = false;
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
      if ((event.target as Element | null)?.closest("a")) {
        leaving = true;
        save();
      }
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("click", onLinkClickCapture, true);
    window.addEventListener("pagehide", save);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("click", onLinkClickCapture, true);
      window.removeEventListener("pagehide", save);
    };
  }, [scope, currentUrl]);
}

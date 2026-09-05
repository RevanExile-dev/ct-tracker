"use client";

import { useEffect, useRef, useState } from "react";

/**
 * true = da mostrare, false = da nascondere. Pensato per una barra
 * sticky: su desktop viene nascosta scrollando verso il basso oltre una
 * piccola soglia e mostrata di nuovo scrollando verso l'alto o tornando
 * vicino alla cima della pagina.
 *
 * Su telefono uno swipe verticale NON deve decidere lo stato della barra:
 * dopo un'interazione touch lo scroll (compresa l'inerzia) viene ignorato
 * e i filtri restano esattamente come l'utente li ha lasciati. La maniglia
 * manuale resta l'unico gesto che apre/chiude la toolbar durante l'uso
 * touch. `setVisible` e' esposto proprio per quel toggle manuale.
 *
 * containerRef (opzionale): se l'utente ha il focus dentro il
 * contenitore (es. sta scrivendo nella ricerca), lo scroll non lo
 * nasconde - non ha senso far sparire un controllo che si sta usando
 * attivamente.
 *
 * keepVisible (opzionale): stessa idea ma basata su stato applicativo
 * invece che sul focus DOM - necessaria perche' il solo controllo di
 * focus ha due buchi reali, entrambi trovati riproducendo il bug
 * ("i filtri si buggavano" segnalato su iOS e desktop): (1) un pannello
 * filtro renderizzato in portale su document.body (per il modale
 * mobile) non e' un discendente di containerRef, quindi il controllo di
 * focus non lo vede mai come "in uso"; (2) Safari (sia macOS sia iOS) non
 * assegna il focus a un <button> al click/tap, quindi anche il pannello
 * desktop ancorato al trigger risultava "senza focus dentro" pur essendo
 * visibilmente aperto. In entrambi i casi lo scroll comprimeva la barra
 * (grid-template-rows a 0), portando con se' il popover ancorato che
 * spariva a meta' consultazione. Passare qui lo stato "e' aperto un
 * filtro" gia' tracciato dal chiamante evita di dover indovinare dal DOM.
 *
 * Confronta lo scroll corrente con un "ancora" (l'ultima posizione in cui
 * la direzione e' stata confermata), non con l'evento immediatamente
 * precedente: un vero gesto di scroll genera tanti eventi piccoli e
 * rumorosi, spesso con qualche inversione di segno dovuta all'inerzia.
 */
export function useHideOnScrollDown(
  containerRef?: React.RefObject<HTMLElement | null>,
  revealThresholdPx = 80,
  directionThresholdPx = 24,
  keepVisible = false
) {
  const [visible, setVisible] = useState(true);
  const anchorY = useRef(0);
  const ticking = useRef(false);
  const keepVisibleRef = useRef(keepVisible);
  const lastTouchScrollAt = useRef(0);

  useEffect(() => {
    keepVisibleRef.current = keepVisible;
  }, [keepVisible]);

  // Forza la barra visibile appena keepVisible passa a true (es. un
  // filtro si e' appena aperto) - non aspetta il prossimo evento scroll.
  useEffect(() => {
    if (!keepVisible) return;
    const raf = requestAnimationFrame(() => setVisible(true));
    anchorY.current = window.scrollY;
    return () => cancelAnimationFrame(raf);
  }, [keepVisible]);

  // La maniglia originale e' volutamente minimale su desktop. Su mobile
  // aumentiamo area touch e contrasto senza introdurre un secondo controllo:
  // resta lo stesso button/aria-label gia' usato dalla pagina.
  useEffect(() => {
    const root = containerRef?.current;
    if (!root || root.dataset.testid !== "toolbar-collapse") return;
    const handle = root.querySelector<HTMLButtonElement>(":scope > button[aria-expanded]");
    const arrow = handle?.querySelector<HTMLElement>("span[aria-hidden]");
    if (!handle) return;

    const media = window.matchMedia("(max-width: 639px)");
    const apply = () => {
      if (media.matches) {
        handle.style.minHeight = "38px";
        handle.style.marginBottom = "6px";
        handle.style.border = "1px solid rgba(255,255,255,0.13)";
        handle.style.borderRadius = "9999px";
        handle.style.background = "rgba(255,255,255,0.055)";
        handle.style.boxShadow = "0 8px 24px rgba(0,0,0,0.18)";
        if (arrow) {
          arrow.style.fontSize = "14px";
          arrow.style.opacity = "0.95";
        }
      } else {
        handle.style.removeProperty("min-height");
        handle.style.removeProperty("margin-bottom");
        handle.style.removeProperty("border");
        handle.style.removeProperty("border-radius");
        handle.style.removeProperty("background");
        handle.style.removeProperty("box-shadow");
        arrow?.style.removeProperty("font-size");
        arrow?.style.removeProperty("opacity");
      }
    };

    apply();
    media.addEventListener("change", apply);
    return () => {
      media.removeEventListener("change", apply);
      handle.style.removeProperty("min-height");
      handle.style.removeProperty("margin-bottom");
      handle.style.removeProperty("border");
      handle.style.removeProperty("border-radius");
      handle.style.removeProperty("background");
      handle.style.removeProperty("box-shadow");
      arrow?.style.removeProperty("font-size");
      arrow?.style.removeProperty("opacity");
    };
  }, [containerRef]);

  useEffect(() => {
    anchorY.current = window.scrollY;

    function markTouchScroll() {
      lastTouchScrollAt.current = performance.now();
    }

    function onScroll() {
      if (ticking.current) return;
      ticking.current = true;
      requestAnimationFrame(() => {
        ticking.current = false;
        const y = window.scrollY;
        const mobile = window.matchMedia("(max-width: 639px)").matches;
        const now = performance.now();

        // Se lo scroll e' nato da un gesto touch su telefono, non modifica
        // mai visible. Ogni evento di inerzia rinnova la finestra, quindi
        // la toolbar non puo' riapparire a meta' dello stesso swipe.
        if (mobile && now - lastTouchScrollAt.current < 1200) {
          lastTouchScrollAt.current = now;
          anchorY.current = y;
          return;
        }

        if (y < revealThresholdPx) {
          setVisible(true);
          anchorY.current = y;
          return;
        }
        if (keepVisibleRef.current) {
          anchorY.current = y;
          return;
        }
        if (containerRef?.current?.contains(document.activeElement)) return;

        const delta = y - anchorY.current;
        if (delta > directionThresholdPx) {
          setVisible(false);
          anchorY.current = y;
        } else if (delta < -directionThresholdPx) {
          setVisible(true);
          anchorY.current = y;
        }
      });
    }

    window.addEventListener("touchstart", markTouchScroll, { passive: true });
    window.addEventListener("touchmove", markTouchScroll, { passive: true });
    window.addEventListener("touchend", markTouchScroll, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("touchstart", markTouchScroll);
      window.removeEventListener("touchmove", markTouchScroll);
      window.removeEventListener("touchend", markTouchScroll);
      window.removeEventListener("scroll", onScroll);
    };
  }, [containerRef, revealThresholdPx, directionThresholdPx]);

  return [visible, setVisible] as const;
}

"use client";

import { useEffect, useRef, useState } from "react";

/**
 * true = da mostrare, false = da nascondere. Pensato per una barra
 * sticky: su desktop viene nascosta scrollando verso il basso oltre una
 * piccola soglia e mostrata di nuovo scrollando verso l'alto o tornando
 * vicino alla cima della pagina.
 *
 * Su telefono, appena viene rilevata un'interazione touch, la toolbar passa
 * in modalita' manuale per il resto della pagina: lo scroll non modifica
 * piu' lo stato. Chiusa resta chiusa, aperta resta aperta, e solo la
 * maniglia decide. Questo evita che un normale swipe faccia riapparire i
 * filtri mentre si stanno consultando le carte.
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
 * Anti-oscillazione (bug reale "il sito vibra in fondo", riprodotto in
 * produzione con rotella reale: scrollY alternava ~6571/6610 all'infinito,
 * senza input, 12 volte al secondo): nascondere la barra accorcia il
 * documento; se si e' vicini al fondo, il browser riporta scrollY indietro
 * ("clamp"), il hook lo legge come "l'utente sale", rimostra la barra, il
 * documento si riallunga, e cosi' via. Due difese complementari: (1) uno
 * scroll all'indietro che finisce esattamente sul fondo scorrevole non e' un
 * gesto dell'utente, solo un aggiustamento del layout (documento accorciato): si aggiorna
 * l'ancora e basta; (2) non si nasconde la barra quando la distanza dal fondo
 * e' minore dello spazio che la barra libererebbe (nessun clamp = nessun
 * salto di contenuto).
 *
 * Confronta lo scroll corrente con un "ancora" (l'ultima posizione in cui
 * la direzione e' stata confermata), non con l'evento immediatamente
 * precedente: un vero gesto di scroll desktop genera tanti eventi piccoli
 * e rumorosi, spesso con qualche inversione di segno dovuta all'inerzia.
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
  const touchManualModeRef = useRef(false);

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
    let lastY = window.scrollY;

    function enterTouchManualMode() {
      if (window.matchMedia("(max-width: 639px)").matches) {
        touchManualModeRef.current = true;
        anchorY.current = window.scrollY;
      }
    }

    function onScroll() {
      if (ticking.current) return;
      ticking.current = true;
      requestAnimationFrame(() => {
        ticking.current = false;
        const y = window.scrollY;
        const docHeight = document.documentElement.scrollHeight;
        const prevY = lastY;
        lastY = y;
        const mobile = window.matchMedia("(max-width: 639px)").matches;

        // Dopo il primo tocco su mobile, lo scroll non ha piu' autorita'
        // sullo stato dei filtri. Aggiorniamo solo l'ancora cosi' un
        // eventuale resize verso desktop riparte senza salti.
        if (mobile && touchManualModeRef.current) {
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

        // scrollY arretrato e fermo esattamente sul fondo scorrevole: e' il
        // browser che rientra nei nuovi limiti dopo che il documento si e'
        // accorciato (o il rimbalzo di iOS oltre il fondo), non l'utente che
        // sale - uno scroll verso l'alto vero si ferma sopra il fondo.
        // Niente confronto con l'altezza precedente: il documento puo'
        // accorciarsi senza alcun evento scroll in mezzo.
        if (y < prevY && y >= docHeight - window.innerHeight - 1) {
          anchorY.current = y;
          return;
        }

        const delta = y - anchorY.current;
        if (delta > directionThresholdPx) {
          // Vicino al fondo nascondere la barra accorcerebbe il documento
          // sotto i piedi dell'utente: resta com'e'.
          const barHeight = containerRef?.current?.getBoundingClientRect().height ?? 0;
          const distanceToBottom = docHeight - (y + window.innerHeight);
          if (distanceToBottom < barHeight) return;
          setVisible(false);
          anchorY.current = y;
        } else if (delta < -directionThresholdPx) {
          setVisible(true);
          anchorY.current = y;
        }
      });
    }

    window.addEventListener("touchstart", enterTouchManualMode, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("touchstart", enterTouchManualMode);
      window.removeEventListener("scroll", onScroll);
    };
  }, [containerRef, revealThresholdPx, directionThresholdPx]);

  return [visible, setVisible] as const;
}

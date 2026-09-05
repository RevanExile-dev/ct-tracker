"use client";

import { useEffect, useRef, useState } from "react";

/**
 * true = da mostrare, false = da nascondere. Pensato per una barra
 * sticky: su desktop viene nascosta scrollando verso il basso oltre una
 * piccola soglia e mostrata di nuovo scrollando verso l'alto o tornando
 * vicino alla cima della pagina.
 *
 * Su mobile (< 640px) lo scroll NON modifica mai lo stato: la barra resta
 * esattamente come l'utente l'ha lasciata e si apre/chiude solo tramite la
 * maniglia manuale. Evita il comportamento fastidioso in cui un normale
 * gesto verticale faceva riapparire i filtri mentre si consultavano le
 * carte. `setVisible` resta esposto per il toggle manuale.
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
 * spariva a meta' consultazione - non un difetto visivo minore, il
 * pannello diventava introvabile. Passare qui lo stato "e' aperto un
 * filtro" gia' tracciato dal chiamante evita di dover indovinare dal DOM.
 *
 * Confronta lo scroll corrente con un "ancora" (l'ultima posizione in cui
 * la direzione e' stata confermata), non con l'evento immediatamente
 * precedente: un vero gesto di scroll (touch/trackpad, anche simulato da
 * Playwright con mouse.wheel) genera tanti eventi con delta piccoli e
 * rumorosi, spesso con qualche inversione di segno dovuta a inerzia/
 * decelerazione - confrontare frame per frame faceva sfarfallare lo stato
 * a meta' della transizione (bug reale, osservato: l'altezza restava a un
 * valore intermedio invece di assestarsi). Serve un movimento NETTO
 * (soglia) dall'ultima posizione confermata prima di cambiare stato.
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

  useEffect(() => {
    keepVisibleRef.current = keepVisible;
  }, [keepVisible]);

  // Forza la barra visibile appena keepVisible passa a true (es. un
  // filtro si e' appena aperto) - non aspetta il prossimo evento scroll,
  // altrimenti resterebbe nascosta finche' l'utente non scrolla verso
  // l'alto per conto suo.
  useEffect(() => {
    if (!keepVisible) return;
    const raf = requestAnimationFrame(() => setVisible(true));
    anchorY.current = window.scrollY;
    return () => cancelAnimationFrame(raf);
  }, [keepVisible]);

  useEffect(() => {
    anchorY.current = window.scrollY;
    function onScroll() {
      if (ticking.current) return;
      ticking.current = true;
      requestAnimationFrame(() => {
        ticking.current = false;
        const y = window.scrollY;

        // Mobile: manual-only. Uno swipe verticale non deve mai decidere se
        // mostrare o nascondere i filtri. Aggiorniamo soltanto l'ancora per
        // evitare salti se il viewport passa poi a desktop (rotazione/
        // resize), lasciando intatto lo stato scelto dalla maniglia.
        if (window.matchMedia("(max-width: 639px)").matches) {
          anchorY.current = y;
          return;
        }

        if (y < revealThresholdPx) {
          setVisible(true);
          anchorY.current = y;
          return;
        }
        if (keepVisibleRef.current) {
          // Ancora aggiornata anche mentre e' "tenuta" visibile, cosi'
          // quando keepVisible torna false non scatta un salto di stato
          // dovuto a un'ancora ormai vecchia.
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
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [containerRef, revealThresholdPx, directionThresholdPx]);

  return [visible, setVisible] as const;
}

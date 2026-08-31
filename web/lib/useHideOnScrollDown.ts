"use client";

import { useEffect, useRef, useState } from "react";

/**
 * true = da mostrare, false = da nascondere. Pensato per una barra
 * sticky: nascosta scrollando verso il basso oltre una piccola soglia
 * (per non sparire al minimo tremolio), mostrata di nuovo scrollando
 * verso l'alto o tornando vicino alla cima della pagina. `setVisible`
 * e' esposto cosi' un tap manuale (es. una maniglia per aprire/chiudere)
 * puo' sovrascrivere lo stato in qualunque momento - resta comunque lo
 * stesso stato che lo scroll verso l'alto rimette a `true`, come nel caso
 * automatico.
 *
 * containerRef (opzionale): se l'utente ha il focus dentro il
 * contenitore (es. sta scrivendo nella ricerca, o un pannello filtro e'
 * aperto), lo scroll non lo nasconde - non ha senso far sparire un
 * controllo che si sta usando attivamente.
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
  directionThresholdPx = 24
) {
  const [visible, setVisible] = useState(true);
  const anchorY = useRef(0);
  const ticking = useRef(false);

  useEffect(() => {
    anchorY.current = window.scrollY;
    function onScroll() {
      if (ticking.current) return;
      ticking.current = true;
      requestAnimationFrame(() => {
        ticking.current = false;
        const y = window.scrollY;

        if (y < revealThresholdPx) {
          setVisible(true);
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

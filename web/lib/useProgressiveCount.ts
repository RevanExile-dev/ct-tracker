"use client";

import { useEffect, useState } from "react";

/**
 * Quanti elementi di una lista lunga montare ORA: parte da `initial` e ne
 * aggiunge `step` per volta, uno scaglione per frame, finche' non arriva a
 * `total`. Il risultato finale e' identico a montarli tutti insieme (stessi
 * elementi, stesso ordine): cambia solo che il lavoro del browser per
 * costruire 60-90 tile viene spezzato in pezzi piccoli invece di un unico
 * blocco lungo, durante il quale la pagina non risponde ai tocchi (sul
 * telefono, con CPU lenta, era il grosso del "blocco" misurato da Lighthouse).
 *
 * Il conteggio non scende mai da solo quando `total` cala (filtri che
 * restringono i risultati): chi lo usa fa Math.min(count, lista.length).
 * Quando `total` cresce ("Mostra altre") riparte da quanto gia' montato,
 * senza ridisegnare le tile gia' presenti.
 *
 * `done` e' true quando tutto quello che c'e' e' stato montato: serve a chi
 * deve aspettare la pagina completa (es. il ripristino dello scroll).
 */
export function useProgressiveCount(total: number, initial: number, step: number) {
  const [count, setCount] = useState(initial);

  useEffect(() => {
    if (count >= total) return;
    // Un frame di pausa tra uno scaglione e il successivo: il browser puo'
    // disegnare e rispondere ai tocchi prima che parta il pezzo seguente.
    const frame = requestAnimationFrame(() => setCount((c) => Math.min(c + step, total)));
    return () => cancelAnimationFrame(frame);
  }, [count, total, step]);

  return { count: Math.min(count, total), done: count >= total };
}

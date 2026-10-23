"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

const STORAGE_KEY = "cartaviva:home-filters-open";

// Valore della sessione quando lo storage non e' disponibile: la scelta vale
// comunque finche' la pagina resta aperta.
let memoryOpen = true;
const listeners = new Set<() => void>();

function readOpen(): boolean {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "0") return false;
    if (stored === "1") return true;
  } catch {
    // storage bloccato (navigazione privata, cookie off)
  }
  return memoryOpen;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener); // altra scheda dello stesso sito
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/**
 * Apertura della barra ricerca/filtri della home: decide solo l'utente, col
 * tasto. Nessun legame con lo scroll (prima lo scroll la nascondeva e la
 * riapriva da solo, e chi la chiudeva a mano se la ritrovava riaperta).
 *
 * Aperta di default (prima visita, valore sconosciuto, storage non
 * disponibile). L'ultima scelta e' ricordata sul dispositivo con un solo
 * valore in localStorage ("0" chiusa, "1" aperta). Il server e la prima
 * idratazione usano "aperta" (getServerSnapshot), poi React legge il valore
 * vero: nessuna discrepanza HTML. `ready` diventa true solo dopo l'idratazione
 * e serve a non animare la chiusura iniziale di chi l'aveva lasciata chiusa.
 * Nessuna cache, nessun service worker.
 */
export function useFiltersBarOpen() {
  const open = useSyncExternalStore(subscribe, readOpen, () => true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const setOpen = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    const value = typeof next === "function" ? next(readOpen()) : next;
    memoryOpen = value;
    try {
      window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
    } catch {
      // non salvabile: vale solo per questa visita (memoryOpen)
    }
    listeners.forEach((l) => l());
  }, []);

  return [open, setOpen, ready] as const;
}

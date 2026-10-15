"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/** Registra il service worker (solo in produzione) e mostra un avviso
 * quando i dati che si vedono non sono freschi: telefono senza rete, oppure
 * dati serviti dalla copia salvata perche' la rete era lenta. Cosi' i prezzi
 * salvati non passano mai per prezzi attuali senza dirlo. */
export default function OfflineSupport() {
  const offline = useSyncExternalStore(subscribeOnline, () => !navigator.onLine, () => false);
  const [staleDate, setStaleDate] = useState<string | null>(null);

  useEffect(() => {
    let onMessage: ((e: MessageEvent) => void) | null = null;
    if ("serviceWorker" in navigator) {
      onMessage = (e: MessageEvent) => {
        if (e.data?.type === "stale-data") setStaleDate(e.data.date ?? "");
      };
      navigator.serviceWorker.addEventListener("message", onMessage);
      if (process.env.NODE_ENV === "production") {
        navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
      }
    }
    return () => {
      if (onMessage) navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, []);

  if (!offline && staleDate === null) return null;

  let when = "";
  if (staleDate) {
    const d = new Date(staleDate);
    if (!Number.isNaN(d.getTime())) {
      when = ` del ${d.toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
    }
  }
  const text = offline
    ? `Sei offline: vedi i dati salvati${when}. I prezzi possono essere cambiati.`
    : `Rete lenta: mostro i dati salvati${when}. I prezzi possono essere cambiati.`;

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-amber-400/40 bg-amber-950/95 px-4 py-2 text-center text-sm text-amber-100"
    >
      {text}
      {!offline && (
        <button type="button" className="ml-3 underline" onClick={() => setStaleDate(null)}>
          Chiudi
        </button>
      )}
    </div>
  );
}

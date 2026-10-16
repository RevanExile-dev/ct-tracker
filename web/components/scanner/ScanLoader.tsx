"use client";

import { useEffect, useState } from "react";
import styles from "@/app/scan/Scanner.module.css";
import type { ScanStatus } from "@/lib/scanner/types";

// Messaggio onesto sul tempo: non c'e' una percentuale vera (le letture si
// fermano appena trovano nome e numero, quindi la durata non e' prevedibile),
// ma le fasi sono vere e il testo dice quando la carta e' difficile da leggere.
export function loaderMessage(status: ScanStatus, seconds: number): { title: string; hint: string } {
  if (status === "queued") return { title: "In coda…", hint: "Parte appena ha finito la carta precedente." };
  if (status === "matching") return { title: "Cerco la carta nel catalogo…", hint: "La confronto con nome, numero e immagine." };
  if (seconds < 5) return { title: "Leggo nome e numero…", hint: "Di solito bastano pochi secondi." };
  if (seconds < 12) return { title: "Sto leggendo con più attenzione…", hint: "Ancora qualche secondo." };
  return {
    title: "Carta difficile da leggere, ci vuole un po'",
    hint: "Provo altre letture, può servire anche mezzo minuto. Non chiudere la pagina.",
  };
}

const STEPS = [
  { key: "reading", label: "Lettura" },
  { key: "matching", label: "Catalogo" },
] as const;

/** Barra di caricamento con una pokeball che rotola (CSS puro, nessuna immagine protetta). */
export default function ScanLoader({ status }: { status: ScanStatus }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const { title, hint } = loaderMessage(status, seconds);
  const activeIndex = status === "matching" ? 1 : 0;

  return (
    <div className="mt-5" data-scan-loader={status}>
      <div role="status" aria-live="polite">
        <h3 className="font-display text-xl font-semibold">{title}</h3>
        <p className="text-sm text-ink-muted mt-2">{hint}</p>
      </div>

      <div className={`${styles.ballTrack} mt-5`} aria-hidden="true">
        <div className={styles.ballRail} />
        <div className={styles.ballRunner}>
          <div className={styles.ball}>
            <span className={styles.ballButton} />
          </div>
        </div>
      </div>

      <ol className="mt-3 flex items-center gap-2 text-[11px] font-mono text-ink-faint" aria-label="Fasi della ricerca">
        {STEPS.map((step, index) => (
          <li key={step.key} className="flex items-center gap-2" aria-current={index === activeIndex ? "step" : undefined}>
            <span className={`${styles.stepDot} ${index < activeIndex ? styles.stepDone : index === activeIndex ? styles.stepActive : ""}`} />
            <span className={index === activeIndex ? "text-accent-bright" : index < activeIndex ? "text-ink-muted" : ""}>{step.label}</span>
            {index < STEPS.length - 1 && <span className="w-6 h-px bg-base-border" />}
          </li>
        ))}
      </ol>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

/** Pulsante flottante "torna su", compare solo dopo aver scrollato un po' —
 * utile sulla griglia principale e su "carte in movimento", che possono
 * allungarsi parecchio con "mostra altre carte". */
export default function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function handleScroll() {
      setVisible(window.scrollY > 800);
    }
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <button
      onClick={() => {
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
      }}
      aria-label="Torna all'inizio"
      className={`btn-lift fixed bottom-5 right-5 z-30 w-11 h-11 rounded-full border border-base-border bg-base-surface/90 backdrop-blur-sm text-ink-muted hover:text-accent-bright hover:border-accent/60 shadow-card flex items-center justify-center transition-[opacity,transform] duration-300 active:scale-90 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3 pointer-events-none"
      }`}
    >
      ↑
    </button>
  );
}

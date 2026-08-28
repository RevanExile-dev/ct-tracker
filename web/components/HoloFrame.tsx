"use client";

import { useRef } from "react";

/**
 * Contenitore che applica l'effetto "lamina olografica": un bordo sfumato
 * ciano→magenta→ambra e un riflesso che seguono il puntatore, come una
 * vera carta foil inclinata sotto la luce. Attivo solo su hover/focus,
 * disattivato se l'utente preferisce animazioni ridotte (gestito in CSS).
 */
export default function HoloFrame({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  function handleMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    el.style.setProperty("--mx", `${x}%`);
    el.style.setProperty("--my", `${y}%`);
    el.style.setProperty("--holo-angle", `${115 + (x - 50) * 0.6}deg`);
  }

  return (
    <div
      ref={ref}
      onMouseMove={handleMove}
      className={`holo-frame rounded-card ${className}`}
    >
      {children}
    </div>
  );
}

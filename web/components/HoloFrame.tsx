"use client";

import { useRef } from "react";

const MAX_TILT_DEG = 8;

/**
 * Contenitore che applica l'effetto "lamina olografica": un bordo sfumato
 * ciano→magenta→ambra, un riflesso che segue il puntatore, e una leggera
 * inclinazione 3D della carta verso il cursore — come si inclinerebbe una
 * vera carta foil in mano per farla brillare. Attivo solo su hover/focus,
 * disattivato se l'utente preferisce animazioni ridotte.
 *
 * liftOnHover: aggiunge un piccolo sollevamento (traslazione verso l'alto)
 * insieme all'inclinazione — usato nella griglia (CardTile) al posto della
 * classe Tailwind group-hover:-translate-y-1, che verrebbe sovrascritta
 * dal transform inline calcolato qui durante l'hover.
 */
export default function HoloFrame({
  children,
  className = "",
  liftOnHover = false,
}: {
  children: React.ReactNode;
  className?: string;
  liftOnHover?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reducedMotion = useRef<boolean | null>(null);

  function prefersReducedMotion(): boolean {
    if (reducedMotion.current === null) {
      reducedMotion.current =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }
    return reducedMotion.current;
  }

  function handleMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const x = px * 100;
    const y = py * 100;
    el.style.setProperty("--mx", `${x}%`);
    el.style.setProperty("--my", `${y}%`);
    el.style.setProperty("--holo-angle", `${115 + (x - 50) * 0.6}deg`);

    if (prefersReducedMotion()) return;
    const tiltX = (0.5 - py) * MAX_TILT_DEG * 2;
    const tiltY = (px - 0.5) * MAX_TILT_DEG * 2;
    const lift = liftOnHover ? -4 : 0;
    el.style.transition = "transform 0.08s linear";
    el.style.transform = `perspective(800px) translateY(${lift}px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale(1.015)`;
  }

  function handleLeave() {
    const el = ref.current;
    if (!el) return;
    el.style.transition = "transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)";
    el.style.transform = "";
  }

  return (
    <div
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      className={`holo-frame rounded-card ${className}`}
    >
      {children}
    </div>
  );
}

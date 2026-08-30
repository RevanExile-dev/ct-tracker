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
 *
 * touchTilt: estende lo stesso effetto al trascinamento col dito (come su
 * Pokémon Pocket) invece del solo passaggio del mouse - il mouse infatti
 * non esiste su mobile, dove questo sito si usa per lo piu'. Disattivato
 * di default e usato solo sulla carta grande della pagina di dettaglio,
 * non nella griglia: qui serve anche `touch-action: none` per evitare che
 * il trascinamento faccia scorrere la pagina invece di inclinare la carta,
 * comportamento che nella griglia (tante tile piccole, si scrolla in
 * continuazione) sarebbe piu' fastidioso che utile.
 */
export default function HoloFrame({
  children,
  className = "",
  liftOnHover = false,
  touchTilt = false,
}: {
  children: React.ReactNode;
  className?: string;
  liftOnHover?: boolean;
  touchTilt?: boolean;
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

  function updateFromPoint(clientX: number, clientY: number) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (clientX - rect.left) / rect.width;
    const py = (clientY - rect.top) / rect.height;
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

  function resetTilt() {
    const el = ref.current;
    if (!el) return;
    el.style.transition = "transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)";
    el.style.transform = "";
  }

  function handleMove(e: React.MouseEvent<HTMLDivElement>) {
    updateFromPoint(e.clientX, e.clientY);
  }

  function handleTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    if (!touchTilt) return;
    const touch = e.touches[0];
    if (!touch) return;
    updateFromPoint(touch.clientX, touch.clientY);
  }

  return (
    <div
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={resetTilt}
      onTouchMove={touchTilt ? handleTouchMove : undefined}
      onTouchEnd={touchTilt ? resetTilt : undefined}
      onTouchCancel={touchTilt ? resetTilt : undefined}
      style={touchTilt ? { touchAction: "none" } : undefined}
      className={`holo-frame rounded-card ${className}`}
    >
      {children}
    </div>
  );
}

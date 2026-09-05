"use client";

import { useEffect, useRef, useState } from "react";

type CardMotionLevel = "detail" | "binder" | "tile";

const TILT_BY_LEVEL: Record<CardMotionLevel, number> = { detail: 10, binder: 4, tile: 5 };

/** Superficie carta GPU-friendly con motion distinto per contesto. */
export default function InteractiveCard({ children, className = "", level = "tile", reveal = false }: {
  children: React.ReactNode;
  className?: string;
  level?: CardMotionLevel;
  reveal?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const pointRef = useRef<{ x: number; y: number } | null>(null);
  const pointerActiveRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);
  const [revealDone, setRevealDone] = useState(!reveal);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  function applyPoint() {
    frameRef.current = null;
    const el = ref.current;
    const point = pointRef.current;
    if (!el || !point) return;
    const rect = el.getBoundingClientRect();
    const px = Math.max(0, Math.min(1, (point.x - rect.left) / rect.width));
    const py = Math.max(0, Math.min(1, (point.y - rect.top) / rect.height));
    const x = px * 100;
    const y = py * 100;
    const tilt = TILT_BY_LEVEL[level];
    const lift = level === "detail" ? 0 : level === "binder" ? -2 : -4;
    const scale = level === "detail" ? 1.018 : 1.01;
    el.style.setProperty("--card-mx", `${x}%`);
    el.style.setProperty("--card-my", `${y}%`);
    el.style.setProperty("--card-angle", `${115 + (x - 50) * 0.7}deg`);
    el.style.setProperty("--card-shadow-x", `${(px - 0.5) * -22}px`);
    el.style.setProperty("--card-shadow-y", `${8 + py * 12}px`);
    el.style.setProperty("--card-transform", `perspective(900px) translateY(${lift}px) rotateX(${(0.5 - py) * tilt * 2}deg) rotateY(${(px - 0.5) * tilt * 2}deg) scale(${scale})`);
    el.dataset.active = "true";
  }

  function queuePoint(clientX: number, clientY: number) {
    pointRef.current = { x: clientX, y: clientY };
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(applyPoint);
  }

  function reset() {
    pointerActiveRef.current = false;
    pointerIdRef.current = null;
    dragStartRef.current = null;
    pointRef.current = null;
    const el = ref.current;
    if (!el) return;
    delete el.dataset.active;
    delete el.dataset.pressed;
    el.style.removeProperty("--card-transform");
    el.style.removeProperty("--card-shadow-x");
    el.style.removeProperty("--card-shadow-y");
  }

  function finishPointer(event: React.PointerEvent<HTMLDivElement>, cancelled = false) {
    if (pointerIdRef.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (cancelled) suppressClickRef.current = false;
    reset();
  }

  return (
    <div
      ref={ref}
      data-level={level}
      onPointerDown={(event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        // Bug reale trovato eseguendo davvero il sito (non solo letto):
        // setPointerCapture() sul contenitore fa si' che TUTTI gli eventi
        // successivi per questo pointerId (compreso "click", sotto mouse -
        // il touch si comporta diversamente e non ne risente) vengano
        // ritargettati al contenitore stesso, anche se il puntatore e'
        // rilasciato fisicamente sopra un bottone annidato (stella binder,
        // cuore desideri). Risultato: click del mouse su quei bottoni
        // silenziosamente ignorato. Attenzione: SOLO "button", non "a" -
        // il link principale della carta (CardTile, BinderBook) e' proprio
        // cio' che ha bisogno della cattura/soppressione-click per
        // distinguere un tap (naviga) da un trascinamento (sfoglio Binder);
        // escluderlo romperebbe quel meccanismo, verificato dal vivo.
        const interactive = (event.target as HTMLElement).closest?.("button, input, select, textarea");
        if (interactive) return;
        pointerActiveRef.current = true;
        pointerIdRef.current = event.pointerId;
        dragStartRef.current = { x: event.clientX, y: event.clientY };
        suppressClickRef.current = false;
        event.currentTarget.dataset.pressed = "true";
        event.currentTarget.setPointerCapture(event.pointerId);
        queuePoint(event.clientX, event.clientY);
      }}
      onPointerMove={(event) => {
        if (pointerActiveRef.current && pointerIdRef.current === event.pointerId) {
          const start = dragStartRef.current;
          // Soglia piu' larga su touch: un dito reale si sposta facilmente
          // di 5-15px anche durante un tap "fermo" (attrito schermo/pelle) -
          // a 5px un tap normale veniva scambiato per un trascinamento e il
          // click sulla carta soppresso, rendendo le carte del binder poco
          // reattive al tocco. Il mouse resta a 5px: un click e' gia' preciso.
          const threshold = event.pointerType === "touch" ? 12 : 5;
          if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) >= threshold) {
            suppressClickRef.current = true;
          }
          queuePoint(event.clientX, event.clientY);
          return;
        }
        // Sul desktop resta anche il tilt leggero al semplice passaggio;
        // la pressione usa invece pointer capture, quindi continua a seguire
        // il mouse anche se durante il trascinamento esce dai bordi.
        if (event.pointerType === "mouse") queuePoint(event.clientX, event.clientY);
      }}
      onPointerUp={(event) => finishPointer(event)}
      onPointerCancel={(event) => finishPointer(event, true)}
      onLostPointerCapture={() => {
        if (pointerActiveRef.current) reset();
      }}
      onPointerLeave={() => {
        if (!pointerActiveRef.current) reset();
      }}
      onDragStart={(event) => event.preventDefault()}
      onClickCapture={(event) => {
        if (!suppressClickRef.current) return;
        suppressClickRef.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      onBlur={reset}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) setRevealDone(true);
      }}
      className={`interactive-card rounded-card ${reveal && !revealDone ? "card-reveal" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

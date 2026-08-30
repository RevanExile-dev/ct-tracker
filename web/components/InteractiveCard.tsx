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
    pointRef.current = null;
    const el = ref.current;
    if (!el) return;
    delete el.dataset.active;
    el.style.removeProperty("--card-transform");
    el.style.removeProperty("--card-shadow-x");
    el.style.removeProperty("--card-shadow-y");
  }

  return (
    <div
      ref={ref}
      data-level={level}
      onPointerDown={(event) => {
        if (event.pointerType === "touch" || event.pointerType === "pen") {
          pointerActiveRef.current = true;
          queuePoint(event.clientX, event.clientY);
        }
      }}
      onPointerMove={(event) => {
        if (event.pointerType === "mouse" || pointerActiveRef.current) queuePoint(event.clientX, event.clientY);
      }}
      onPointerUp={reset}
      onPointerCancel={reset}
      onPointerLeave={reset}
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

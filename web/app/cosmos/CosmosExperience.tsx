"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CardRow, fetchCards } from "@/lib/db";
import { formatCents, priceDeltaPct } from "@/lib/format";
import VgpuCosmos from "./VgpuCosmos";
import styles from "./cosmos.module.css";

const DEMO_CARDS: CardRow[] = [
  {
    id: -1,
    name: "Cosmic Charizard",
    version: "Lab specimen",
    expansion_code: "lab",
    expansion_name: "Carta Viva Cosmos",
    image_url: null,
    rarity: "Special Illustration Rare",
    is_premium: 1,
    latest_price_cents: 28490,
    latest_price_currency: "EUR",
    latest_listings: 18,
    latest_language: "en",
    prev_price_cents: 26900,
    languages_available: ",en,it,",
    best_price_cents: 28490,
    best_price_currency: "EUR",
    best_condition: "Near Mint",
    best_language: "en",
    best_can_sell_via_hub: 1,
    prev_best_price_cents: 26900,
  },
];

function ArrowIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d={direction === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SpectrumMark() {
  const gradientId = useId();
  return (
    <svg viewBox="0 0 44 44" aria-hidden="true" className="h-10 w-10">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#66fff0" />
          <stop offset=".48" stopColor="#f06de0" />
          <stop offset="1" stopColor="#ffd36e" />
        </linearGradient>
      </defs>
      <path d="M22 3 40 35H4L22 3Z" fill="none" stroke={`url(#${gradientId})`} strokeWidth="1.6" />
      <circle cx="22" cy="23" r="8.5" fill="none" stroke={`url(#${gradientId})`} strokeWidth="1.2" />
      <circle cx="22" cy="23" r="2.2" fill={`url(#${gradientId})`} />
    </svg>
  );
}

function HoloCard({
  card,
  active,
  onActivate,
}: {
  card: CardRow;
  active: boolean;
  onActivate?: () => void;
}) {
  const cardRef = useRef<HTMLButtonElement>(null);
  const frameRef = useRef<number | null>(null);
  const pointRef = useRef({ x: 0.5, y: 0.5 });
  const [imageError, setImageError] = useState(false);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  const paint = useCallback(() => {
    frameRef.current = null;
    const el = cardRef.current;
    if (!el) return;
    const { x, y } = pointRef.current;
    el.style.setProperty("--mx", `${x * 100}%`);
    el.style.setProperty("--my", `${y * 100}%`);
    el.style.setProperty("--rx", `${(0.5 - y) * 20}deg`);
    el.style.setProperty("--ry", `${(x - 0.5) * 24}deg`);
    el.style.setProperty("--shine", `${100 + x * 70}deg`);
  }, []);

  function track(event: React.PointerEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    pointRef.current = {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(paint);
  }

  function reset() {
    const el = cardRef.current;
    if (!el) return;
    el.style.removeProperty("--rx");
    el.style.removeProperty("--ry");
    el.style.removeProperty("--mx");
    el.style.removeProperty("--my");
  }

  return (
    <button
      ref={cardRef}
      type="button"
      className={`${styles.holoCard} ${active ? styles.holoCardActive : ""}`}
      onPointerMove={track}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        track(event);
      }}
      onPointerLeave={reset}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        reset();
      }}
      onPointerCancel={reset}
      onClick={onActivate}
      aria-label={`${card.name}, ${card.rarity ?? "rarità non disponibile"}`}
    >
      <span className={styles.cardImage}>
        {card.image_url && !imageError ? (
          <Image
            src={card.image_url}
            alt={card.name}
            fill
            priority={active}
            sizes="(max-width: 640px) 72vw, 360px"
            className="object-cover"
            onError={() => setImageError(true)}
          />
        ) : (
          <span className={styles.cardFallback}>
            <SpectrumMark />
            <span>CARTA VIVA</span>
            <strong>{card.name}</strong>
          </span>
        )}
      </span>
      <span className={styles.foil} aria-hidden="true" />
      <span className={styles.prism} aria-hidden="true" />
      <span className={styles.glare} aria-hidden="true" />
      <span className={styles.cardEdge} aria-hidden="true" />
    </button>
  );
}

export default function CosmosExperience() {
  const pointer = useRef({ x: 0.5, y: 0.5 });
  const [cards, setCards] = useState<CardRow[]>(DEMO_CARDS);
  const [activeIndex, setActiveIndex] = useState(0);
  const [gpuStatus, setGpuStatus] = useState<"loading" | "webgpu" | "fallback">("loading");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [soundPulse, setSoundPulse] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchCards({
      rarities: ["Special Illustration Rare", "Illustration Rare"],
      sortBy: "price_desc",
      limit: 9,
    }).then((result) => {
      const usable = result.filter((card) => card.image_url);
      if (!cancelled && usable.length) setCards(usable);
    }).catch(() => {
      // Il specimen locale mantiene la route completa anche se il DB non
      // e' ancora disponibile o la rete viene interrotta durante il load.
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      pointer.current = {
        x: event.clientX / Math.max(window.innerWidth, 1),
        y: event.clientY / Math.max(window.innerHeight, 1),
      };
      document.documentElement.style.setProperty("--cosmos-x", `${event.clientX}px`);
      document.documentElement.style.setProperty("--cosmos-y", `${event.clientY}px`);
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => window.removeEventListener("pointermove", onPointerMove);
  }, []);

  const active = cards[activeIndex] ?? cards[0];
  const price = active.best_price_cents ?? active.latest_price_cents;
  const previous = active.prev_best_price_cents ?? active.prev_price_cents;
  const delta = priceDeltaPct(price, previous);

  const selectRelative = useCallback((direction: number) => {
    setActiveIndex((current) => (current + direction + cards.length) % cards.length);
    setSoundPulse(true);
    window.setTimeout(() => setSoundPulse(false), 420);
  }, [cards.length]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowLeft") selectRelative(-1);
      if (event.key === "ArrowRight") selectRelative(1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectRelative]);

  return (
    <main className={styles.shell}>
      <div className={styles.shaderLayer}>
        <VgpuCosmos pointer={pointer} reducedMotion={reducedMotion} onStatus={setGpuStatus} />
      </div>
      <div className={styles.noise} aria-hidden="true" />
      <div className={styles.cursorGlow} aria-hidden="true" />
      <div className={styles.orbitField} aria-hidden="true">
        <span /><span /><span />
      </div>

      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="Torna a Carta Viva">
          <SpectrumMark />
          <span>
            <strong>CARTA VIVA</strong>
            <small>COSMOS / EXPERIMENT 01</small>
          </span>
        </Link>
        <div className={styles.statusRail}>
          <span className={styles.liveDot} />
          <span>{gpuStatus === "webgpu" ? "WEBGPU LIVE" : gpuStatus === "fallback" ? "CSS FALLBACK" : "INITIALIZING GPU"}</span>
          <span className={styles.statusDivider} />
          <span>{String(cards.length).padStart(2, "0")} SPECIMENS</span>
        </div>
        <Link href="/binder-book" className={styles.vaultLink}>
          APRI IL BINDER <span>↗</span>
        </Link>
      </header>

      <section className={styles.stage} aria-live="polite">
        <div className={styles.eyebrow}>
          <span>ARCHIVE SIGNAL</span>
          <i />
          <span>{active.expansion_code.toUpperCase()}</span>
        </div>

        <div className={styles.stageGrid}>
          <aside className={`${styles.dataPanel} ${styles.leftPanel}`}>
            <span className={styles.panelIndex}>01 / IDENTITY</span>
            <h1>{active.name}</h1>
            <p>{active.expansion_name}</p>
            <div className={styles.rarityPill}>{active.rarity ?? "UNKNOWN SIGNAL"}</div>
            <div className={styles.coordinate}>
              <span>CATALOG ID</span>
              <strong>{active.id > 0 ? active.id : "LAB–001"}</strong>
            </div>
          </aside>

          <div className={styles.cardTheater}>
            <div className={styles.halo} aria-hidden="true" />
            <div className={styles.scanLine} aria-hidden="true" />
            <div className={`${styles.cardWrap} ${soundPulse ? styles.cardWarp : ""}`} key={active.id}>
              <HoloCard card={active} active />
            </div>
            <span className={`${styles.corner} ${styles.cornerTl}`} />
            <span className={`${styles.corner} ${styles.cornerTr}`} />
            <span className={`${styles.corner} ${styles.cornerBl}`} />
            <span className={`${styles.corner} ${styles.cornerBr}`} />
          </div>

          <aside className={`${styles.dataPanel} ${styles.rightPanel}`}>
            <span className={styles.panelIndex}>02 / MARKET PULSE</span>
            <div className={styles.priceValue}>{formatCents(price, active.best_price_currency ?? active.latest_price_currency ?? "EUR")}</div>
            <div className={`${styles.delta} ${(delta ?? 0) >= 0 ? styles.up : styles.down}`}>
              {delta === null ? "— NO HISTORY" : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta).toFixed(1)}% / 24H`}
            </div>
            <div className={styles.waveform} aria-hidden="true">
              {Array.from({ length: 24 }, (_, index) => (
                <i key={index} style={{ "--wave": `${22 + ((index * 17 + activeIndex * 11) % 70)}%` } as React.CSSProperties} />
              ))}
            </div>
            <div className={styles.coordinate}>
              <span>AVAILABLE SIGNALS</span>
              <strong>{active.latest_listings ?? 0} LISTINGS</strong>
            </div>
          </aside>
        </div>

        <div className={styles.controls}>
          <button type="button" onClick={() => selectRelative(-1)} aria-label="Carta precedente"><ArrowIcon direction="left" /></button>
          <div className={styles.progressTrack}>
            <span style={{ width: `${((activeIndex + 1) / cards.length) * 100}%` }} />
          </div>
          <span className={styles.counter}>{String(activeIndex + 1).padStart(2, "0")} / {String(cards.length).padStart(2, "0")}</span>
          <button type="button" onClick={() => selectRelative(1)} aria-label="Carta successiva"><ArrowIcon direction="right" /></button>
        </div>
      </section>

      <section className={styles.deck} aria-label="Seleziona una carta">
        <div className={styles.deckIntro}>
          <span>THE CONSTELLATION</span>
          <p>Muovi, scegli, osserva. Ogni carta ha il suo spettro.</p>
        </div>
        <div className={styles.deckRail}>
          {cards.map((card, index) => (
            <div key={card.id} className={`${styles.miniCard} ${index === activeIndex ? styles.miniCardActive : ""}`} style={{ "--deck-delay": `${index * 45}ms` } as React.CSSProperties}>
              <HoloCard card={card} active={index === activeIndex} onActivate={() => setActiveIndex(index)} />
              <span>{String(index + 1).padStart(2, "0")}</span>
            </div>
          ))}
        </div>
      </section>

      <div className={styles.ticker} aria-hidden="true">
        <div>
          {[...cards, ...cards].map((card, index) => (
            <span key={`${card.id}-${index}`}><b>{card.name}</b> / {card.rarity ?? "ARCHIVE"} <i>✦</i></span>
          ))}
        </div>
      </div>
    </main>
  );
}

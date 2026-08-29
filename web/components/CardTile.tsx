"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import HoloFrame from "./HoloFrame";
import { CardRow } from "@/lib/db";
import { formatCents, languageFlag, priceDeltaPct } from "@/lib/format";

const STAGGER_MS = 25;
const STAGGER_CAP = 16; // oltre questo indice niente piu' ritardo, altrimenti l'ultima riga aspetta troppo

export default function CardTile({
  card,
  index = 0,
  inBinder,
  onToggleBinder,
}: {
  card: CardRow;
  index?: number;
  inBinder?: boolean;
  onToggleBinder?: () => void;
}) {
  const delta = priceDeltaPct(card.latest_price_cents, card.prev_price_cents);
  const [popping, setPopping] = useState(false);

  const delayMs = Math.min(index, STAGGER_CAP) * STAGGER_MS;

  return (
    <Link
      href={`/card/${card.id}`}
      className="group block card-enter"
      style={{ "--enter-delay": `${delayMs}ms` } as React.CSSProperties}
    >
      <HoloFrame className="bg-base-surface border border-base-border overflow-hidden transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-glow">
        <div className="relative aspect-[5/7] bg-base-surface2">
          {card.image_url ? (
            <Image
              src={card.image_url}
              alt={card.name}
              fill
              sizes="(min-width: 1024px) 20vw, 45vw"
              className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-ink-faint text-xs font-mono">
              nessuna immagine
            </div>
          )}
          {card.is_premium === 1 && (
            <span className="absolute top-2 left-2 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-black/60 backdrop-blur border border-white/10 text-accent-bright">
              premium
            </span>
          )}
          {onToggleBinder && (
            <button
              onClick={(e) => {
                e.preventDefault();
                setPopping(true);
                onToggleBinder();
              }}
              onAnimationEnd={() => setPopping(false)}
              aria-label={inBinder ? "Rimuovi dal binder" : "Aggiungi al binder"}
              className={`absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center backdrop-blur border transition-colors active:scale-90 ${
                popping ? "pop-on-toggle" : ""
              } ${
                inBinder
                  ? "bg-accent/20 border-accent/60 text-accent-bright"
                  : "bg-black/60 border-white/10 text-white/70 hover:text-white"
              }`}
            >
              {inBinder ? "★" : "☆"}
            </button>
          )}
        </div>

        <div className="p-3">
          <div className="text-xs font-mono text-ink-faint truncate">{card.expansion_name}</div>
          <div className="font-display font-medium text-ink-primary leading-snug mt-0.5 truncate">
            {card.name}
          </div>

          <div className="flex items-end justify-between mt-2">
            <div className="font-mono text-lg text-ink-primary flex items-center gap-1.5">
              {formatCents(card.latest_price_cents, card.latest_price_currency ?? "EUR")}
              {card.latest_language && (
                <span className="text-xs" title={card.latest_language.toUpperCase()}>
                  {languageFlag(card.latest_language)}
                </span>
              )}
            </div>
            {delta !== null && (
              <div
                className={`text-xs font-mono ${
                  delta >= 0 ? "text-signal-up" : "text-signal-down"
                }`}
              >
                {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
              </div>
            )}
          </div>
        </div>
      </HoloFrame>
    </Link>
  );
}

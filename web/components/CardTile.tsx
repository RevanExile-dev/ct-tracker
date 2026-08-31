"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import InteractiveCard from "./InteractiveCard";
import { CardRow } from "@/lib/db";
import { formatCents, languageFlag, priceDeltaPct } from "@/lib/format";

const STAGGER_MS = 25;
const STAGGER_CAP = 16; // oltre questo indice niente piu' ritardo, altrimenti l'ultima riga aspetta troppo

export default function CardTile({
  card,
  index = 0,
  inBinder,
  onToggleBinder,
  inWishlist,
  onToggleWishlist,
  returnTo,
}: {
  card: CardRow;
  index?: number;
  inBinder?: boolean;
  onToggleBinder?: () => void;
  /** Analogo a inBinder/onToggleBinder ma per la lista desideri (cuore
   * invece di stella) - usato dalla pagina /wishlist per rimuovere una
   * carta direttamente dalla griglia, senza aprirla. Le due liste sono
   * indipendenti: una pagina passa l'uno o l'altro, mai entrambi insieme
   * in pratica. */
  inWishlist?: boolean;
  onToggleWishlist?: () => void;
  returnTo?: string;
}) {
  // filtered_price_cents esiste solo quando e' attivo un filtro lingua/
  // condizione/Zero: e' la piu' economica tra le inserzioni che rispettano
  // TUTTI quei filtri insieme (non best_price_cents, calcolato ignorandoli,
  // che altrimenti mostrerebbe una lingua/condizione diversa da quella
  // appena filtrata). Senza filtri attivi, best_price_cents preferisce
  // Near Mint + CardTrader Zero quando esiste (vedi _pick_best_listing lato
  // sync); fallback al vecchio prezzo piu' basso in assoluto solo per le
  // carte non ancora ripassate dal sync.
  const priceCents = card.filtered_price_cents ?? card.best_price_cents ?? card.latest_price_cents;
  const priceCurrency = card.filtered_price_currency ?? card.best_price_currency ?? card.latest_price_currency;
  const priceLanguage = card.filtered_language ?? card.best_language ?? card.latest_language;
  const prevPriceCents = card.prev_best_price_cents ?? card.prev_price_cents;
  const shownCondition = card.filtered_condition !== undefined ? card.filtered_condition : card.best_condition;
  const shownZero = card.filtered_can_sell_via_hub !== undefined ? card.filtered_can_sell_via_hub : card.best_can_sell_via_hub;
  const isNmZero = shownZero === 1 && shownCondition === "Near Mint";
  const delta = priceDeltaPct(priceCents, prevPriceCents);
  const [popping, setPopping] = useState(false);
  const [poppingWishlist, setPoppingWishlist] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  const delayMs = Math.min(index, STAGGER_CAP) * STAGGER_MS;

  return (
    <Link
      href={returnTo ? `/card/${card.id}?from=${encodeURIComponent(returnTo)}` : `/card/${card.id}`}
      className="group block card-enter"
      style={{ "--enter-delay": `${delayMs}ms` } as React.CSSProperties}
    >
      <InteractiveCard
        level="tile"
        className="bg-base-surface border border-base-border overflow-hidden transition-shadow duration-300 group-hover:shadow-glow"
      >
        <div className="relative aspect-[5/7] bg-base-surface2">
          {card.image_url ? (
            <Image
              src={card.image_url}
              alt={card.name}
              fill
              sizes="(min-width: 1024px) 20vw, 45vw"
              onLoad={() => setImgLoaded(true)}
              className={`object-cover transition-[opacity,transform] duration-500 group-hover:scale-[1.03] ${
                imgLoaded ? "opacity-100" : "opacity-0"
              }`}
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
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
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
          {onToggleWishlist && (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setPoppingWishlist(true);
                onToggleWishlist();
              }}
              onAnimationEnd={() => setPoppingWishlist(false)}
              aria-label={inWishlist ? "Rimuovi dalla lista desideri" : "Aggiungi alla lista desideri"}
              className={`absolute top-2 ${onToggleBinder ? "right-11" : "right-2"} w-7 h-7 rounded-full flex items-center justify-center backdrop-blur border transition-colors active:scale-90 ${
                poppingWishlist ? "pop-on-toggle" : ""
              } ${
                inWishlist
                  ? "bg-accent/20 border-accent/60 text-accent-bright"
                  : "bg-black/60 border-white/10 text-white/70 hover:text-white"
              }`}
            >
              {inWishlist ? "♥" : "♡"}
            </button>
          )}
        </div>

        <div className="p-3">
          <div className="text-xs font-mono text-ink-faint truncate">{card.expansion_name}</div>
          <div className="font-display font-medium text-ink-primary leading-snug mt-0.5 truncate">
            {card.name}
          </div>

          <div className="flex items-end justify-between flex-wrap gap-x-2 gap-y-1 mt-2">
            <div className="font-mono text-lg text-ink-primary flex flex-wrap items-center gap-1.5 min-w-0">
              {formatCents(priceCents, priceCurrency ?? "EUR")}
              {priceLanguage && (
                <span className="text-xs shrink-0" title={priceLanguage.toUpperCase()}>
                  {languageFlag(priceLanguage)}
                </span>
              )}
              {isNmZero && (
                <span
                  className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-accent/15 border border-accent/40 text-accent-bright whitespace-nowrap shrink-0"
                  title="Near Mint, CardTrader Zero"
                >
                  NM Zero
                </span>
              )}
            </div>
            {delta !== null && (
              <div
                className={`text-xs font-mono whitespace-nowrap shrink-0 ${
                  delta >= 0 ? "text-signal-up" : "text-signal-down"
                }`}
              >
                {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
              </div>
            )}
          </div>
        </div>
      </InteractiveCard>
    </Link>
  );
}

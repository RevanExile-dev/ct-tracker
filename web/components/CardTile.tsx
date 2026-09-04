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
  priceProfile,
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
  // "best": prezzo a cascata (Near Mint + CardTrader Zero quando esiste,
  // qualunque lingua, altrimenti il piu' economico salvato) - usato SOLO dal
  // binder, dove la domanda e' "quanto vale la mia collezione" e serve
  // sempre un numero anche quando non esiste una inserzione IT+NM+Zero.
  // Il default (nessun valore passato) e' invece "esatto": SOLO Italiano +
  // Near Mint + CardTrader Zero, senza alcun fallback - richiesto
  // esplicitamente dall'utente ("quel dato interessa principalmente", non
  // vuole un prezzo/andamento che in realta' e' un'altra combinazione
  // spacciata per quella. Vale per catalogo, desideri e carte in movimento.
  priceProfile?: "best" | "exact";
}) {
  const isBest = priceProfile === "best";
  // filtered_price_cents esiste solo quando e' attivo un filtro lingua/
  // condizione/Zero scelto dall'utente: ha sempre la precedenza, in
  // entrambi i profili - se hai scelto tu un filtro, il prezzo mostrato
  // deve rispettarlo indipendentemente dal profilo di default.
  const hasFilter = card.filtered_price_cents !== undefined;
  const priceCents: number | null = hasFilter
    ? card.filtered_price_cents ?? null
    : isBest
      ? card.best_price_cents ?? card.latest_price_cents
      : card.it_nm_zero_price_cents;
  const priceCurrency = hasFilter
    ? card.filtered_price_currency
    : isBest
      ? card.best_price_currency ?? card.latest_price_currency
      : card.it_nm_zero_price_currency ?? "EUR";
  // "!= null" (non "!== null"): intercetta anche un eventuale undefined,
  // non solo null - altrimenti "IT/Near Mint/Zero" comparirebbero come
  // badge anche con un prezzo mancante (segnalato in review, "undefined
  // !== null" e' true in JS/TS).
  const priceLanguage = hasFilter
    ? card.filtered_language
    : isBest
      ? card.best_language ?? card.latest_language
      : priceCents != null ? "it" : undefined;
  const prevPriceCents = isBest
    ? card.prev_best_price_cents ?? card.prev_price_cents
    : card.prev_it_nm_zero_price_cents;
  const shownCondition = hasFilter
    ? card.filtered_condition
    : isBest
      ? card.best_condition
      : priceCents != null ? "Near Mint" : undefined;
  const shownZero = hasFilter
    ? card.filtered_can_sell_via_hub
    : isBest
      ? card.best_can_sell_via_hub
      : priceCents != null ? 1 : undefined;
  const isNmZero = shownZero === 1 && shownCondition === "Near Mint";
  const delta = priceDeltaPct(priceCents, prevPriceCents);
  const [popping, setPopping] = useState(false);
  const [poppingWishlist, setPoppingWishlist] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  const delayMs = Math.min(index, STAGGER_CAP) * STAGGER_MS;
  const hasActions = Boolean(onToggleBinder || onToggleWishlist);

  return (
    <div
      className="group relative card-enter"
      style={{ "--enter-delay": `${delayMs}ms` } as React.CSSProperties}
    >
      {/* InteractiveCard avvolge l'INTERA tile (immagine+nome+prezzo+
          bottoni), non solo la parte cliccabile: e' lei a portare bordo,
          sfondo, angoli arrotondati e il bagliore/tilt al passaggio del
          mouse (vedi .interactive-card::before/::after in globals.css,
          border-radius:inherit - se si fermasse a meta' carta, come in un
          tentativo precedente, il bagliore avrebbe tracciato un contorno
          intorno a immagine+nome lasciando prezzo e bottoni "staccati" e
          statici, una cucitura visibile passandoci sopra col mouse). Il
          Link naviga SOLO su immagine+nome; i bottoni stella/cuore restano
          FRATELLI del Link (non annidati al suo interno: un <button>
          dentro un <a> e' HTML non valido, contenuto interattivo dentro
          contenuto interattivo) ma dentro lo stesso InteractiveCard, cosi'
          la riga prezzo puo' uscire dal Link pur restando parte della
          stessa carta interattiva. */}
      <InteractiveCard
        level="tile"
        className="bg-base-surface border border-base-border overflow-hidden transition-shadow duration-300 group-hover:shadow-glow"
      >
        <Link
          href={returnTo ? `/card/${card.id}?from=${encodeURIComponent(returnTo)}` : `/card/${card.id}`}
          className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-inset"
        >
          <div className="relative aspect-[5/7] bg-base-surface2">
            {card.image_url && !imgError ? (
              <Image
                src={card.image_url}
                alt={card.name}
                fill
                sizes="(min-width: 1024px) 20vw, 45vw"
                onLoad={() => setImgLoaded(true)}
                onError={() => setImgError(true)}
                className={`object-cover transition-[opacity,transform] duration-500 group-hover:scale-[1.03] ${
                  imgLoaded ? "opacity-100" : "opacity-0"
                }`}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-ink-faint text-xs font-mono text-center px-2">
                {imgError ? "immagine non disponibile" : "nessuna immagine"}
              </div>
            )}
            {card.is_premium === 1 && (
              <span className="absolute top-2 left-2 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-black/60 backdrop-blur border border-white/10 text-accent-bright">
                premium
              </span>
            )}
          </div>

          <div className="px-3 pt-3">
            <div className="text-xs font-mono text-ink-faint truncate">{card.expansion_name}</div>
            <div className="font-display font-medium text-ink-primary leading-snug mt-0.5 truncate">
              {card.name}
            </div>
          </div>
        </Link>

        {/* Prezzo + bottoni stella/cuore nella STESSA riga in vero
            flexbox - non un overlay assoluto sopra il testo: colonna
            prezzo a sinistra (si restringe/va a capo da sola quando
            serve, es. badge "NM Zero" su schermi stretti), colonna
            bottoni a destra a larghezza fissa, mai sovrapposte
            indipendentemente da quante righe occupa il prezzo. Richiesto
            esplicitamente dall'utente: accanto al prezzo, non sotto la
            carta ne' sopra l'artwork. */}
        <div className="px-3 pb-3 pt-2 flex items-end justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-lg text-ink-primary flex flex-wrap items-center gap-1.5">
              {formatCents(priceCents, priceCurrency ?? "EUR")}
              {priceLanguage && (
                <span className="text-xs shrink-0" title={priceLanguage.toUpperCase()}>
                  {languageFlag(priceLanguage)}
                </span>
              )}
              {isNmZero && (
                <span
                  className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-accent/15 border border-accent/40 text-accent-bright whitespace-nowrap"
                  title="Near Mint, CardTrader Zero"
                >
                  NM Zero
                </span>
              )}
            </div>
            {delta !== null && (
              <div
                className={`text-xs font-mono whitespace-nowrap mt-0.5 ${
                  delta >= 0 ? "text-signal-up" : "text-signal-down"
                }`}
              >
                {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
              </div>
            )}
          </div>

          {hasActions && (
            // In colonna (uno sopra l'altro) sotto ai 640px: affiancati
            // occupano ~78px fissi che su una tile da 2 colonne (mobile,
            // ~150-170px di larghezza utile) lasciano troppo poco spazio al
            // prezzo/badge/percentuale, causando sovrapposizioni con testo
            // vero (con un'immagine reale il prezzo va a capo diversamente
            // da come appariva nel placeholder di test) - segnalato
            // dall'utente su schermata reale. In riga da sm: in su, dove le
            // tile sono piu' larghe (3+ colonne) e c'e' spazio per entrambi
            // affiancati senza stringere il prezzo.
            <div className="flex flex-col sm:flex-row items-end sm:items-center gap-1.5 shrink-0">
              {onToggleWishlist && (
                <button
                  type="button"
                  onClick={() => {
                    setPoppingWishlist(true);
                    onToggleWishlist();
                  }}
                  onAnimationEnd={() => setPoppingWishlist(false)}
                  aria-label={inWishlist ? "Rimuovi dalla lista desideri" : "Aggiungi alla lista desideri"}
                  className={`w-9 h-9 rounded-full flex items-center justify-center border transition-colors active:scale-90 ${
                    poppingWishlist ? "pop-on-toggle" : ""
                  } ${
                    inWishlist
                      ? "bg-accent/15 border-accent/50 text-accent-bright"
                      : "bg-base-surface2 border-base-border text-ink-faint hover:text-ink-primary hover:border-accent/40"
                  }`}
                >
                  {inWishlist ? "♥" : "♡"}
                </button>
              )}
              {onToggleBinder && (
                <button
                  type="button"
                  onClick={() => {
                    setPopping(true);
                    onToggleBinder();
                  }}
                  onAnimationEnd={() => setPopping(false)}
                  aria-label={inBinder ? "Rimuovi dal binder" : "Aggiungi al binder"}
                  className={`w-9 h-9 rounded-full flex items-center justify-center border transition-colors active:scale-90 ${
                    popping ? "pop-on-toggle" : ""
                  } ${
                    inBinder
                      ? "bg-accent/15 border-accent/50 text-accent-bright"
                      : "bg-base-surface2 border-base-border text-ink-faint hover:text-ink-primary hover:border-accent/40"
                  }`}
                >
                  {inBinder ? "★" : "☆"}
                </button>
              )}
            </div>
          )}
        </div>
      </InteractiveCard>
    </div>
  );
}

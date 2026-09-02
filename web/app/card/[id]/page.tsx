"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import { useParams, useSearchParams } from "next/navigation";
import {
  CardDetail, Listing, PricePoint,
  fetchBestListings, fetchCardDetail, fetchPriceHistory,
} from "@/lib/db";
import { getBinderIds, toggleBinder } from "@/lib/binder";
import { getWishlistIds, toggleWishlist } from "@/lib/wishlist";
import InteractiveCard from "@/components/InteractiveCard";
import SiteHeader from "@/components/SiteHeader";
import PriceChart from "@/components/PriceChart";
import ConditionBadge from "@/components/ConditionBadge";
import FilterDropdown from "@/components/FilterDropdown";
import { countryFlag, formatCents, languageFlag, trendVsMovingAverage } from "@/lib/format";

// Spike Three.js isolato (PR #6): mai importato/scaricato nel percorso di
// default (nessun flag ?three=1) - ssr:false + import dinamico tengono
// three/@react-three/fiber fuori dal bundle server e da quello iniziale
// del client finche' non serve davvero.
const ThreeCardHero = dynamic(() => import("@/components/ThreeCardHero"), { ssr: false });

function CardDetailContent() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const id = Number(params.id);
  const requestedReturn = searchParams.get("from");
  const returnTo = requestedReturn?.startsWith("/") && !requestedReturn.startsWith("//")
    ? requestedReturn
    : "/";

  const [card, setCard] = useState<CardDetail | null | undefined>(undefined);
  const [history, setHistory] = useState<PricePoint[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [inBinder, setInBinder] = useState(false);
  const [inWishlist, setInWishlist] = useState(false);
  const [popping, setPopping] = useState(false);
  const [poppingWishlist, setPoppingWishlist] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [selectedConditions, setSelectedConditions] = useState<string[]>([]);
  const [onlyZeroListings, setOnlyZeroListings] = useState(false);
  // Spike Three.js dietro flag esplicito ?three=1 - "off" per default (usa
  // InteractiveCard CSS come sempre). Passa a "on" solo se il flag e'
  // presente, prefers-reduced-motion non e' attivo e il browser supporta
  // davvero WebGL - controllo fatto in un effetto (richiede window/canvas,
  // non disponibile server-side). onContextLost riporta a "off" se il
  // contesto si perde dopo il mount (device sotto pressione di memoria):
  // questo componente non si auto-ripara, torna al fallback CSS.
  const [threeMode, setThreeMode] = useState<"off" | "on">("off");

  useEffect(() => {
    if (searchParams.get("three") !== "1") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) return;
    const frame = requestAnimationFrame(() => setThreeMode("on"));
    return () => cancelAnimationFrame(frame);
  }, [searchParams]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetchCardDetail(id).then((value) => { if (!cancelled) setCard(value); }).catch(() => { if (!cancelled) setCard(null); });
    fetchPriceHistory(id).then((value) => { if (!cancelled) setHistory(value); }).catch(() => {});
    fetchBestListings(id).then((value) => { if (!cancelled) setListings(value); }).catch(() => {});
    const frame = requestAnimationFrame(() => {
      setInBinder(getBinderIds().has(id));
      setInWishlist(getWishlistIds().has(id));
      // Il componente non viene rimontato passando da una carta all'altra
      // (stessa route dinamica) - senza reset qui, un errore di
      // caricamento sulla carta precedente resterebbe visibile anche per
      // la carta nuova finche' l'immagine non finisce di caricare/fallire
      // di nuovo.
      setImgError(false);
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [id]);

  // Prezzo piu' basso per lingua tra le migliori inserzioni gia' scaricate
  // (fetchBestListings): confronto "a colpo d'occhio", non un'analisi
  // esaustiva di ogni lingua sul mercato (solo le top 5 piu' economiche in
  // assoluto potrebbero non coprire tutte le lingue disponibili). Va prima
  // dei return condizionali qui sotto: gli hook non possono essere
  // condizionali.
  const cheapestByLanguage = useMemo(() => {
    const byLang = new Map<string, Listing>();
    for (const l of listings) {
      if (!l.language) continue;
      const current = byLang.get(l.language);
      if (!current || l.price_cents < current.price_cents) byLang.set(l.language, l);
    }
    return Array.from(byLang.values()).sort((a, b) => a.price_cents - b.price_cents);
  }, [listings]);

  const availableConditions = useMemo(() => {
    const order = ["Mint", "Near Mint", "Slightly Played", "Moderately Played", "Played", "Poor"];
    const set = new Set(listings.map((l) => l.condition).filter((c): c is string => !!c));
    return Array.from(set).sort((a, b) => {
      const ra = order.indexOf(a), rb = order.indexOf(b);
      return (ra === -1 ? order.length : ra) - (rb === -1 ? order.length : rb);
    });
  }, [listings]);

  // Filtro puramente visivo sulla lista "Migliori inserzioni" qui sotto: il
  // prezzo in evidenza sopra resta calcolato da card.best_price_cents (su
  // TUTTE le offerte), un filtro applicato qui non deve cambiarlo.
  const filteredListings = useMemo(() => {
    return listings.filter(
      (l) =>
        (selectedConditions.length === 0 || (l.condition && selectedConditions.includes(l.condition))) &&
        (!onlyZeroListings || l.can_sell_via_hub === 1)
    );
  }, [listings, selectedConditions, onlyZeroListings]);

  function handleToggleCondition(c: string) {
    setSelectedConditions((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  if (card === undefined) {
    return (
      <main className="max-w-6xl mx-auto px-5 sm:px-8 py-10">
        <SiteHeader compact />
        <div className="h-5 w-32 rounded bg-base-surface skeleton mb-8" />
        <div className="grid grid-cols-1 md:grid-cols-[minmax(300px,400px)_1fr] gap-8 lg:gap-12">
          <div className="skeleton rounded-card border border-base-border bg-base-surface aspect-[5/7]" />
          <div>
            <div className="h-3 w-24 rounded bg-base-surface skeleton" />
            <div className="h-9 w-64 max-w-full rounded bg-base-surface skeleton mt-3" />
            <div className="h-4 w-40 rounded bg-base-surface skeleton mt-3" />
            <div className="flex gap-2 mt-4">
              <div className="h-7 w-20 rounded-full bg-base-surface skeleton" />
              <div className="h-7 w-32 rounded-full bg-base-surface skeleton" />
            </div>
            <div className="grid grid-cols-2 gap-4 max-w-sm mt-6">
              <div className="h-20 rounded-card bg-base-surface skeleton" />
              <div className="h-20 rounded-card bg-base-surface skeleton" />
            </div>
            <div className="h-48 rounded-card bg-base-surface skeleton mt-8" />
          </div>
        </div>
      </main>
    );
  }

  if (card === null) {
    return (
      <main className="max-w-6xl mx-auto px-5 sm:px-8 py-10">
        <SiteHeader compact />
        <p className="text-ink-muted">Carta non trovata nel catalogo locale.</p>
        <Link href="/" className="text-accent hover:text-accent-bright mt-4 inline-block">
          ← Torna al catalogo
        </Link>
      </main>
    );
  }

  const currency = card.best_price_currency ?? card.latest_price_currency ?? "EUR";
  const trend = trendVsMovingAverage(history, card.best_price_cents ?? card.latest_price_cents, 30);

  // Su CardTrader il prezzo "consigliato" in evidenza e' quasi sempre
  // un'inserzione Near Mint + CardTrader Zero (spedizione gestita/
  // garantita), anche quando non e' l'assoluto piu' economico: un
  // venditore normale/una condizione peggiore batte solo se conviene
  // comunque, spedizione esclusa. Calcolato lato backend su TUTTE le
  // offerte scaricate (fino a 25), non solo sulle "migliori inserzioni"
  // salvate qui sotto — piu' accurato di scegliere tra quelle.
  const headlinePriceCents = card.best_price_cents ?? card.latest_price_cents;
  const headlineCurrency = card.best_price_currency ?? currency;
  const isZero = card.best_can_sell_via_hub === 1;
  const hasCheaperAbsolute =
    card.latest_price_cents !== null &&
    card.best_price_cents !== null &&
    card.latest_price_cents < card.best_price_cents;

  return (
    <main className="max-w-6xl mx-auto px-5 sm:px-8 py-10">
      <SiteHeader compact />
      <Link
        href={returnTo}
        className="text-sm text-ink-muted hover:text-accent-bright transition-colors inline-flex items-center gap-1.5 mb-8"
      >
        ← Torna indietro
      </Link>

      <div className="grid grid-cols-1 md:grid-cols-[minmax(300px,400px)_1fr] gap-8 lg:gap-12 card-enter">
        {threeMode === "on" && card.image_url && !imgError ? (
          <div className="w-full max-w-[400px] mx-auto md:mx-0 rounded-card border border-base-border bg-base-surface overflow-hidden self-start shadow-card">
            <div className="relative aspect-[5/7]">
              <ThreeCardHero
                imageUrl={card.image_url}
                alt={card.name}
                isPremium={card.is_premium === 1}
                reduceMotion={false}
                onFallback={() => setThreeMode("off")}
              />
            </div>
          </div>
        ) : (
          <InteractiveCard
            level="detail"
            reveal
            className="w-full max-w-[400px] mx-auto md:mx-0 bg-base-surface border border-base-border overflow-hidden self-start shadow-card"
          >
            <div className="relative aspect-[5/7] bg-base-surface2">
              {card.image_url && !imgError ? (
                <Image
                  src={card.image_url}
                  alt={card.name}
                  fill
                  sizes="(max-width: 767px) 90vw, 400px"
                  className="object-cover"
                  priority
                  onError={() => setImgError(true)}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-ink-faint text-xs font-mono text-center px-4">
                  {imgError ? "immagine non disponibile" : "nessuna immagine"}
                </div>
              )}
            </div>
          </InteractiveCard>
        )}

        <div>
          <div className="font-mono text-xs uppercase tracking-wider text-accent">
            {card.expansion_name}
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-ink-primary mt-1">
            {card.name}
          </h1>
          {card.version && (
            <div className="text-ink-muted text-sm mt-1">Versione: {card.version}</div>
          )}

          <div className="flex flex-wrap gap-2 mt-3 items-center">
            {card.is_premium === 1 && (
              <span className="text-[11px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-full bg-accent/10 border border-accent/40 text-accent-bright">
                premium
              </span>
            )}
            {card.rarity && (
              <span className="text-[11px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-full bg-base-surface2 border border-base-border text-ink-muted">
                {card.rarity}
              </span>
            )}
            <button
              onClick={() => {
                setInBinder(new Set(toggleBinder(id)).has(id));
                setPopping(true);
              }}
              onAnimationEnd={() => setPopping(false)}
              className={`text-[11px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-full border transition-colors active:scale-95 ${
                popping ? "pop-on-toggle" : ""
              } ${
                inBinder
                  ? "bg-accent/10 border-accent/60 text-accent-bright"
                  : "bg-base-surface2 border-base-border text-ink-muted hover:text-ink-primary"
              }`}
            >
              {inBinder ? "★ nel binder" : "☆ aggiungi al binder"}
            </button>
            <button
              onClick={() => {
                setInWishlist(new Set(toggleWishlist(id)).has(id));
                setPoppingWishlist(true);
              }}
              onAnimationEnd={() => setPoppingWishlist(false)}
              className={`text-[11px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-full border transition-colors active:scale-95 ${
                poppingWishlist ? "pop-on-toggle" : ""
              } ${
                inWishlist
                  ? "bg-accent/10 border-accent/60 text-accent-bright"
                  : "bg-base-surface2 border-base-border text-ink-muted hover:text-ink-primary"
              }`}
            >
              {inWishlist ? "♥ nella lista desideri" : "♡ aggiungi ai desideri"}
            </button>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4 max-w-sm">
            <div
              className={`rounded-card border p-4 ${
                isZero
                  ? "border-accent/50 bg-accent/10"
                  : "border-base-border bg-base-surface"
              }`}
            >
              <div
                className={`text-xs font-mono uppercase flex items-center gap-1.5 ${
                  isZero ? "text-accent" : "text-ink-faint"
                }`}
              >
                {isZero ? "CardTrader Zero" : "Prezzo migliore"}
                {card.best_condition && <ConditionBadge condition={card.best_condition} />}
              </div>
              <div
                className={`font-display text-2xl font-bold mt-1 ${
                  isZero ? "text-accent-bright" : "text-ink-primary"
                }`}
              >
                {formatCents(headlinePriceCents, headlineCurrency)}
              </div>
              {trend && (
                <div
                  className={`text-xs font-mono mt-1 ${
                    trend.deltaPct >= 0 ? "text-signal-up" : "text-signal-down"
                  }`}
                  title={`Media ${trend.days}gg: ${formatCents(trend.avgCents, currency)}`}
                >
                  {trend.deltaPct >= 0 ? "▲" : "▼"} {Math.abs(trend.deltaPct).toFixed(1)}% vs
                  media {trend.days}gg
                </div>
              )}
              {hasCheaperAbsolute && (
                <div className="text-xs font-mono text-ink-faint mt-1">
                  prezzo più basso in assoluto: {formatCents(card.latest_price_cents, card.latest_price_currency ?? currency)}
                  {listings[0]?.condition ? ` (${listings[0].condition})` : ""}
                </div>
              )}
            </div>
            <div className="rounded-card border border-base-border bg-base-surface p-4">
              <div className="text-xs font-mono text-ink-faint uppercase">Inserzioni attive</div>
              <div className="font-display text-2xl font-bold text-ink-primary mt-1">
                {card.latest_listings ?? "—"}
              </div>
            </div>
          </div>

          <div className="mt-8">
            <h2 className="font-display font-medium text-ink-primary mb-3">
              Andamento prezzo
            </h2>
            <PriceChart points={history} currency={currency} />
          </div>

          {cheapestByLanguage.length > 1 && (
            <div className="mt-8">
              <h2 className="font-display font-medium text-ink-primary mb-3">
                Confronto tra lingue
              </h2>
              <p className="text-xs text-ink-faint mb-3">
                Prezzo più basso per lingua tra le migliori inserzioni.
              </p>
              <div className="flex flex-wrap gap-2">
                {cheapestByLanguage.map((l) => (
                  <div
                    key={l.language}
                    className="flex items-center gap-2 rounded-card border border-base-border bg-base-surface px-3 py-2"
                  >
                    <span className="text-lg leading-none">{languageFlag(l.language)}</span>
                    <span className="font-mono text-sm text-ink-primary">
                      {formatCents(l.price_cents, l.price_currency ?? currency)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {listings.length > 0 && (
            <div className="mt-8">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                <h2 className="font-display font-medium text-ink-primary">
                  Migliori inserzioni
                </h2>
                <div className="flex items-center gap-4 flex-wrap">
                  <FilterDropdown
                    label="Condizione"
                    options={availableConditions}
                    selected={selectedConditions}
                    onToggle={handleToggleCondition}
                    renderOption={(c) => <ConditionBadge condition={c} />}
                  />
                  <button
                    type="button"
                    onClick={() => setOnlyZeroListings((v) => !v)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors active:scale-95 ${
                      onlyZeroListings
                        ? "bg-accent/10 border-accent/60 text-accent-bright"
                        : "bg-base-surface2 border-base-border text-ink-muted hover:text-ink-primary"
                    }`}
                  >
                    ⚡ Solo CardTrader Zero
                  </button>
                </div>
              </div>
              {filteredListings.length === 0 ? (
                <div className="text-ink-muted text-sm rounded-card border border-base-border bg-base-surface p-4">
                  Nessuna inserzione corrisponde ai filtri scelti.
                </div>
              ) : (
                <div className="rounded-card border border-base-border bg-base-surface divide-y divide-base-border overflow-hidden">
                  {filteredListings.map((l, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-lg leading-none" title="Lingua carta">
                          {languageFlag(l.language)}
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm text-ink-primary truncate">
                            {l.seller_username ?? "venditore"}
                            {l.ships_from_country && (
                              <span className="ml-1.5 text-xs" title={`Spedisce da ${l.ships_from_country}`}>
                                {countryFlag(l.ships_from_country)}
                              </span>
                            )}
                            {l.can_sell_via_hub === 1 && (
                              <span className="ml-2 text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-accent/10 border border-accent/40 text-accent-bright align-middle">
                                CardTrader Zero
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-ink-faint font-mono mt-0.5 flex items-center gap-1.5">
                            <ConditionBadge condition={l.condition} />
                            {l.quantity ? `x${l.quantity}` : ""}
                          </div>
                        </div>
                      </div>
                      <div className="font-mono text-sm text-ink-primary shrink-0">
                        {formatCents(l.price_cents, l.price_currency ?? currency)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <a
            href={`https://www.cardtrader.com/cards/${card.id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-block mt-6 text-sm text-accent hover:text-accent-bright transition-colors"
          >
            Apri su CardTrader ↗
          </a>
        </div>
      </div>
    </main>
  );
}

export default function CardDetailPage() {
  return (
    <Suspense fallback={null}>
      <CardDetailContent />
    </Suspense>
  );
}

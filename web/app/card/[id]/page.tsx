"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import {
  CardDetail, Listing, PricePoint,
  fetchBestListings, fetchCardDetail, fetchPriceHistory,
} from "@/lib/db";
import { getBinderIds, toggleBinder } from "@/lib/binder";
import HoloFrame from "@/components/HoloFrame";
import PriceChart from "@/components/PriceChart";
import { formatCents, languageFlag, trendVsMovingAverage } from "@/lib/format";

export default function CardDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);

  const [card, setCard] = useState<CardDetail | null | undefined>(undefined);
  const [history, setHistory] = useState<PricePoint[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [inBinder, setInBinder] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetchCardDetail(id).then(setCard);
    fetchPriceHistory(id).then(setHistory);
    fetchBestListings(id).then(setListings);
    setInBinder(getBinderIds().has(id));
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

  if (card === undefined) {
    return (
      <main className="max-w-5xl mx-auto px-5 sm:px-8 py-12">
        <div className="text-ink-muted font-mono text-sm animate-pulse">Carico…</div>
      </main>
    );
  }

  if (card === null) {
    return (
      <main className="max-w-5xl mx-auto px-5 sm:px-8 py-12">
        <p className="text-ink-muted">Carta non trovata nel catalogo locale.</p>
        <Link href="/" className="text-accent hover:text-accent-bright mt-4 inline-block">
          ← Torna al binder
        </Link>
      </main>
    );
  }

  const currency = card.latest_price_currency ?? "EUR";
  const trend = trendVsMovingAverage(history, card.latest_price_cents, 30);

  // Su CardTrader il prezzo "consigliato" in evidenza e' quasi sempre
  // un'inserzione CardTrader Zero (spedizione gestita/garantita), anche
  // quando non e' l'assoluto piu' economico: un venditore normale la batte
  // solo se il suo prezzo e' cosi' basso da convenire comunque, spedizione
  // esclusa. Replichiamo la stessa priorita' qui: se esiste una inserzione
  // Zero tra le migliori 5 gia' scaricate, e' quella la carta principale.
  const zeroListing = listings.find((l) => l.can_sell_via_hub === 1);
  const cheapestListing = listings[0];
  const headlineListing = zeroListing ?? cheapestListing;
  const headlinePriceCents = headlineListing?.price_cents ?? card.latest_price_cents;
  const headlineCurrency = headlineListing?.price_currency ?? currency;
  const hasCheaperNonZero =
    zeroListing && cheapestListing && cheapestListing.price_cents < zeroListing.price_cents;

  return (
    <main className="max-w-5xl mx-auto px-5 sm:px-8 py-12">
      <Link
        href="/"
        className="text-sm text-ink-muted hover:text-accent-bright transition-colors inline-flex items-center gap-1.5 mb-8"
      >
        ← Torna al binder
      </Link>

      <div className="grid md:grid-cols-[320px_1fr] gap-8 card-enter">
        <HoloFrame className="bg-base-surface border border-base-border overflow-hidden self-start">
          <div className="relative aspect-[5/7] bg-base-surface2">
            {card.image_url ? (
              <Image
                src={card.image_url}
                alt={card.name}
                fill
                sizes="320px"
                className="object-cover"
                priority
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-ink-faint text-xs font-mono">
                nessuna immagine
              </div>
            )}
          </div>
        </HoloFrame>

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
              onClick={() => setInBinder(new Set(toggleBinder(id)).has(id))}
              className={`text-[11px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-full border transition-colors active:scale-95 ${
                inBinder
                  ? "bg-accent/10 border-accent/60 text-accent-bright"
                  : "bg-base-surface2 border-base-border text-ink-muted hover:text-ink-primary"
              }`}
            >
              {inBinder ? "★ nel binder" : "☆ aggiungi al binder"}
            </button>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4 max-w-sm">
            <div
              className={`rounded-card border p-4 ${
                zeroListing
                  ? "border-accent/50 bg-accent/10"
                  : "border-base-border bg-base-surface"
              }`}
            >
              <div
                className={`text-xs font-mono uppercase flex items-center gap-1.5 ${
                  zeroListing ? "text-accent" : "text-ink-faint"
                }`}
              >
                {zeroListing ? "CardTrader Zero" : "Prezzo minimo"}
              </div>
              <div
                className={`font-display text-2xl font-bold mt-1 ${
                  zeroListing ? "text-accent-bright" : "text-ink-primary"
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
              {hasCheaperNonZero && (
                <div className="text-xs font-mono text-ink-faint mt-1">
                  senza Zero da {formatCents(cheapestListing.price_cents, cheapestListing.price_currency ?? currency)}
                  {" "}(+ spedizione)
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
              <h2 className="font-display font-medium text-ink-primary mb-3">
                Migliori inserzioni
              </h2>
              <div className="rounded-card border border-base-border bg-base-surface divide-y divide-base-border overflow-hidden">
                {listings.map((l, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-lg leading-none">{languageFlag(l.language)}</span>
                      <div className="min-w-0">
                        <div className="text-sm text-ink-primary truncate">
                          {l.seller_username ?? "venditore"}
                          {l.can_sell_via_hub === 1 && (
                            <span className="ml-2 text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-accent/10 border border-accent/40 text-accent-bright align-middle">
                              CardTrader Zero
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-ink-faint font-mono">
                          {l.condition ?? "—"}
                          {l.quantity ? ` · x${l.quantity}` : ""}
                        </div>
                      </div>
                    </div>
                    <div className="font-mono text-sm text-ink-primary shrink-0">
                      {formatCents(l.price_cents, l.price_currency ?? currency)}
                    </div>
                  </div>
                ))}
              </div>
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

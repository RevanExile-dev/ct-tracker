"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import { CardDetail, PricePoint, fetchCardDetail, fetchPriceHistory } from "@/lib/db";
import HoloFrame from "@/components/HoloFrame";
import PriceChart from "@/components/PriceChart";
import { formatCents } from "@/lib/format";

export default function CardDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);

  const [card, setCard] = useState<CardDetail | null | undefined>(undefined);
  const [history, setHistory] = useState<PricePoint[]>([]);

  useEffect(() => {
    if (!id) return;
    fetchCardDetail(id).then(setCard);
    fetchPriceHistory(id).then(setHistory);
  }, [id]);

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

  return (
    <main className="max-w-5xl mx-auto px-5 sm:px-8 py-12">
      <Link
        href="/"
        className="text-sm text-ink-muted hover:text-accent-bright transition-colors inline-flex items-center gap-1.5 mb-8"
      >
        ← Torna al binder
      </Link>

      <div className="grid md:grid-cols-[320px_1fr] gap-8">
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

          <div className="flex flex-wrap gap-2 mt-3">
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
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4 max-w-sm">
            <div className="rounded-card border border-base-border bg-base-surface p-4">
              <div className="text-xs font-mono text-ink-faint uppercase">Prezzo minimo</div>
              <div className="font-display text-2xl font-bold text-ink-primary mt-1">
                {formatCents(card.latest_price_cents, currency)}
              </div>
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

          <a
            href={`https://www.cardtrader.com/it/pokemon/blueprint/${card.id}`}
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

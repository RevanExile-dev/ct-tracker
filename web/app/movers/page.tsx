"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CardRow, fetchCards, fetchLanguages } from "@/lib/db";
import { getBinderIds, toggleBinder } from "@/lib/binder";
import { languageFlag, languageLabel, priceDeltaPct } from "@/lib/format";
import CardTile from "@/components/CardTile";
import SiteHeader from "@/components/SiteHeader";
import FilterDropdown from "@/components/FilterDropdown";

const MOVERS_LIMIT = 24;

function MoversSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 sm:gap-5">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="skeleton rounded-card border border-base-border bg-base-surface overflow-hidden"
          style={{ animationDelay: `${i * 80}ms` }}
        >
          <div className="aspect-[5/7] bg-base-surface2" />
          <div className="p-3 space-y-2">
            <div className="h-2.5 w-2/3 rounded bg-base-surface2" />
            <div className="h-3.5 w-4/5 rounded bg-base-surface2" />
            <div className="h-4 w-1/2 rounded bg-base-surface2 mt-3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Tiene solo le carte con una variazione di prezzo reale (prezzo attuale e
 * precedente entrambi noti), nell'ordine gia' deciso dalla query SQL. */
function withRealDelta(cards: CardRow[]): CardRow[] {
  return cards.filter((c) => priceDeltaPct(c.latest_price_cents, c.prev_price_cents) !== null);
}

export default function MoversPage() {
  const [rises, setRises] = useState<CardRow[] | null>(null);
  const [drops, setDrops] = useState<CardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [binderIds, setBinderIds] = useState<Set<number>>(new Set());
  const [languages, setLanguages] = useState<string[]>([]);
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);

  useEffect(() => {
    setBinderIds(getBinderIds());
    fetchLanguages().then(setLanguages).catch(() => {});
  }, []);

  useEffect(() => {
    setError(null);
    fetchCards({ sortBy: "rise_first", languages: selectedLanguages })
      .then((cards) => setRises(withRealDelta(cards).slice(0, MOVERS_LIMIT)))
      .catch((e) => setError(String(e.message ?? e)));
    fetchCards({ sortBy: "drop_first", languages: selectedLanguages })
      .then((cards) => setDrops(withRealDelta(cards).slice(0, MOVERS_LIMIT)))
      .catch((e) => setError(String(e.message ?? e)));
  }, [selectedLanguages]);

  function handleToggleBinderCard(id: number) {
    setBinderIds(new Set(toggleBinder(id)));
  }

  function handleToggleLanguage(l: string) {
    setSelectedLanguages((prev) =>
      prev.includes(l) ? prev.filter((x) => x !== l) : [...prev, l]
    );
  }

  return (
    <main className="max-w-7xl mx-auto px-5 sm:px-8 py-12">
      <SiteHeader compact />

      <Link
        href="/"
        className="text-sm text-ink-muted hover:text-accent-bright transition-colors inline-flex items-center gap-1.5 mb-8"
      >
        ← Torna al binder
      </Link>

      <h2 className="font-display text-2xl font-bold text-ink-primary">Carte in movimento</h2>
      <p className="text-ink-muted mt-1 max-w-xl">
        Le variazioni di prezzo più marcate registrate nell&apos;ultimo sync rispetto al
        precedente.
      </p>

      <div className="mt-4">
        <FilterDropdown
          label="Filtra per lingua"
          options={languages}
          selected={selectedLanguages}
          onToggle={handleToggleLanguage}
          renderOption={(l) => `${languageFlag(l)} ${languageLabel(l)}`}
        />
      </div>

      {error && (
        <div className="mt-8 rounded-card border border-signal-down/30 bg-signal-down/5 text-signal-down p-5 font-mono text-sm">
          {error}
        </div>
      )}

      {!error && (
        <div className="grid lg:grid-cols-2 gap-x-8 gap-y-12 mt-8">
          <section>
            <h3 className="font-display font-medium text-signal-up flex items-center gap-2 mb-4">
              ▲ Maggiori rialzi
            </h3>
            {rises === null && <MoversSkeleton />}
            {rises !== null && rises.length === 0 && (
              <div className="text-ink-muted text-sm">Nessun rialzo di prezzo registrato.</div>
            )}
            {rises !== null && rises.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 sm:gap-5">
                {rises.map((card, i) => (
                  <CardTile
                    key={card.id}
                    card={card}
                    index={i}
                    inBinder={binderIds.has(card.id)}
                    onToggleBinder={() => handleToggleBinderCard(card.id)}
                  />
                ))}
              </div>
            )}
          </section>

          <section>
            <h3 className="font-display font-medium text-signal-down flex items-center gap-2 mb-4">
              ▼ Maggiori cali
            </h3>
            {drops === null && <MoversSkeleton />}
            {drops !== null && drops.length === 0 && (
              <div className="text-ink-muted text-sm">Nessun calo di prezzo registrato.</div>
            )}
            {drops !== null && drops.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 sm:gap-5">
                {drops.map((card, i) => (
                  <CardTile
                    key={card.id}
                    card={card}
                    index={i}
                    inBinder={binderIds.has(card.id)}
                    onToggleBinder={() => handleToggleBinderCard(card.id)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

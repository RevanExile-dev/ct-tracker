"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { CardRow, fetchCards } from "@/lib/db";
import { getWishlistIds, toggleWishlist } from "@/lib/wishlist";
import { priceDeltaPct } from "@/lib/format";
import { useScrollRestoration } from "@/lib/useScrollRestoration";
import CardTile from "@/components/CardTile";
import SiteHeader from "@/components/SiteHeader";

function WishlistContent() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [cards, setCards] = useState<CardRow[] | null>(null);
  const [wishlistIds, setWishlistIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ids = getWishlistIds();
    const frame = requestAnimationFrame(() => setWishlistIds(ids));
    // Filtro SQL sugli ID salvati invece di scaricare l'intero catalogo per
    // poi tenerne solo una manciata in JS - stesso pattern del problema
    // principale trovato nell'audit (fetchCards senza limite sulla home).
    fetchCards({ ids: Array.from(ids) })
      .then((cards) => { if (!cancelled) setCards(cards); })
      .catch((reason) => { if (!cancelled) setError(String(reason?.message ?? reason)); });
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, []);

  // Chi tiene d'occhio una carta che non possiede ancora vuole vedere prima
  // di tutto quella che e' calata di piu': e' il momento migliore per
  // comprarla. Le carte senza una variazione valida (mai sincronizzate due
  // volte, o prezzo/prezzo-precedente a 0/mancante) restano in fondo.
  const sorted = useMemo(() => {
    if (!cards) return null;
    return [...cards].sort((a, b) => {
      const da = priceDeltaPct(a.best_price_cents ?? a.latest_price_cents, a.prev_best_price_cents ?? a.prev_price_cents);
      const db = priceDeltaPct(b.best_price_cents ?? b.latest_price_cents, b.prev_best_price_cents ?? b.prev_price_cents);
      if (da === null && db === null) return 0;
      if (da === null) return 1;
      if (db === null) return -1;
      return da - db;
    });
  }, [cards]);

  const currentQuery = searchParams.toString();
  const returnTo = currentQuery ? `${pathname}?${currentQuery}` : pathname;
  useScrollRestoration("wishlist", cards !== null || error !== null, returnTo);

  function handleRemove(id: number) {
    setWishlistIds(new Set(toggleWishlist(id)));
    setCards((current) => current?.filter((c) => c.id !== id) ?? current);
  }

  const dropsCount = useMemo(() => {
    if (!sorted) return 0;
    return sorted.filter((c) => {
      const d = priceDeltaPct(c.best_price_cents ?? c.latest_price_cents, c.prev_best_price_cents ?? c.prev_price_cents);
      return d !== null && d < 0;
    }).length;
  }, [sorted]);

  return (
    <main className="max-w-7xl mx-auto px-5 sm:px-8 py-12">
      <SiteHeader compact />

      <Link
        href="/"
        className="text-sm text-ink-muted hover:text-accent-bright transition-colors inline-flex items-center gap-1.5 mb-8"
      >
        ← Torna al catalogo
      </Link>

      <h1 className="font-display text-2xl sm:text-3xl font-bold text-ink-primary">
        ♡ Lista desideri
      </h1>
      <p className="text-ink-muted mt-1 max-w-xl">
        Carte che non hai ancora ma vuoi tenere d&apos;occhio, ordinate dal calo di prezzo più
        marcato — il momento migliore per comprarle. Aggiungile dalla scheda di una carta.
      </p>

      {sorted && sorted.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-card border border-base-border bg-base-surface px-5 py-4">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-wider text-ink-faint">Carte in lista</div>
            <div className="font-display text-xl font-bold text-ink-primary">{sorted.length}</div>
          </div>
          {dropsCount > 0 && (
            <div>
              <div className="text-[11px] font-mono uppercase tracking-wider text-ink-faint">In calo</div>
              <div className="font-display text-xl font-bold text-signal-down">▼ {dropsCount}</div>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mt-8 rounded-card border border-signal-down/30 bg-signal-down/5 text-signal-down p-5 font-mono text-sm">
          {error}
        </div>
      )}

      {cards === null && !error && (
        <div className="mt-16 text-center text-ink-muted font-mono text-sm">Carico la lista desideri…</div>
      )}

      {sorted && sorted.length === 0 && (
        <div className="mt-16 text-center text-ink-muted">
          La lista desideri è vuota. Apri una carta e tocca &quot;♡ aggiungi ai desideri&quot;.
        </div>
      )}

      {sorted && sorted.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 sm:gap-5 mt-8">
          {sorted.map((card, i) => (
            <CardTile
              key={card.id}
              card={card}
              index={i}
              inWishlist={wishlistIds.has(card.id)}
              onToggleWishlist={() => handleRemove(card.id)}
              returnTo={returnTo}
            />
          ))}
        </div>
      )}
    </main>
  );
}

export default function WishlistPage() {
  return (
    <Suspense fallback={null}>
      <WishlistContent />
    </Suspense>
  );
}

"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CardRow, fetchCards } from "@/lib/db";
import { getBinderIds, toggleBinder } from "@/lib/binder";
import { formatCents } from "@/lib/format";
import { useScrollRestoration } from "@/lib/useScrollRestoration";
import BinderBook from "@/components/BinderBook";
import BinderTable from "@/components/BinderTable";
import CardTile from "@/components/CardTile";
import SiteHeader from "@/components/SiteHeader";

function BinderContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = searchParams.get("view") === "book" ? "book" : "collection";
  const layout = searchParams.get("layout") === "table" ? "table" : "grid";
  const initialPage = Math.max(0, Number(searchParams.get("page")) || 0);
  const [cards, setCards] = useState<CardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const binderIds = getBinderIds();
    fetchCards({})
      .then((all) => { if (!cancelled) setCards(all.filter((card) => binderIds.has(card.id))); })
      .catch((reason) => { if (!cancelled) setError(String(reason?.message ?? reason)); });
    return () => { cancelled = true; };
  }, []);

  const summary = useMemo(() => {
    if (!cards) return null;
    const priced = cards.filter((card) => (card.best_price_cents ?? card.latest_price_cents) !== null);
    return {
      total: priced.reduce((sum, card) => sum + (card.best_price_cents ?? card.latest_price_cents ?? 0), 0),
      priced: priced.length,
      currency: priced[0]?.best_price_currency ?? priced[0]?.latest_price_currency ?? "EUR",
    };
  }, [cards]);

  const setBookPage = useCallback((page: number) => {
    const params = new URLSearchParams(window.location.search);
    params.set("view", "book");
    if (page > 0) params.set("page", String(page)); else params.delete("page");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pathname, router]);

  const query = searchParams.toString();
  const returnTo = query ? `${pathname}?${query}` : pathname;
  useScrollRestoration("binder", cards !== null || error !== null, returnTo);

  function removeFromBinder(id: number) {
    toggleBinder(id);
    setCards((current) => current?.filter((card) => card.id !== id) ?? current);
  }

  return (
    <main className="binder-shell mx-auto w-full max-w-[1600px] px-4 sm:px-8 py-8 sm:py-10">
      <SiteHeader compact />
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-5 mb-6">
        <div>
          <Link href="/" className="text-sm text-ink-muted hover:text-accent-bright transition-colors inline-flex items-center gap-1.5 mb-4">← Catalogo</Link>
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-ink-primary">Il mio Binder</h1>
          <p className="text-ink-muted mt-1">La stessa collezione, da consultare o da sfogliare come un album.</p>
        </div>
        <nav className="binder-view-switch inline-flex self-start rounded-xl border border-base-border bg-base-surface p-1" aria-label="Modalita' Binder">
          <Link href="/binder?view=collection" aria-current={view === "collection" ? "page" : undefined} className={`min-h-11 inline-flex items-center rounded-lg px-4 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 ${view === "collection" ? "bg-accent/15 text-accent-bright shadow-sm" : "text-ink-muted hover:text-ink-primary"}`}>▦ Collezione</Link>
          <Link href="/binder?view=book" aria-current={view === "book" ? "page" : undefined} className={`min-h-11 inline-flex items-center rounded-lg px-4 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 ${view === "book" ? "bg-accent/15 text-accent-bright shadow-sm" : "text-ink-muted hover:text-ink-primary"}`}>◫ Sfoglia Binder</Link>
        </nav>
      </div>

      {summary && cards && cards.length > 0 && (
        <div className="mb-7 flex flex-wrap items-center gap-x-8 gap-y-3 rounded-card border border-base-border bg-base-surface/70 px-5 py-4">
          <div><div className="text-[11px] font-mono uppercase tracking-wider text-ink-faint">Carte</div><div className="font-display text-xl font-bold">{cards.length}</div></div>
          <div><div className="text-[11px] font-mono uppercase tracking-wider text-ink-faint">Valore stimato</div><div className="font-display text-xl font-bold text-accent-bright">{formatCents(summary.total, summary.currency)}</div></div>
          {summary.priced < cards.length && <span className="text-xs text-ink-faint">{summary.priced}/{cards.length} con prezzo</span>}
          {view === "collection" && (
            <div className="ml-auto inline-flex rounded-lg border border-base-border bg-base-surface2 p-1">
              <Link href="/binder?view=collection" className={`min-h-9 inline-flex items-center rounded-md px-3 text-xs ${layout === "grid" ? "bg-accent/15 text-accent-bright" : "text-ink-muted"}`}>Griglia</Link>
              <Link href="/binder?view=collection&layout=table" className={`min-h-9 inline-flex items-center rounded-md px-3 text-xs ${layout === "table" ? "bg-accent/15 text-accent-bright" : "text-ink-muted"}`}>Tabella</Link>
            </div>
          )}
        </div>
      )}

      {cards === null && !error && <div className="py-20 text-center text-sm font-mono text-ink-muted animate-pulse">Carico la collezione…</div>}
      {error && <div className="rounded-card border border-signal-down/30 bg-signal-down/5 p-5 text-signal-down">{error}</div>}
      {cards && cards.length === 0 && <div className="rounded-card border border-base-border bg-base-surface/60 py-20 px-5 text-center text-ink-muted">Il Binder è ancora vuoto. Dal catalogo usa la stella su una carta per aggiungerla.</div>}

      {cards && cards.length > 0 && view === "collection" && (
        layout === "table" ? <BinderTable cards={cards} returnTo={returnTo} /> : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-6">
            {cards.map((card, index) => <CardTile key={card.id} card={card} index={index} inBinder onToggleBinder={() => removeFromBinder(card.id)} returnTo={returnTo} />)}
          </div>
        )
      )}
      {cards && cards.length > 0 && view === "book" && <BinderBook cards={cards} initialPage={initialPage} onPageChange={setBookPage} returnTo={returnTo} />}
    </main>
  );
}

export default function BinderPage() {
  return <Suspense fallback={null}><BinderContent /></Suspense>;
}

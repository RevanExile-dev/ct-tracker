"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CardRow, fetchCards } from "@/lib/db";
import { getBinderIds } from "@/lib/binder";
import BinderBook from "@/components/BinderBook";

/**
 * Prototipo: simulazione di un binder fisico con pagine sfogliabili in 3D.
 * Pagina volutamente NON collegata dalla navigazione principale (nessun
 * link da SiteHeader) mentre si valuta se tenerla — raggiungibile solo
 * navigando direttamente a /binder-book.
 */
export default function BinderBookPage() {
  const [cards, setCards] = useState<CardRow[] | null>(null);

  useEffect(() => {
    const binderIds = getBinderIds();
    fetchCards({})
      .then((all) => setCards(all.filter((c) => binderIds.has(c.id))))
      .catch(() => setCards([]));
  }, []);

  return (
    <main className="max-w-4xl mx-auto px-5 sm:px-8 py-12">
      <Link
        href="/"
        className="text-sm text-ink-muted hover:text-accent-bright transition-colors inline-flex items-center gap-1.5 mb-6"
      >
        ← Torna al binder
      </Link>

      <div className="mb-6 rounded-card border border-accent/30 bg-accent/5 px-4 py-2.5 text-xs font-mono text-ink-muted">
        🧪 Prototipo interno — non ancora nella navigazione principale. Sfoglia le pagine con i
        pulsanti qui sotto.
      </div>

      <h1 className="font-display text-2xl font-bold text-ink-primary mb-6">
        Il mio binder — vista sfogliabile
      </h1>

      {cards === null && (
        <div className="text-ink-muted font-mono text-sm animate-pulse text-center py-16">
          Carico…
        </div>
      )}

      {cards !== null && cards.length === 0 && (
        <div className="text-center text-ink-muted py-16">
          Il tuo binder è vuoto. Apri una carta e tocca &quot;Aggiungi al binder&quot;, poi torna
          qui.
        </div>
      )}

      {cards !== null && cards.length > 0 && <BinderBook cards={cards} />}
    </main>
  );
}

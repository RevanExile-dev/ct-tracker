"use client";

import Link from "next/link";
import { formatDateLong } from "@/lib/format";

export default function SiteHeader({ lastSync }: { lastSync?: string }) {
  return (
    <header className="mb-10">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-baseline gap-3 flex-wrap">
            <Link href="/">
              <h1 className="font-display text-3xl sm:text-4xl font-bold text-ink-primary">
                Binder
              </h1>
            </Link>
            <span className="font-mono text-xs uppercase tracking-widest text-accent">
              CardTrader Tracker
            </span>
          </div>
          <p className="text-ink-muted mt-2 max-w-xl">
            Catalogo, prezzi e andamento storico delle carte Pokémon TCG tracciate — dati
            aggiornati automaticamente ogni giorno da CardTrader.
          </p>
          {lastSync && (
            <p className="text-xs font-mono text-ink-faint mt-3">
              Ultimo aggiornamento prezzi: {formatDateLong(lastSync)}
            </p>
          )}
        </div>

        <Link
          href="/movers"
          className="whitespace-nowrap text-sm px-4 py-2.5 rounded-card border border-base-border bg-base-surface text-ink-muted hover:text-ink-primary hover:border-accent/60 transition-colors active:scale-95"
        >
          📈 Carte in movimento
        </Link>
      </div>
    </header>
  );
}

"use client";

import { formatDateLong } from "@/lib/format";

export default function SiteHeader({ lastSync }: { lastSync?: string }) {
  return (
    <header className="mb-10">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="font-display text-3xl sm:text-4xl font-bold text-ink-primary">
          Binder
        </h1>
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
    </header>
  );
}

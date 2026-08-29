"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatDateLong } from "@/lib/format";
import CountUp from "./CountUp";

/** compact: usato nelle pagine secondarie (carte in movimento, dettaglio
 * carta) dove il sottotitolo lungo e' solo rumore ripetuto — qui si vede
 * solo il logo, per non buttare via meta' schermo di scroll su mobile
 * prima di arrivare al contenuto vero. */
export default function SiteHeader({
  lastSync,
  compact = false,
  totalCards,
}: {
  lastSync?: string;
  compact?: boolean;
  totalCards?: number;
}) {
  const pathname = usePathname();
  const onMovers = pathname === "/movers";

  return (
    <header className={compact ? "mb-6" : "mb-6 sm:mb-10"}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-baseline gap-3 flex-wrap">
            <Link href="/">
              <h1
                className={`font-display font-bold text-holo ${
                  compact ? "text-2xl" : "text-3xl sm:text-4xl"
                }`}
              >
                CartaViva
              </h1>
            </Link>
            <span className="font-mono text-xs uppercase tracking-widest text-accent">
              CardTrader Tracker
            </span>
          </div>
          {!compact && (
            <>
              <p className="text-ink-muted mt-2 max-w-xl">
                Catalogo, prezzi e andamento storico di{" "}
                {totalCards ? (
                  <span className="text-ink-primary font-medium">
                    <CountUp value={totalCards} format={(n) => Math.round(n).toLocaleString("it-IT")} />
                    {" "}carte
                  </span>
                ) : (
                  "carte"
                )}{" "}
                Pokémon TCG tracciate — dati aggiornati automaticamente ogni giorno da CardTrader.
              </p>
              {lastSync && (
                <p className="text-xs font-mono text-ink-faint mt-3">
                  Ultimo aggiornamento prezzi: {formatDateLong(lastSync)}
                </p>
              )}
            </>
          )}
        </div>

        {!onMovers && (
          <Link
            href="/movers"
            className="btn-lift whitespace-nowrap text-sm px-4 py-2.5 rounded-card border border-base-border bg-base-surface text-ink-muted hover:text-ink-primary hover:border-accent/60 transition-colors active:scale-95"
          >
            📈 Carte in movimento
          </Link>
        )}
      </div>
    </header>
  );
}

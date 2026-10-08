"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatDateLong } from "@/lib/format";
import CountUp from "./CountUp";
import BrandLogo from "./BrandLogo";
import UserMenu from "./UserMenu";

/** compact: usato nelle pagine secondarie (carte in movimento, dettaglio
 * carta) dove il sottotitolo lungo e' solo rumore ripetuto — qui si vede
 * solo il logo, per non buttare via meta' schermo di scroll su mobile
 * prima di arrivare al contenuto vero. */
export default function SiteHeader({
  lastSync,
  compact = false,
  totalCards,
  onLogoClick,
}: {
  lastSync?: string;
  compact?: boolean;
  totalCards?: number;
  /** Se presente ed e' gia' sulla home, azzera i filtri invece di affidarsi
   * alla navigazione: un <Link href="/"> da solo e' un no-op quando si e'
   * gia' su "/" (nessun remount, i filtri vivono in useState locale). */
  onLogoClick?: () => void;
}) {
  const pathname = usePathname();
  const onMovers = pathname === "/movers";
  const onHome = pathname === "/";
  const onBinder = pathname.startsWith("/binder");
  const onWishlist = pathname === "/wishlist";
  const onScanner = pathname === "/scan";
  const onLots = pathname.startsWith("/lots");

  return (
    <header className={compact ? "mb-6" : "mb-6 sm:mb-10"}>
      <a
        href="#contenuto"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-card focus:bg-base-surface focus:px-4 focus:py-2.5 focus:text-sm focus:text-accent-bright focus:ring-2 focus:ring-accent/70 focus:outline-none"
      >
        Vai al contenuto
      </a>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <Link
              href="/"
              className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
              onClick={(e) => {
                if (onHome && onLogoClick) {
                  e.preventDefault();
                  onLogoClick();
                }
              }}
            >
              <BrandLogo compact={compact} />
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

        <nav aria-label="Sezioni del sito" className="flex gap-2 flex-wrap">
          {!onScanner && (
            <Link
              href="/scan"
              className="btn-lift whitespace-nowrap text-sm px-4 py-2.5 rounded-card border border-accent/30 bg-accent/10 text-accent-bright hover:border-accent/60 hover:bg-accent/15 transition-colors active:scale-95"
            >
              ✦ Scanner
            </Link>
          )}
          {!onMovers && (
            <Link
              href="/movers"
              className="btn-lift whitespace-nowrap text-sm px-4 py-2.5 rounded-card border border-base-border bg-base-surface text-ink-muted hover:text-ink-primary hover:border-accent/60 transition-colors active:scale-95"
            >
              📈 Carte in movimento
            </Link>
          )}
          {!onBinder && (
            <Link
              href="/binder?view=collection"
              className="btn-lift whitespace-nowrap text-sm px-4 py-2.5 rounded-card border border-base-border bg-base-surface text-ink-muted hover:text-ink-primary hover:border-accent/60 transition-colors active:scale-95"
            >
              📚 Binder
            </Link>
          )}
          {!onWishlist && (
            <Link
              href="/wishlist"
              className="btn-lift whitespace-nowrap text-sm px-4 py-2.5 rounded-card border border-base-border bg-base-surface text-ink-muted hover:text-ink-primary hover:border-accent/60 transition-colors active:scale-95"
            >
              ♡ Desideri
            </Link>
          )}
          {!onLots && (
            <Link
              href="/lots"
              className="btn-lift whitespace-nowrap text-sm px-4 py-2.5 rounded-card border border-base-border bg-base-surface text-ink-muted hover:text-ink-primary hover:border-accent/60 transition-colors active:scale-95"
            >
              🧾 Lotti
            </Link>
          )}
          <UserMenu />
        </nav>
      </div>
      <span id="contenuto" tabIndex={-1} className="block outline-none" />
    </header>
  );
}

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
                  <>
                    {/* Segnaposto invisibile con la larghezza del numero vero: senza,
                        il testo si allunga quando arriva il totale e puo' andare a
                        capo, spostando tutta la pagina sotto. */}
                    <span aria-hidden className="invisible">00.000</span>{" "}carte
                  </>
                )}{" "}
                Pokémon TCG tracciate — dati aggiornati automaticamente ogni giorno da CardTrader.
              </p>
              {/* Riga sempre presente (min-h-4): la data arriva da una chiamata
                  e, aggiunta dopo, spingerebbe in basso filtri e carte. */}
              <p className="text-xs font-mono text-ink-faint mt-3 min-h-4">
                {lastSync ? `Ultimo aggiornamento prezzi: ${formatDateLong(lastSync)}` : null}
              </p>
            </>
          )}
        </div>

        <div className="flex gap-2 flex-wrap">
          {!onScanner && (
            <Link
              href="/scan"
              className="btn-lift whitespace-nowrap text-sm px-3 sm:px-4 min-h-11 inline-flex items-center rounded-card border border-accent/30 bg-accent/10 text-accent-bright hover:border-accent/60 hover:bg-accent/15 transition-colors active:scale-95"
            >
              ✦ Scanner
            </Link>
          )}
          {!onMovers && (
            <Link
              href="/movers"
              aria-label="Carte in movimento"
              className="btn-lift whitespace-nowrap text-sm px-3 sm:px-4 min-h-11 inline-flex items-center rounded-card border border-base-border bg-base-surface text-ink-muted hover:text-ink-primary hover:border-accent/60 transition-colors active:scale-95"
            >
              📈{" "}<span className="sm:hidden">Movimenti</span><span className="hidden sm:inline">Carte in movimento</span>
            </Link>
          )}
          {!onBinder && (
            <Link
              href="/binder?view=collection"
              className="btn-lift whitespace-nowrap text-sm px-3 sm:px-4 min-h-11 inline-flex items-center rounded-card border border-base-border bg-base-surface text-ink-muted hover:text-ink-primary hover:border-accent/60 transition-colors active:scale-95"
            >
              📚 Binder
            </Link>
          )}
          {!onWishlist && (
            <Link
              href="/wishlist"
              className="btn-lift whitespace-nowrap text-sm px-3 sm:px-4 min-h-11 inline-flex items-center rounded-card border border-base-border bg-base-surface text-ink-muted hover:text-ink-primary hover:border-accent/60 transition-colors active:scale-95"
            >
              ♡ Desideri
            </Link>
          )}
          {!onLots && (
            <Link
              href="/lots"
              className="btn-lift whitespace-nowrap text-sm px-3 sm:px-4 min-h-11 inline-flex items-center rounded-card border border-base-border bg-base-surface text-ink-muted hover:text-ink-primary hover:border-accent/60 transition-colors active:scale-95"
            >
              🧾 Lotti
            </Link>
          )}
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

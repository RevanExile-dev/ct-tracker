"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { CardRow, fetchCards } from "@/lib/db";
import { getWishlistIds, toggleWishlist } from "@/lib/wishlist";
import { formatCents, priceDeltaPct } from "@/lib/format";
import { useScrollRestoration } from "@/lib/useScrollRestoration";
import CardTile from "@/components/CardTile";
import { wishlistTarget, type AlertStatusInput } from "@/lib/alertStatus";
import QuickAlertModal from "@/components/QuickAlertModal";
import LoadError from "@/components/LoadError";
import SiteHeader from "@/components/SiteHeader";
import ShareLinkPanel from "@/components/ShareLinkPanel";

function WishlistContent() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [cards, setCards] = useState<CardRow[] | null>(null);
  const [wishlistIds, setWishlistIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const { data: session } = useSession();
  // Carte della lista che hanno gia' un allarme (null = non lo so, ad es.
  // non loggato o richiesta fallita: in quel caso niente campanelle).
  const [alertIds, setAlertIds] = useState<Set<number> | null>(null);
  const [alertList, setAlertList] = useState<(AlertStatusInput & { blueprintId: number })[]>([]);
  const [alertCard, setAlertCard] = useState<CardRow | null>(null);
  const loggedIn = Boolean(session);

  const [alertsTick, setAlertsTick] = useState(0);
  useEffect(() => {
    if (!loggedIn) return;
    let cancelled = false;
    fetch("/api/account/alerts")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((alerts: (AlertStatusInput & { blueprintId: number })[]) => {
        if (!cancelled) setAlertList(alerts);
        if (!cancelled) setAlertIds(new Set(alerts.filter((a) => a.state !== "disabled").map((a) => a.blueprintId)));
      })
      .catch(() => { if (!cancelled) setAlertIds(null); });
    return () => { cancelled = true; };
  }, [loggedIn, alertsTick]);

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
  }, [reloadTick]);

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

  // useCallback: CardTile e' memo (vedi components/CardTile.tsx), un
  // riferimento stabile evita di ri-renderizzare l'intera lista ad ogni
  // singola rimozione.
  const handleRemove = useCallback((card: CardRow) => {
    setWishlistIds(new Set(toggleWishlist(card.id)));
    setCards((current) => current?.filter((c) => c.id !== card.id) ?? current);
  }, []);

  const handleCreateAlert = useCallback((card: CardRow) => setAlertCard(card), []);
  const targets = useMemo(() => {
    const byCard = new Map<number, (AlertStatusInput & { blueprintId: number })[]>();
    for (const a of alertList) byCard.set(a.blueprintId, [...(byCard.get(a.blueprintId) ?? []), a]);
    const out = new Map<number, ReturnType<typeof wishlistTarget>>();
    for (const [id, list] of byCard) out.set(id, wishlistTarget(list, formatCents));
    return out;
  }, [alertList]);
  const withoutAlert = alertIds && sorted ? sorted.filter((c) => !alertIds.has(c.id)).length : 0;

  const dropsCount = useMemo(() => {
    if (!sorted) return 0;
    return sorted.filter((c) => {
      const d = priceDeltaPct(c.best_price_cents ?? c.latest_price_cents, c.prev_best_price_cents ?? c.prev_price_cents);
      return d !== null && d < 0;
    }).length;
  }, [sorted]);

  // Quanto costa comprare tutta la lista adesso (stesso prezzo mostrato sulle
  // carte); le carte senza prezzo non entrano nel totale e vengono contate.
  const totals = useMemo(() => {
    let cents = 0;
    let missing = 0;
    for (const c of sorted ?? []) {
      const p = c.best_price_cents ?? c.latest_price_cents;
      if (p && p > 0) cents += p;
      else missing += 1;
    }
    return { cents, missing };
  }, [sorted]);

  return (
    <main className="max-w-7xl mx-auto px-5 sm:px-8 py-12">
      <SiteHeader compact />

      <Link
        href="/"
        className="text-sm text-ink-muted hover:text-accent-bright transition-colors inline-flex items-center gap-1.5 min-h-11 md:min-h-9 mb-4 md:mb-8"
      >
        ← Torna al catalogo
      </Link>

      <h1 className="font-display text-2xl sm:text-3xl font-bold text-ink-primary">
        ♡ Lista desideri
      </h1>
      <p className="text-ink-muted mt-1 max-w-xl">
        Carte che non hai ancora ma vuoi tenere d&apos;occhio, con in cima quelle scese di più:
        il momento migliore per comprarle. Aggiungile dalla scheda di una carta.
      </p>

      {sorted && sorted.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-card border border-base-border bg-base-surface px-5 py-4">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-wider text-ink-faint">Carte in lista</div>
            <div className="font-display text-xl font-bold text-ink-primary">{sorted.length}</div>
          </div>
          <div>
            <div className="text-[11px] font-mono uppercase tracking-wider text-ink-faint">Totale oggi</div>
            <div className="font-display text-xl font-bold text-ink-primary" data-testid="wishlist-total">
              {formatCents(totals.cents)}
            </div>
            {totals.missing > 0 && (
              <div className="text-[11px] text-ink-faint">
                {totals.missing} {totals.missing === 1 ? "carta senza prezzo non inclusa" : "carte senza prezzo non incluse"}
              </div>
            )}
          </div>
          {alertIds && (
            <div>
              <div className="text-[11px] font-mono uppercase tracking-wider text-ink-faint">Senza allarme</div>
              <div className="font-display text-xl font-bold text-ink-primary" data-testid="wishlist-no-alert">{withoutAlert}</div>
            </div>
          )}
          <div>
            <div className="text-[11px] font-mono uppercase tracking-wider text-ink-faint">In ribasso</div>
            <div
              className={`font-display text-xl font-bold ${dropsCount > 0 ? "text-signal-down" : "text-ink-muted"}`}
              data-testid="wishlist-drops"
            >
              {dropsCount > 0 ? `▼ ${dropsCount}` : "nessuna"}
            </div>
            {dropsCount === 0 && (
              <div className="text-[11px] text-ink-faint">in cima quelle che salgono meno</div>
            )}
          </div>
        </div>
      )}

      {sorted && sorted.length > 0 && <div className="mt-5"><ShareLinkPanel kind="wishlist" /></div>}

      {error && (
        <LoadError
          title="Non riesco a caricare la lista desideri."
          detail={error}
          onRetry={() => { setError(null); setCards(null); setReloadTick((t) => t + 1); }}
        />
      )}

      {cards === null && !error && (
        <div className="mt-16 text-center text-ink-muted font-mono text-sm">Carico la lista desideri…</div>
      )}

      {sorted && sorted.length === 0 && (
        <div className="mt-16 text-center text-ink-muted">
          <p>
            La lista desideri è vuota. Nel catalogo tocca il cuore <span aria-hidden>♡</span> su una carta:
            la trovi qui, con il prezzo che segue giorno per giorno.
          </p>
          <Link
            href="/"
            className="btn-lift mt-5 inline-flex items-center min-h-11 px-4 text-sm rounded-card border border-accent/30 bg-accent/10 text-accent-bright hover:border-accent/60 transition-colors"
          >
            Cerca una carta nel catalogo
          </Link>
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
              onToggleWishlist={handleRemove}
              returnTo={returnTo}
              hasAlert={alertIds ? alertIds.has(card.id) : undefined}
              alertTarget={targets.get(card.id) ?? null}
              onCreateAlert={alertIds ? handleCreateAlert : undefined}
            />
          ))}
        </div>
      )}
      {alertCard && (
        <QuickAlertModal
          card={alertCard}
          onClose={() => setAlertCard(null)}
          onCreated={() => {
            setAlertIds((cur) => new Set(cur).add(alertCard.id));
            setAlertsTick((n) => n + 1);
          }}
        />
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

"use client";

import { buyVerdict, compareListings } from "@/lib/buyNow";
import { zeroHubShipping, ZERO_HUB_CHECKED_AT } from "@/lib/cardmarketShipping";
import { countryFlag, formatCents, formatPercent, languageFlag } from "@/lib/format";
import type { Listing, PricePoint } from "@/lib/types";

const VERDICT_TEXT = {
  good: { title: "Buon momento per comprare", cls: "text-signal-up" },
  near: { title: "Prezzo vicino al minimo", cls: "text-ink-primary" },
  wait: { title: "Forse conviene aspettare", cls: "text-signal-down" },
} as const;

/** "Conviene comprare ora?": prezzo attuale contro il minimo di 30 giorni e le
 * migliori inserzioni dell'UE per prezzo totale stimato. Usa solo dati gia'
 * caricati dalla scheda. Il prezzo vecchio (> 1 settimana) non da' verdetto. */
export default function BuyNowBox({
  history, listings, currentCents, currency, stale,
}: {
  history: PricePoint[];
  listings: Listing[];
  currentCents: number | null;
  currency: string;
  stale: boolean;
}) {
  const verdict = stale ? null : buyVerdict(history, currentCents, 30);
  const hub = zeroHubShipping(1);
  const cmp = compareListings(listings, hub?.cents ?? null, 3);
  if (!verdict && cmp.ranked.length === 0 && !cmp.cheaperNoHub) return null;

  return (
    <section className="mt-8 rounded-card border border-base-border bg-base-surface p-4" data-testid="buy-now">
      <h2 className="font-display font-medium text-ink-primary">Conviene comprare ora?</h2>
      {verdict ? (
        <div className="mt-2" data-testid="buy-now-verdict" data-tone={verdict.tone}>
          <div className={`text-sm font-medium ${VERDICT_TEXT[verdict.tone].cls}`}>{VERDICT_TEXT[verdict.tone].title}</div>
          <div className="text-xs font-mono text-ink-muted mt-0.5">
            {verdict.abovePct < 0.5
              ? `È il minimo degli ultimi ${verdict.days} giorni`
              : `${formatPercent(verdict.abovePct, 0)} sopra il minimo degli ultimi ${verdict.days} giorni (${formatCents(verdict.minCents, currency)})`}
          </div>
        </div>
      ) : (
        <p className="text-xs text-ink-faint mt-2" data-testid="buy-now-no-verdict">
          {stale
            ? "Prezzo non aggiornato da una settimana: per ora nessun verdetto."
            : "Storico ancora troppo corto per confrontare con il minimo di 30 giorni."}
        </p>
      )}

      {cmp.ranked.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-mono text-ink-faint uppercase">Migliori offerte in UE, prezzo totale stimato</div>
          <ol className="mt-2 divide-y divide-base-border rounded-card border border-base-border overflow-hidden" data-testid="buy-now-ranked">
            {cmp.ranked.map(({ listing: l, totalCents, shippingCents }, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0 text-sm text-ink-primary">
                  {languageFlag(l.language)} {l.seller_username ?? "venditore"}
                  {l.ships_from_country && <span className="ml-1.5 text-xs">{countryFlag(l.ships_from_country)}</span>}
                  <div className="text-xs font-mono text-ink-faint break-words">
                    {l.condition ?? "—"} · {formatCents(l.price_cents, currency)} + {formatCents(shippingCents, currency)} spedizione
                  </div>
                </div>
                <div className="font-mono text-sm font-medium text-ink-primary shrink-0">{formatCents(totalCents, currency)}</div>
              </li>
            ))}
          </ol>
          <p className="text-[11px] text-ink-faint mt-2">
            Solo CardTrader Zero: spedizione dall&apos;hub verso l&apos;Italia, {hub ? formatCents(hub.cents, currency) : ""} per ordine
            (tariffa letta il {ZERO_HUB_CHECKED_AT}). Con più carte nello stesso ordine si divide.
          </p>
        </div>
      )}

      {cmp.cheaperNoHub && (
        <p className="text-xs text-ink-muted mt-3" data-testid="buy-now-nohub">
          {cmp.ranked.length > 0 ? "Senza Zero costa meno, ma la spedizione la decide il venditore (non la conosciamo): " : "Nessuna offerta Zero in UE. Migliore senza Zero: "}
          {cmp.cheaperNoHub.seller_username ?? "venditore"} {countryFlag(cmp.cheaperNoHub.ships_from_country)} a {formatCents(cmp.cheaperNoHub.price_cents, currency)} + spedizione.
        </p>
      )}
    </section>
  );
}

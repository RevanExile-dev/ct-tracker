import Link from "next/link";
import ConditionBadge from "./ConditionBadge";
import { CardRow } from "@/lib/db";
import { formatCents, priceDeltaPct } from "@/lib/format";

type CardTrend = { avgCents: number; days: number };

/** Vista compatta a tabella per confrontare a colpo d'occhio le carte del
 * binder: nome, espansione, rarità, prezzo e variazione tutte allineate,
 * piu' pratico di scorrere la griglia per fare un confronto veloce.
 *
 * "Variazione" confronta il prezzo con la MEDIA degli ultimi N giorni
 * (trends, batch da fetchCardsTrend - stessa idea di trendVsMovingAverage
 * usata nella pagina carta), non con il giorno precedente: un confronto
 * sync-su-sync e' quasi sempre 0.0% per carte che non cambiano l'inserzione
 * "migliore" da un giorno all'altro (caso comune, segnalato dall'utente
 * come "non dice niente di utile") - la media mobile mostra invece SEMPRE
 * un confronto significativo, anche a mercato fermo giorno per giorno. */
export default function BinderTable({
  cards,
  trends,
  returnTo,
}: {
  cards: CardRow[];
  trends?: Record<number, CardTrend>;
  returnTo?: string;
}) {
  return (
    <div className="mt-8 rounded-card border border-base-border bg-base-surface overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-base-border text-left text-[11px] font-mono uppercase tracking-wider text-ink-faint">
            <th className="px-4 py-3 font-normal">Carta</th>
            <th className="hidden sm:table-cell px-4 py-3 font-normal">Espansione</th>
            <th className="hidden sm:table-cell px-4 py-3 font-normal">Rarità</th>
            <th className="px-4 py-3 font-normal text-right">Prezzo</th>
            <th className="px-4 py-3 font-normal text-right">vs media 30gg</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-base-border">
          {cards.map((card) => {
            const priceCents = card.filtered_price_cents ?? card.best_price_cents ?? card.latest_price_cents;
            const priceCurrency = card.filtered_price_currency ?? card.best_price_currency ?? card.latest_price_currency;
            const trend = trends?.[card.id];
            const delta = trend ? priceDeltaPct(priceCents, trend.avgCents) : null;
            // Stessa logica di CardTile (priceProfile="best"): quando non
            // esiste un'inserzione Near Mint + CardTrader Zero, questa
            // tabella ripiegava su latest_price_cents senza mostrare ALCUNA
            // condizione - un prezzo Poor appariva identico a uno Near Mint
            // vero, ancora piu' opaco della vista a griglia (che almeno una
            // volta corretta mostra un badge). usingAbsoluteFloor distingue
            // il caso per usare latest_condition (la condizione vera di
            // quel prezzo) invece di best_condition, che descriverebbe
            // un'inserzione diversa/inesistente quando best_price_cents e' null.
            const hasFilter = card.filtered_price_cents !== undefined;
            const usingAbsoluteFloor = !hasFilter && card.best_price_cents == null && card.latest_price_cents != null;
            const shownCondition = hasFilter
              ? card.filtered_condition
              : usingAbsoluteFloor ? card.latest_condition : card.best_condition;
            const shownZero = hasFilter
              ? card.filtered_can_sell_via_hub
              : usingAbsoluteFloor ? undefined : card.best_can_sell_via_hub;
            return (
              <tr key={card.id} className="hover:bg-base-surface2 transition-colors">
                <td className="px-4 py-3">
                  <Link
                    href={returnTo ? `/card/${card.id}?from=${encodeURIComponent(returnTo)}` : `/card/${card.id}`}
                    className="text-ink-primary hover:text-accent-bright transition-colors font-medium"
                  >
                    {card.name}
                  </Link>
                  {card.version && (
                    <span className="text-ink-faint text-xs ml-1.5">{card.version}</span>
                  )}
                  {/* Su mobile le colonne espansione/rarita' sono nascoste per
                      non forzare lo scroll orizzontale: qui sotto in piccolo. */}
                  <div className="sm:hidden text-ink-faint text-xs mt-0.5">
                    {card.expansion_name}
                    {card.rarity ? ` · ${card.rarity}` : ""}
                  </div>
                </td>
                <td className="hidden sm:table-cell px-4 py-3 text-ink-muted font-mono text-xs">
                  {card.expansion_name}
                </td>
                <td className="hidden sm:table-cell px-4 py-3 text-ink-muted font-mono text-xs">
                  {card.rarity ?? "—"}
                </td>
                <td className="px-4 py-3 text-right font-mono text-ink-primary">
                  <div className="flex items-center justify-end gap-1.5 flex-wrap">
                    {formatCents(priceCents, priceCurrency ?? "EUR")}
                    {shownCondition && <ConditionBadge condition={shownCondition} />}
                    {shownZero === 1 && (
                      <span
                        className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-accent/15 border border-accent/40 text-accent-bright whitespace-nowrap"
                        title="Vendibile via CardTrader Zero (spedizione gestita/garantita)"
                      >
                        Zero
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs">
                  {delta !== null ? (
                    <span
                      className={delta >= 0 ? "text-signal-up" : "text-signal-down"}
                      title={`Media ${trend!.days}gg: ${formatCents(trend!.avgCents, priceCurrency ?? "EUR")}`}
                    >
                      {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
                    </span>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

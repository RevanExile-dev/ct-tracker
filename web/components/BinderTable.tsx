import Link from "next/link";
import { CardRow } from "@/lib/db";
import { formatCents, priceDeltaPct } from "@/lib/format";

/** Vista compatta a tabella per confrontare a colpo d'occhio le carte del
 * binder: nome, espansione, rarità, prezzo e variazione tutte allineate,
 * piu' pratico di scorrere la griglia per fare un confronto veloce. */
export default function BinderTable({ cards, returnTo }: { cards: CardRow[]; returnTo?: string }) {
  return (
    <div className="mt-8 rounded-card border border-base-border bg-base-surface overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-base-border text-left text-[11px] font-mono uppercase tracking-wider text-ink-faint">
            <th className="px-4 py-3 font-normal">Carta</th>
            <th className="hidden sm:table-cell px-4 py-3 font-normal">Espansione</th>
            <th className="hidden sm:table-cell px-4 py-3 font-normal">Rarità</th>
            <th className="px-4 py-3 font-normal text-right">Prezzo</th>
            <th className="px-4 py-3 font-normal text-right">Variazione</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-base-border">
          {cards.map((card) => {
            const priceCents = card.filtered_price_cents ?? card.best_price_cents ?? card.latest_price_cents;
            const priceCurrency = card.filtered_price_currency ?? card.best_price_currency ?? card.latest_price_currency;
            const prevPriceCents = card.prev_best_price_cents ?? card.prev_price_cents;
            const delta = priceDeltaPct(priceCents, prevPriceCents);
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
                  {formatCents(priceCents, priceCurrency ?? "EUR")}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs">
                  {delta !== null ? (
                    <span className={delta >= 0 ? "text-signal-up" : "text-signal-down"}>
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

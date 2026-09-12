import Link from "next/link";
import { CardRow } from "@/lib/db";
import { formatCents, languageFlag, priceDeltaPct } from "@/lib/format";

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
// Stesso limite di MAX_BINDER_QUANTITY in web/lib/account.server.ts
// (duplicato apposta lato client, vedi commento li' sul perche' del tetto).
const MAX_QUANTITY = 999;

export default function BinderTable({
  cards,
  trends,
  returnTo,
  quantities,
  onQuantityChange,
  ownedLanguageMatches,
}: {
  cards: CardRow[];
  trends?: Record<number, CardTrend>;
  returnTo?: string;
  /** blueprintId -> quantita' posseduta. Insieme a onQuantityChange, mostra
   * uno stepper +/- nella colonna dedicata - se assenti la colonna non
   * compare (stessa convenzione di CardTile). */
  quantities?: Map<number, number>;
  onQuantityChange?: (id: number, next: number) => void;
  /** blueprintId -> prezzo nella lingua posseduta, stessa semantica di
   * ownedLanguageMatch in CardTile.tsx (cents null = lingua nota ma nessuna
   * corrispondenza trovata, mai un fallback silenzioso). */
  ownedLanguageMatches?: Map<number, { language: string; cents: number | null; currency: string | null }>;
}) {
  const showQuantity = quantities !== undefined && onQuantityChange !== undefined;
  return (
    <div className="mt-8 rounded-card border border-base-border bg-base-surface overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-base-border text-left text-[11px] font-mono uppercase tracking-wider text-ink-faint">
            <th className="px-4 py-3 font-normal">Carta</th>
            <th className="hidden sm:table-cell px-4 py-3 font-normal">Espansione</th>
            <th className="hidden sm:table-cell px-4 py-3 font-normal">Rarità</th>
            {showQuantity && <th className="px-4 py-3 font-normal text-center">Q.tà</th>}
            <th className="px-4 py-3 font-normal text-right">Prezzo</th>
            <th className="px-4 py-3 font-normal text-right">vs media 30gg</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-base-border">
          {cards.map((card) => {
            const languageMatch = ownedLanguageMatches?.get(card.id);
            const hasOwnedMatch = card.filtered_price_cents === undefined && languageMatch?.cents != null;
            const priceCents = card.filtered_price_cents
              ?? (hasOwnedMatch ? languageMatch!.cents : card.best_price_cents ?? card.latest_price_cents);
            const priceCurrency = card.filtered_price_currency
              ?? (hasOwnedMatch ? languageMatch!.currency ?? "EUR" : card.best_price_currency ?? card.latest_price_currency);
            const trend = trends?.[card.id];
            const delta = trend ? priceDeltaPct(priceCents, trend.avgCents) : null;
            const quantity = quantities?.get(card.id) ?? 1;
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
                {showQuantity && (
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        type="button"
                        disabled={quantity <= 1}
                        onClick={() => onQuantityChange!(card.id, quantity - 1)}
                        aria-label={`Diminuisci quantità di ${card.name}`}
                        className="w-7 h-7 shrink-0 rounded-full border border-base-border bg-base-surface2 text-ink-muted flex items-center justify-center transition-colors hover:text-ink-primary hover:border-accent/40 disabled:opacity-30 disabled:pointer-events-none"
                      >
                        −
                      </button>
                      <span className="font-mono text-xs text-ink-primary min-w-[1.5rem] text-center" aria-live="polite">
                        {quantity}
                      </span>
                      <button
                        type="button"
                        disabled={quantity >= MAX_QUANTITY}
                        onClick={() => onQuantityChange!(card.id, quantity + 1)}
                        aria-label={`Aumenta quantità di ${card.name}`}
                        className="w-7 h-7 shrink-0 rounded-full border border-base-border bg-base-surface2 text-ink-muted flex items-center justify-center transition-colors hover:text-ink-primary hover:border-accent/40 disabled:opacity-30 disabled:pointer-events-none"
                      >
                        +
                      </button>
                    </div>
                  </td>
                )}
                <td className="px-4 py-3 text-right font-mono text-ink-primary">
                  <div className="flex items-center justify-end gap-1">
                    {formatCents(priceCents, priceCurrency ?? "EUR")}
                    {hasOwnedMatch && (
                      <span className="text-xs" title={`Prezzo trovato in ${languageMatch!.language.toUpperCase()} (lingua posseduta)`}>
                        {languageFlag(languageMatch!.language)}
                      </span>
                    )}
                  </div>
                  {quantity > 1 && (
                    <div className="text-[11px] text-ink-faint">
                      = {formatCents(priceCents !== null ? priceCents * quantity : null, priceCurrency ?? "EUR")}
                    </div>
                  )}
                  {languageMatch && languageMatch.cents == null && (
                    <div className="text-[10px] text-ink-faint">
                      nessuna inserzione in {languageMatch.language.toUpperCase()}
                    </div>
                  )}
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

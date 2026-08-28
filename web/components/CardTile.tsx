import Link from "next/link";
import Image from "next/image";
import HoloFrame from "./HoloFrame";
import { CardRow } from "@/lib/db";
import { formatCents, priceDeltaPct } from "@/lib/format";

export default function CardTile({ card }: { card: CardRow }) {
  const delta = priceDeltaPct(card.latest_price_cents, card.prev_price_cents);

  return (
    <Link href={`/card/${card.id}`} className="group block">
      <HoloFrame className="bg-base-surface border border-base-border overflow-hidden transition-transform duration-300 group-hover:-translate-y-1">
        <div className="relative aspect-[5/7] bg-base-surface2">
          {card.image_url ? (
            <Image
              src={card.image_url}
              alt={card.name}
              fill
              sizes="(min-width: 1024px) 20vw, 45vw"
              className="object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-ink-faint text-xs font-mono">
              nessuna immagine
            </div>
          )}
          {card.is_premium === 1 && (
            <span className="absolute top-2 left-2 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-black/60 backdrop-blur border border-white/10 text-accent-bright">
              premium
            </span>
          )}
        </div>

        <div className="p-3">
          <div className="text-xs font-mono text-ink-faint truncate">{card.expansion_name}</div>
          <div className="font-display font-medium text-ink-primary leading-snug mt-0.5 truncate">
            {card.name}
          </div>

          <div className="flex items-end justify-between mt-2">
            <div className="font-mono text-lg text-ink-primary">
              {formatCents(card.latest_price_cents, card.latest_price_currency ?? "EUR")}
            </div>
            {delta !== null && (
              <div
                className={`text-xs font-mono ${
                  delta >= 0 ? "text-signal-up" : "text-signal-down"
                }`}
              >
                {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
              </div>
            )}
          </div>
        </div>
      </HoloFrame>
    </Link>
  );
}

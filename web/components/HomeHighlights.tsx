"use client";

// Righe curate in cima alla home ("in evidenza"): non un nuovo tipo di dato,
// solo tre chiamate diverse a fetchCards() con filtri/ordinamenti gia'
// esistenti nel catalogo (is_premium, lingua, prezzo/andamento) - vedi
// CLAUDE.md/thread utente: l'obiettivo era smettere di mostrare carte
// "a caso" (es. giapponesi) in home senza aggiungere nessuna raccolta dati
// nuova. Visibile solo quando l'utente non ha ancora impostato filtri
// propri (vedi `active` passato da app/page.tsx): e' un punto di partenza
// per la scoperta, non un'altra vista permanente sopra il catalogo filtrato.

import { useEffect, useState } from "react";
import { CardRow, fetchCards } from "@/lib/db";
import CardTile from "./CardTile";

const ROW_LIMIT = 10;

type Row = {
  key: string;
  title: string;
  subtitle: string;
  cards: CardRow[] | null; // null = ancora in caricamento
};

function HighlightRow({
  row, binderIds, onToggleBinder, wishlistIds, onToggleWishlist, returnTo,
}: {
  row: Row;
  binderIds: Set<number>;
  onToggleBinder: (card: CardRow) => void;
  wishlistIds: Set<number>;
  onToggleWishlist: (card: CardRow) => void;
  returnTo: string;
}) {
  // Riga ancora in caricamento o senza risultati (es. nessuna carta full
  // art italiana ancora in catalogo): non mostrare un titolo vuoto.
  if (row.cards !== null && row.cards.length === 0) return null;

  return (
    <div className="mt-6 first:mt-0">
      <div className="mb-2.5">
        <h2 className="font-display text-base font-semibold text-ink-primary">{row.title}</h2>
        <div className="text-xs font-mono text-ink-faint">{row.subtitle}</div>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-2 -mx-5 sm:-mx-8 px-5 sm:px-8 snap-x snap-mandatory [scrollbar-width:thin]">
        {(row.cards ?? Array.from({ length: 4 })).map((card, i) => (
          <div key={card?.id ?? i} className="shrink-0 w-[42vw] sm:w-44 snap-start">
            {card ? (
              <CardTile
                card={card}
                index={i}
                horizontalScroll
                inBinder={binderIds.has(card.id)}
                onToggleBinder={onToggleBinder}
                inWishlist={wishlistIds.has(card.id)}
                onToggleWishlist={onToggleWishlist}
                returnTo={returnTo}
              />
            ) : (
              <div className="skeleton rounded-card border border-base-border bg-base-surface overflow-hidden">
                <div className="aspect-[5/7] bg-base-surface2" />
                <div className="p-3 space-y-2">
                  <div className="h-2.5 w-2/3 rounded bg-base-surface2" />
                  <div className="h-3.5 w-4/5 rounded bg-base-surface2" />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function HomeHighlights({
  active, binderIds, onToggleBinder, wishlistIds, onToggleWishlist, returnTo,
}: {
  /** Mostra le righe solo quando l'utente non ha ancora impostato filtri
   * propri (vedi hasActiveFilters in app/page.tsx) - una volta che cerca o
   * filtra, queste righe non sono piu' pertinenti alla vista corrente. */
  active: boolean;
  binderIds: Set<number>;
  onToggleBinder: (card: CardRow) => void;
  wishlistIds: Set<number>;
  onToggleWishlist: (card: CardRow) => void;
  returnTo: string;
}) {
  const [rows, setRows] = useState<Row[]>([
    { key: "trending", title: "In tendenza", subtitle: "Maggior rialzo di prezzo giorno su giorno", cards: null },
    { key: "it-premium", title: "Full art italiane", subtitle: "Illustration/secret/alternate art, prezzo piu' alto prima", cards: null },
    { key: "new-premium", title: "Ultime uscite, full art", subtitle: "Dalle espansioni piu' recenti tracciate", cards: null },
  ]);

  // Una sola volta al montaggio: queste righe non dipendono dai filtri del
  // catalogo sotto, quindi non c'e' motivo di rilanciarle ad ogni cambio di
  // `active` (che si limita a nascondere/mostrare quanto gia' caricato).
  useEffect(() => {
    let cancelled = false;
    const load = async (key: string, fetcher: () => Promise<CardRow[]>) => {
      try {
        const cards = await fetcher();
        if (!cancelled) {
          setRows((prev) => prev.map((r) => (r.key === key ? { ...r, cards } : r)));
        }
      } catch {
        // Riga curata opzionale: un errore qui non deve rompere la home,
        // resta semplicemente non mostrata (row.cards === [] la nasconde).
        if (!cancelled) {
          setRows((prev) => prev.map((r) => (r.key === key ? { ...r, cards: [] } : r)));
        }
      }
    };
    load("trending", () => fetchCards({ sortBy: "rise_first", limit: ROW_LIMIT }));
    load("it-premium", () =>
      fetchCards({ onlyPremium: true, languages: ["it"], sortBy: "price_desc", limit: ROW_LIMIT })
    );
    load("new-premium", () => fetchCards({ onlyPremium: true, sortBy: "expansion", limit: ROW_LIMIT }));
    return () => { cancelled = true; };
  }, []);

  if (!active) return null;

  return (
    <div className="mt-8">
      {rows.map((row) => (
        <HighlightRow
          key={row.key}
          row={row}
          binderIds={binderIds}
          onToggleBinder={onToggleBinder}
          wishlistIds={wishlistIds}
          onToggleWishlist={onToggleWishlist}
          returnTo={returnTo}
        />
      ))}
    </div>
  );
}

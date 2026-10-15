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
import { CardRow, MIN_MOVER_LISTINGS, fetchCards } from "@/lib/db";
import { HIGHLIGHT_ROWS, type InitialHighlights } from "@/lib/homeHighlights";
import { useProgressiveCount } from "@/lib/useProgressiveCount";
import CardTile from "./CardTile";

// Montaggio a scaglioni delle tile delle tre righe (stesso motivo e stessa
// tecnica della griglia in app/page.tsx): quante per riga subito, quante in piu' per frame.
const ROW_INITIAL = 3;
// Le tile oltre le prime ROW_INITIAL (fuori schermo nello swipe, o nelle righe
// piu' in basso) aspettano questo tempo dopo il caricamento della pagina: il
// browser carica le immagini `lazy` entro ~1250 px dal bordo, quindi montarle
// subito faceva partire ~24 scaricamenti insieme che si dividevano la banda e
// ritardavano la prima carta (misurato: primo disegno a 7 s su rete lenta).
const REST_DELAY_MS = 1200;
const ROW_STEP = 3;

type Row = {
  key: string;
  title: string;
  subtitle: string;
  cards: CardRow[] | null; // null = ancora in caricamento
};

function HighlightRow({
  row, rowIndex, mountedCount, binderIds, onToggleBinder, wishlistIds, onToggleWishlist, returnTo,
}: {
  row: Row;
  /** Posizione della riga: solo le prime tile della prima hanno priorita' alta. */
  rowIndex: number;
  /** Quante tile montare ora (le altre seguono a scaglioni). */
  mountedCount: number;
  binderIds: Set<number>;
  onToggleBinder: (card: CardRow) => void;
  wishlistIds: Set<number>;
  onToggleWishlist: (card: CardRow) => void;
  returnTo: string;
}) {
  // Riga ancora in caricamento o senza risultati (es. nessuna carta full
  // art italiana ancora in catalogo): non mostrare un titolo vuoto.
  if (row.cards !== null && row.cards.length === 0) return null;

  const items: (CardRow | undefined)[] = row.cards
    ? row.cards.slice(0, mountedCount)
    : Array.from({ length: 4 }, () => undefined);

  return (
    <div className="mt-6 first:mt-0">
      <div className="mb-2.5">
        <h2 className="font-display text-base font-semibold text-ink-primary">{row.title}</h2>
        <div className="text-xs font-mono text-ink-faint">{row.subtitle}</div>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-2 -mx-5 sm:-mx-8 px-5 sm:px-8 snap-x snap-mandatory [scrollbar-width:thin]">
        {items.map((card, i) => (
          <div key={card?.id ?? i} className="shrink-0 w-[42vw] sm:w-44 snap-start">
            {card ? (
              <CardTile
                card={card}
                index={i}
                horizontalScroll
                imagePriority={rowIndex === 0 && i < 3 ? "high" : "low"}
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
  active, initial, binderIds, onToggleBinder, wishlistIds, onToggleWishlist, returnTo,
}: {
  /** Mostra le righe solo quando l'utente non ha ancora impostato filtri
   * propri (vedi hasActiveFilters in app/page.tsx) - una volta che cerca o
   * filtra, queste righe non sono piu' pertinenti alla vista corrente. */
  active: boolean;
  /** Righe gia' lette dal server (pagina statica rigenerata ogni minuto): con
   * queste le tile si disegnano subito all'idratazione, senza il giro di API
   * che prima ritardava le immagini di ~0,5 s e il preload parte dall'HTML. */
  initial?: InitialHighlights;
  binderIds: Set<number>;
  onToggleBinder: (card: CardRow) => void;
  wishlistIds: Set<number>;
  onToggleWishlist: (card: CardRow) => void;
  returnTo: string;
}) {
  const [rows, setRows] = useState<Row[]>([
    { key: "trending", title: "In tendenza", subtitle: `Maggior rialzo di prezzo giorno su giorno, su carte con almeno ${MIN_MOVER_LISTINGS} inserzioni`, cards: initial?.trending ?? null },
    { key: "it-premium", title: "Full art italiane", subtitle: "Illustration/secret/alternate art, prezzo piu' alto prima", cards: initial?.["it-premium"] ?? null },
    { key: "new-premium", title: "Ultime uscite, full art", subtitle: "Dalle espansioni piu' recenti tracciate", cards: initial?.["new-premium"] ?? null },
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
    // Solo le righe che il server non ha potuto leggere (DB irraggiungibile).
    for (const def of HIGHLIGHT_ROWS) {
      if (!initial?.[def.key]) load(def.key, () => fetchCards(def.opts));
    }
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `initial` e' fisso per la vita della pagina
  }, []);

  // Prima le tile visibili, il resto dopo REST_DELAY_MS (o al primo gesto).
  const [restOpen, setRestOpen] = useState(false);
  useEffect(() => {
    const open = () => setRestOpen(true);
    const timer = window.setTimeout(open, REST_DELAY_MS);
    window.addEventListener("pointerdown", open, { once: true, passive: true });
    window.addEventListener("scroll", open, { once: true, passive: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", open);
      window.removeEventListener("scroll", open);
    };
  }, []);

  const longestRow = rows.reduce((max, r) => Math.max(max, r.cards?.length ?? 0), 0);
  const { count: mountedCount } = useProgressiveCount(
    restOpen ? longestRow : Math.min(longestRow, ROW_INITIAL),
    ROW_INITIAL,
    ROW_STEP,
  );

  if (!active) return null;

  return (
    <div className="mt-8">
      {rows.map((row, rowIndex) => (
        <HighlightRow
          key={row.key}
          row={row}
          rowIndex={rowIndex}
          mountedCount={mountedCount}
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
